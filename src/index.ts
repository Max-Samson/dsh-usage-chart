/**
 * 宿主（Node）半区：dsh-usage-chart
 *
 * 在同源 HTTP 服务上注册五个路由：
 *  - `/dsh-usage-chart/balance` — 代理 DeepSeek 官方 `GET /user/balance`
 *    （浏览器直连会被 CORS 拦截，且 API Key 不应暴露给浏览器）。
 *  - `/dsh-usage-chart/usage`   — 读取会话日志（adapter 上报的完整事件流），
 *    经 RoundFold 折叠出每轮用量明细（token 四桶 + 耗时/TTFT/TPS +
 *    模型归因 + 结束原因 + 每轮成本分拆）。
 *  - `/dsh-usage-chart/pricing` — 价格解析快照（内置刊例价 + 用户覆盖
 *    pricing.json，CNY/USD 双币种 / 1M tokens，区分高峰/空闲时段），client 实时
 *    成本计算的唯一价格输入（ADR 2）。
 *  - `/dsh-usage-chart/meta`    — 下发成本显示币种与汇率配置（成本按所选币种的
 *    官方刊例价直接计算，汇率仅作参考注记）。
 *  - `/dsh-usage-chart/rate`    — 代理实时 USD→CNY 汇率查询。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context, CredentialsService } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeCnyPerUsd, normalizeCurrency } from './pricing/calc.ts'

// ── 共享纯计算（client 同源 bundle）────────────────────────────────────────
export {
  ZERO_BUCKETS,
  billedInputTokens,
  cacheHitPercent,
  DEFAULT_CNY_PER_USD,
  costSplit,
  costSplitAt,
  formatCny,
  formatDuration,
  formatMoney,
  formatPricePerM,
  formatTokens,
  isPeakHour,
  normalizeCnyPerUsd,
  normalizeCurrency,
  tierAt,
} from './pricing/calc.ts'
export type {
  BucketPrices,
  CostCurrency,
  CostSplit,
  ModelPricing,
  PriceTier,
  PriceTierId,
  TokenUsageBuckets,
} from './pricing/calc.ts'

// ── 价格来源接缝与解析器（host 专用）───────────────────────────────────────
import {
  BUILTIN_VERIFIED_AT,
  FALLBACK_PRICING,
  filePricingSource,
} from './pricing/source.ts'
import { createPricingResolver } from './pricing/resolve.ts'
import { foldRounds } from './usage/rounds.ts'

export {
  BUILTIN_PRICING,
  BUILTIN_VERIFIED_AT,
  FALLBACK_PRICING,
  builtinPricingSource,
  filePricingSource,
  loadPricingFile,
  normalizeFileEntry,
  parsePricingFile,
} from './pricing/source.ts'
export type { FilePricingEntry, PricingFileShape, PricingSource, PricingSourceId } from './pricing/source.ts'
export { createPricingResolver, estimateCost, pricingFor } from './pricing/resolve.ts'
export type { PricingResolver, ResolvedPricing } from './pricing/resolve.ts'

/** v0.1 兼容别名：内置刊例价表。 */
export { BUILTIN_PRICING as PRICING } from './pricing/source.ts'

// ── RoundFold（host 折叠，权威基准）────────────────────────────────────────
export { foldRounds, foldTurnUsage } from './usage/rounds.ts'
export type { FoldResult, RoundCost, SessionEventLike, UsageRound } from './usage/rounds.ts'

export const name = 'dsh-usage-chart'

/** 依赖 webServer（路由载体）与 sessions（会话日志读取）。 */
export const inject = ['webServer', 'sessions']

export interface Config {
  /** 可选：优先于环境变量 DEEPSEEK_API_KEY。留空则回退到环境变量。 */
  apiKey?: string
  /** 可选：官方 API 基地址。 */
  baseUrl?: string
  /**
   * 可选：价格覆盖文件（pricing.json）路径。留空时默认
   * `$DSH_HOME/data/dsh-usage-chart/pricing.json`（无 DSH_HOME 时 `~/.dsh/...`）。
   */
  pricingFile?: string
  /** 可选：成本显示币种，'usd'（默认）或 'cny'。 */
  currency?: string
  /** 可选：currency: 'cny' 时的美元兑人民币汇率，默认 6.76。 */
  cnyPerUsd?: number
  /** 可选：实时汇率数据源 URL（须返回 `{ rates: { CNY: number } }` 结构），默认 open.er-api.com。 */
  fxUrl?: string
}

interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface BalanceResponse {
  ok: boolean
  apiKeyConfigured: boolean
  source?: 'api'
  reason?: 'no-api-key' | 'request-failed' | 'bad-response'
  message?: string
  isAvailable?: boolean
  balances?: BalanceInfo[]
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

const DEFAULT_FX_URL = 'https://open.er-api.com/v6/latest/USD'

/**
 * 验证并规茁化汇率源 URL：强制 HTTPS（仅 loopback 放行 HTTP）、禁凭据；
 * 与 normalizeBaseUrl 不同，保留 query 参数（汇率源常需 ?from=USD / ?base=USD）。
 */
function normalizeFxUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('dsh-usage-chart: config.fxUrl must be an absolute URL')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('dsh-usage-chart: config.fxUrl must use HTTPS (HTTP is only allowed for loopback proxies)')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('dsh-usage-chart: config.fxUrl must not contain credentials')
  }
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

/** 回退汇率源（主源不可达时依次尝试；结构须为 `{ rates: { CNY: number } }`）。 */
const FALLBACK_FX_URLS = [
  'https://api.frankfurter.dev/v1/latest?base=USD',
]

/** 默认价格覆盖文件：`$DSH_HOME/data/dsh-usage-chart/pricing.json`。 */
export function defaultPricingFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  const root = configured !== undefined && configured !== '' ? expandHome(configured, home) : join(home, '.dsh')
  return join(root, 'data', 'dsh-usage-chart', 'pricing.json')
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/')) return join(home, value.slice(2))
  return value
}

/**
 * Normalize and validate the upstream API URL.
 * HTTPS is required except for loopback addresses used by local API proxies.
 */
export function normalizeBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new TypeError('dsh-usage-chart: config.baseUrl must be an absolute URL')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('dsh-usage-chart: config.baseUrl must use HTTPS (HTTP is only allowed for loopback proxies)')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('dsh-usage-chart: config.baseUrl must not contain credentials')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

/** Reject browser requests initiated outside the DSH Web origin. */
export function isTrustedRequest(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function guardRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
    return false
  }
  if (!isTrustedRequest(req)) {
    writeJson(res, 403, { ok: false, reason: 'cross-origin-request' })
    return false
  }
  return true
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(payload)
}

