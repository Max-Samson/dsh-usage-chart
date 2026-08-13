/**
 * 宿主（Node）半区：dsh-usage-chart
 *
 * 在同源 HTTP 服务上注册两个路由：
 *  - `/dsh-usage-chart/balance` — 代理 DeepSeek 官方 `GET /user/balance`
 *    （浏览器直连会被 CORS 拦截，且 API Key 不应暴露给浏览器）。
 *  - `/dsh-usage-chart/usage`   — 读取会话日志（adapter 上报的完整事件流），
 *    折叠出每轮真实 token 用量（与 token-meter 相同的折叠语义）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const name = 'dsh-usage-chart'

/** 依赖 webServer（路由载体）与 sessions（会话日志读取）。 */
export const inject = ['webServer', 'sessions']

export interface Config {
  /** 可选：优先于环境变量 DEEPSEEK_API_KEY。留空则回退到环境变量。 */
  apiKey?: string
  /** 可选：官方 API 基地址。 */
  baseUrl?: string
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

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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

function bucketsOf(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): UsageBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
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
    const key = `${turn}:${step}`
    if (currentKey !== key) {
      if (stepBuckets !== null) commitStep(currentTurn, stepBuckets)
      currentKey = key
      currentTurn = turn
      stepBuckets = zeroBuckets()
    }
    stepBuckets = bucketsOf(usage as {
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    })
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

/**
 * 插件入口：注册余额代理路由。
 * @param ctx - 宿主 Context（cordis）。
 * @param config - 行配置（cordis.patch.yml 的 config）。
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolveApiKey = (): string =>
    config.apiKey?.trim() !== '' && config.apiKey !== undefined
      ? (config.apiKey as string).trim()
      : (process.env.DEEPSEEK_API_KEY ?? '').trim()
  const baseUrl = config.baseUrl?.trim() !== '' && config.baseUrl !== undefined
    ? (config.baseUrl as string).trim()
    : DEFAULT_BASE_URL

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-usage-chart/balance',
    async handler(_req: IncomingMessage, res: ServerResponse) {
      const apiKey = resolveApiKey()
      if (apiKey === '') {
        writeJson(res, 200, {
          ok: false,
          apiKeyConfigured: false,
          reason: 'no-api-key',
          message: '未配置 DEEPSEEK_API_KEY（或插件 config.apiKey）。余额显示为 –，点击可重试。',
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
