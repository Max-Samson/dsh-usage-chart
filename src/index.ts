/**
 * 宿主（Node）半区：dsh-usage-chart
 *
 * 在同源 HTTP 服务上注册四个路由：
 *  - `/dsh-usage-chart/balance` — 代理 DeepSeek 官方 `GET /user/balance`
 *    （浏览器直连会被 CORS 拦截，且 API Key 不应暴露给浏览器）。
 *  - `/dsh-usage-chart/usage`   — 读取会话日志（adapter 上报的完整事件流），
 *    折叠出每轮真实 token 用量（与 token-meter 相同的折叠语义）。
 *  - `/dsh-usage-chart/meta`    — 下发成本显示币种与汇率配置。
 *  - `/dsh-usage-chart/rate`    — 代理实时 USD→CNY 汇率查询。
 */
import type { Context, CredentialsService } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeCnyPerUsd, normalizeCurrency } from './pricing.ts'

export {
  DEFAULT_CNY_PER_USD,
  PRICING,
  ZERO_BUCKETS,
  billedInputTokens,
  cacheHitPercent,
  estimateCost,
  formatMoney,
  formatPricePerM,
  formatTokens,
  formatUsd,
  normalizeCnyPerUsd,
  normalizeCurrency,
  pricingFor,
  toDisplayAmount,
} from './pricing.ts'
export type { DisplayCurrency, ModelPricing, TokenUsageBuckets } from './pricing.ts'

export const name = 'dsh-usage-chart'

/** 依赖 webServer（路由载体）与 sessions（会话日志读取）。 */
export const inject = ['webServer', 'sessions']

export interface Config {
  /** 可选：优先于环境变量 DEEPSEEK_API_KEY。留空则回退到环境变量。 */
  apiKey?: string
  /** 可选：官方 API 基地址。 */
  baseUrl?: string
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

/** token 用量四桶（与 client 侧 TokenUsageBuckets 一致）。 */
export interface UsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface UsageTurn {
  turn: number
  buckets: UsageBuckets
}

/** 会话日志事件的最小形状（assistant/chunk 与 assistant/message 携带 turn/step/usage）。 */
export interface SessionEventLike {
  type: string
  seq: number
  data: {
    turn?: number
    step?: number
    usage?: unknown
    chunk?: { type?: string; usage?: unknown }
  }
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

const DEFAULT_FX_URL = 'https://open.er-api.com/v6/latest/USD'

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

function zeroBuckets(): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function addInto(target: UsageBuckets, other: UsageBuckets): void {
  target.uncachedInputTokens += other.uncachedInputTokens
  target.outputTokens += other.outputTokens
  target.cacheReadTokens += other.cacheReadTokens
  target.cacheWriteTokens += other.cacheWriteTokens
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function bucketsOf(usage: unknown): UsageBuckets | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = usage as Record<string, unknown>
  const inputTokens = tokenCount(value.inputTokens)
  const outputTokens = tokenCount(value.outputTokens)
  const cacheReadTokens = value.cacheReadTokens === undefined ? 0 : tokenCount(value.cacheReadTokens)
  const cacheWriteTokens = value.cacheWriteTokens === undefined ? 0 : tokenCount(value.cacheWriteTokens)
  if (inputTokens === null || outputTokens === null || cacheReadTokens === null || cacheWriteTokens === null) return null
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

/**
 * 从会话日志折叠每轮用量（与 token-meter 相同的语义）：
 *  - 用量来自 `assistant/chunk`（chunk.type === 'usage'）与 `assistant/message`；
 *  - 同一 (turn, step) 的重复样本替换而不是累加（chunk 早样 → message 终样）；
 *  - 步骤按日志顺序推进（不变量：后续步骤不会回补更早步骤的用量）。
 * 返回按轮次分组的桶与累计值。
 */
export function foldTurnUsage(events: readonly SessionEventLike[]): {
  totals: UsageBuckets
  turns: UsageTurn[]
} {
  const totals = zeroBuckets()
  const perTurn = new Map<number, UsageBuckets>()
  let currentKey = ''
  let currentTurn = -1
  let stepBuckets: UsageBuckets | null = null

  const commitStep = (turn: number, buckets: UsageBuckets): void => {
    const turnBuckets = perTurn.get(turn) ?? zeroBuckets()
    addInto(turnBuckets, buckets)
    perTurn.set(turn, turnBuckets)
    addInto(totals, buckets)
  }

  for (const event of events) {
    let usage: unknown
    let turn: number | undefined
    let step: number | undefined
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
      ;({ turn, step } = event.data)
      usage = event.data.usage
    }
    if (usage === undefined || turn === undefined || step === undefined) continue
    const sample = bucketsOf(usage)
    if (sample === null) continue
    const key = `${turn}:${step}`
    if (currentKey !== key) {
      if (stepBuckets !== null) commitStep(currentTurn, stepBuckets)
      currentKey = key
      currentTurn = turn
      stepBuckets = zeroBuckets()
    }
    stepBuckets = sample
  }
  if (stepBuckets !== null) commitStep(currentTurn, stepBuckets)

  const turns = [...perTurn.entries()]
    .map(([turn, buckets]) => ({ turn, buckets }))
    .sort((a, b) => a.turn - b.turn)
  return { totals, turns }
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

async function fetchLiveRate(fxUrl: string): Promise<{
  ok: boolean
  rate?: number
  fetchedAt?: number
  reason?: 'request-failed' | 'bad-response'
  message?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(fxUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        ok: false,
        reason: 'request-failed',
        message: `汇率源返回 HTTP ${res.status}`,
      }
    }
    const data = (await res.json()) as { rates?: { CNY?: unknown } }
    const rate = data.rates?.CNY
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      return {
        ok: false,
        reason: 'bad-response',
        message: '汇率源未返回有效的 rates.CNY',
      }
    }
    return { ok: true, rate, fetchedAt: Date.now() }
  } catch (error) {
    return {
      ok: false,
      reason: 'request-failed',
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 插件入口：注册余额代理路由。
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
  const currency = normalizeCurrency(config.currency)
  const cnyPerUsd = normalizeCnyPerUsd(config.cnyPerUsd)
  const fxUrl = normalizeBaseUrl(config.fxUrl === undefined || config.fxUrl === '' ? DEFAULT_FX_URL : config.fxUrl)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/meta',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      writeJson(res, 200, { ok: true, currency, cnyPerUsd })
    },
  }), 'dsh-usage-chart: meta route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/rate',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (!guardRequest(req, res)) return
      const result = await fetchLiveRate(fxUrl)
      writeJson(res, 200, result)
    },
  }), 'dsh-usage-chart: rate route')

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
      const { totals, turns } = foldTurnUsage(session.events as readonly SessionEventLike[])
      writeJson(res, 200, { ok: true, sessionId, totals, turns })
    },
  }), 'dsh-usage-chart: usage route')
}