/** 拉取官方余额。任何失败都返回结构化错误，不抛异常。 */
async function fetchBalance(apiKey: string, baseUrl: string): Promise<BalanceResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(`${baseUrl}/user/balance`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        ok: false,
        apiKeyConfigured: true,
        reason: 'request-failed',
        message: `官方接口返回 HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      }
    }
    const data = (await res.json()) as {
      is_available?: boolean
      balance_infos?: Array<{
        currency?: string
        total_balance?: string
        granted_balance?: string
        topped_up_balance?: string
      }>
    }
    const balances: BalanceInfo[] = (data.balance_infos ?? []).map((b) => ({
      currency: b.currency ?? 'CNY',
      totalBalance: b.total_balance ?? '0',
      grantedBalance: b.granted_balance ?? '0',
      toppedUpBalance: b.topped_up_balance ?? '0',
    }))
    if (balances.length === 0) {
      return { ok: false, apiKeyConfigured: true, reason: 'bad-response', message: '官方接口未返回 balance_infos' }
    }
    return {
      ok: true,
      apiKeyConfigured: true,
      source: 'api',
      isAvailable: data.is_available ?? false,
      balances,
    }
  } catch (error) {
    return {
      ok: false,
      apiKeyConfigured: true,
      reason: 'request-failed',
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取实时 USD→CNY 汇率：按 fxUrls 顺序依次尝试（配置源优先，内置回退源兜底），
 * 每个源独立 8s 超时；任一源返回合法 rates.CNY 即成功并标注 source。
 * 全部失败返回结构化错误，不抛异常。
 */
async function fetchLiveRate(fxUrls: string[]): Promise<{
  ok: boolean
  rate?: number
  fetchedAt?: number
  reason?: 'request-failed' | 'bad-response'
  message?: string
  source?: string
}> {
  let last: { reason: 'request-failed' | 'bad-response'; message?: string } | null = null
  for (const url of fxUrls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!res.ok) {
        last = { reason: 'request-failed', message: `汇率源返回 HTTP ${res.status}` }
        continue
      }
      const data = (await res.json()) as { rates?: { CNY?: unknown } }
      const rate = data.rates?.CNY
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        last = { reason: 'bad-response', message: '汇率源未返回有效的 rates.CNY' }
        continue
      }
      return { ok: true, rate, fetchedAt: Date.now(), source: url }
    } catch (error) {
      last = { reason: 'request-failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, reason: last?.reason ?? 'request-failed', message: last?.message }
}
/**
 * 插件入口：注册余额代理 / 用量折叠 / 价格快照 / 显示配置 / 汇率代理路由。
 * @param ctx - 宿主 Context（cordis）。
 * @param config - 行配置（cordis.patch.yml 的 config）。
 */
export function apply(ctx: Context, config: Config = {}): void {
  /**
   * 解析 API Key（每次请求解析，与官方 llm-deepseek 适配器同一通道）：
   *  1) 插件 config.apiKey（显式配置优先）
   *  2) DSH 凭据服务解析 'DEEPSEEK_API_KEY'——覆盖在网页端「设置 → 模型」
   *     配置的密钥、用户/项目环境层与 $DEEPSEEK_API_KEY。凭据服务是可选
   *     依赖，用 ctx.get('credentials') 读取（不声明 inject，缺失返回
   *     undefined；cordis 属性访问未 inject 的服务会抛错）。
   *  3) 无凭据服务时回退 process.env.DEEPSEEK_API_KEY
   */
  const resolveApiKey = async (): Promise<string> => {
    const configured = config.apiKey?.trim()
    if (configured !== undefined && configured !== '') return configured
    const credentials = ctx.get('credentials') as CredentialsService | undefined
    if (credentials !== undefined) {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      const value = resolved?.value.trim()
      if (value !== undefined && value !== '') return value
    }
    return (process.env.DEEPSEEK_API_KEY ?? '').trim()
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl)

  // 价格解析（单一真相）：用户覆盖文件（含变更监听）→ 内置刊例价 → 回退。
  const pricingFile = config.pricingFile?.trim() || defaultPricingFile()
  const fileSource = filePricingSource(pricingFile)
  const resolver = createPricingResolver(fileSource)
  ctx.effect(() => fileSource.dispose(), 'dsh-usage-chart: pricing file watcher')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/balance',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      const apiKey = await resolveApiKey()
      if (apiKey === '') {
        writeJson(res, 200, {
          ok: false,
          apiKeyConfigured: false,
          reason: 'no-api-key',
          message: '未配置 DEEPSEEK_API_KEY（或插件 config.apiKey / 网页端 API Key）。余额显示为 –，点击可重试。',
        } satisfies BalanceResponse)
        return
      }
      const result = await fetchBalance(apiKey, baseUrl)
      writeJson(res, 200, result)
    },
  }), 'dsh-usage-chart: balance route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/usage',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('session') ?? ''
      if (!/^session-[\w-]+$/.test(sessionId)) {
        writeJson(res, 400, { ok: false, reason: 'bad-session-id' })
        return
      }
      const session = ctx.sessions.get(sessionId)
      if (session === undefined) {
        writeJson(res, 404, { ok: false, reason: 'session-not-found' })
        return
      }
      const { totals, rounds } = foldRounds(session.events as readonly import('./usage/rounds.ts').SessionEventLike[], resolver)
      writeJson(res, 200, { ok: true, sessionId, totals, rounds })
    },
  }), 'dsh-usage-chart: usage route')

  const displayCurrency = normalizeCurrency(config.currency)
  const cnyPerUsd = normalizeCnyPerUsd(config.cnyPerUsd)
  // 汇率源列表：配置源（或默认源） + 内置回退源，去重后依次尝试
  const configuredFxUrl = config.fxUrl?.trim() ?? ''
  const fxUrls = [...new Set([
    configuredFxUrl === '' ? DEFAULT_FX_URL : normalizeFxUrl(configuredFxUrl),
    ...FALLBACK_FX_URLS,
  ])]

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/meta',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      writeJson(res, 200, { ok: true, currency: displayCurrency, cnyPerUsd })
    },
  }), 'dsh-usage-chart: meta route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/rate',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      const result = await fetchLiveRate(fxUrls)
      writeJson(res, 200, result)
    },
  }), 'dsh-usage-chart: rate route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/pricing',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      writeJson(res, 200, {
        ok: true,
        pricingFile,
        builtinVerifiedAt: BUILTIN_VERIFIED_AT,
        fallback: {
          pricing: FALLBACK_PRICING,
          verifiedAt: BUILTIN_VERIFIED_AT,
        },
        models: resolver.list(),
      })
    },
  }), 'dsh-usage-chart: pricing route')
}
