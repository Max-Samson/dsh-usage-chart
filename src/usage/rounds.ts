/**
 * RoundFold（host 半区，深模块）：把会话事件流折叠为每轮用量明细。
 *
 * 小接口：`foldRounds(events, resolvePricing?) → { totals, rounds }`。
 * 大实现：四桶 token 折叠（与 token-meter 语义一致）+ 轮次耗时
 * （turn/start → turn/end）+ TTFT（turn/start → 首个输出样本）+
 * 输出吞吐（outputTokens / 输出时长）+ 模型归因（request/context 优先、
 * request/header 回退、跨轮携带回退）+ 结束原因 + 每轮成本分拆。
 *
 * 跨版本事件词汇：0.1.x 的流式用量走 `assistant/chunk`，0.2.x 移除了该事件，
 * 用量与流内时间线合并进 `assistant/message`（`usage` + `stream`）。这里优先用
 * `stream` 的首/末时间戳计算 TTFT 与 TPS（0.2.x），流时间线缺席时回退到首个
 * usage 样本 / turn 结束时刻（0.1.x 及旧日志）。`user/message.source` 自
 * dsh-llm 0.1.0-rc.2 起在两条线上都是 `{ kind }` 对象，仅更早的旧日志可能仍是
 * 裸字符串；两种形状都归一为归因字符串。
 *
 * 纯函数：不读文件、不发起请求；价格来源经 `resolvePricing` 注入
 * （接缝），默认用内置刊例价。测试喂合成事件流即可断言全部字段。
 */
import type { CostSplit, TokenUsageBuckets } from '../pricing/calc.ts'
import { costSplitAt, ZERO_BUCKETS } from '../pricing/calc.ts'
import type { PricingResolver } from '../pricing/resolve.ts'
import { createPricingResolver } from '../pricing/resolve.ts'

/** 会话日志事件的最小形状（与 @deepseek-ai/dsh-session 的 SessionEvent 一致）。 */
export interface SessionEventLike {
  type: string
  seq: number
  /** Unix epoch 毫秒。 */
  time: number
  data: {
    turn?: number
    step?: number
    reason?: unknown
    provider?: string
    model?: string
    contextWindow?: number
    /** 0.1.x 是来源字符串；0.2.x 是携带 `kind` 的对象。 */
    source?: string | { kind?: string }
    header?: { config?: { provider?: string; model?: string }; source?: string }
    chunk?: { type?: string; usage?: unknown }
    usage?: unknown
    /** 0.2.x `assistant/message` 内嵌的流式时间线（绝对时间 + dt 增量编码）。 */
    stream?: unknown
  }
}

/** 每轮成本分拆（双币种：官方 CNY 与 USD 刊例价各一份）+ 来源/时效/未知标注。 */
export interface RoundCost {
  /** 人民币分拆（官方 CNY 价） */
  cny: CostSplit
  /** 美元分拆（官方 USD 价） */
  usd: CostSplit
  /** 是否使用了回退估算价（模型未收录）。 */
  estimated: boolean
  /** 模型是否被显式定价；false = 未定价模型。 */
  unknownModel: boolean
  /** 未定价且不估算（未收录的 Claude 等）：cny/usd 全零，成本未计入。 */
  unpriced: boolean
  /** 价格命中来源。 */
  source: 'file' | 'builtin' | 'fallback'
  /** 条目核验时间（epoch 毫秒），未知为 null。 */
  verifiedAt: number | null
}

/** 一轮的完整折叠结果。 */
export interface UsageRound {
  turn: number
  buckets: TokenUsageBuckets
  /** 归因模型（request/context → request/header → 跨轮携带回退；均无则 null）。 */
  model: string | null
  /** turn/start 时间（epoch 毫秒）。 */
  startedAt: number | null
  /** turn/end 时间（epoch 毫秒）。 */
  endedAt: number | null
  /** 总耗时（ms），端点缺失为 null。 */
  durationMs: number | null
  /** TTFT（ms）：turn/start → 首个 usage 样本。 */
  ttftMs: number | null
  /** 输出吞吐（tokens/s）：outputTokens / 输出时长。 */
  outputTps: number | null
  /** turn/end.reason.kind；未结束为 null。 */
  endReason: string | null
  /** 用户输入来源归因（'human' | 'agent.inject' | 'agent-message' 等；缺省为 null）。 */
  userSource: string | null
  cost: RoundCost
}
export interface FoldResult {
  totals: TokenUsageBuckets
  rounds: UsageRound[]
}

function zeroBuckets(): TokenUsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function addInto(target: TokenUsageBuckets, other: TokenUsageBuckets): void {
  target.uncachedInputTokens += other.uncachedInputTokens
  target.outputTokens += other.outputTokens
  target.cacheReadTokens += other.cacheReadTokens
  target.cacheWriteTokens += other.cacheWriteTokens
}

function anyTokens(b: TokenUsageBuckets): boolean {
  return b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens > 0
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function bucketsOf(usage: unknown): TokenUsageBuckets | null {
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

interface TurnState {
  start: number | null
  end: number | null
  endReason: string | null
  model: string | null
  /** 首个 usage 样本的时间（0.1.x TTFT 右端点）。 */
  firstUsageAt: number | null
  /** `assistant/message.stream` 时间线的最早输出时间（0.2.x TTFT 右端点，优先）。 */
  firstOutputAt: number | null
  /** `assistant/message.stream` 时间线的最晚输出时间。 */
  outputEndAt: number | null
  /** 0.2.x：各条 assistant/message|attempt 流的生成时长之和（不含工具执行与后续步骤的预填充）。 */
  streamOutputMs: number
  buckets: TokenUsageBuckets
  userSource: string | null
}

/**
 * 取 0.2.x `assistant/attempt|message` 流时间线里最后一个 usage 记录
 * （`{ type: 'chunk', chunk: { type: 'usage', usage } }`）。失败/重试的请求只以这种形式留下用量。
 */
function attemptUsageOf(stream: unknown): unknown {
  if (!Array.isArray(stream)) return undefined
  let usage: unknown
  for (const item of stream) {
    if (typeof item !== 'object' || item === null) continue
    const chunk = (item as { type?: unknown; chunk?: { type?: unknown; usage?: unknown } }).chunk
    if ((item as { type?: unknown }).type === 'chunk' && chunk?.type === 'usage' && chunk.usage !== undefined) usage = chunk.usage
  }
  return usage
}

/** 片段是否携带 token：空字符串（打包流常以空片段开头）与缺失值都不算。 */
function isTokenFragment(fragment: unknown): boolean {
  if (typeof fragment === 'string') return fragment !== ''
  return fragment !== null && fragment !== undefined
}

/**
 * 原始 delta chunk 是否携带 token（与 DSH 官方 isTokenDelta 一致）：
 * text / reasoning 需非空文本；tool-call 只要有参数片段或携带工具名即算。
 */
function isTokenDeltaChunk(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) return false
  const value = chunk as { type?: unknown; text?: unknown; delta?: unknown; argumentsDelta?: unknown; name?: unknown }
  if (typeof value.type !== 'string' || !value.type.endsWith('-delta')) return false
  if (value.type === 'tool-call-delta') {
    return (typeof value.argumentsDelta === 'string' && value.argumentsDelta !== '') || value.name !== undefined
  }
  const text = value.text ?? value.delta
  return typeof text === 'string' && text !== ''
}

/**
 * 从 0.2.x `assistant/message|attempt.stream` 提取首/末 **token** 时间。
 *
 * 时间线条目：
 *  - `{ type: 'chunk', time, chunk }`：block-start / block-end / usage / finish 等结构边界
 *    不携带 token、不参与取值（否则 TTFT 会落在首个 token 之前）；但累加器无法合并的
 *    原始 delta（如 id/name 为空的 tool-call-delta）也以 chunk 形式落盘，按官方
 *    isTokenDelta 判定后计入；
 *  - 打包增量 `{ type: '*-chunks', time0, dt, texts | args }`：第 i 个片段的时间是
 *    `time0 + dt[0] + … + dt[i-1]`；只有非空片段才算 token。例外：带 `name` 的
 *    `tool-call-chunks` 段每个 delta 都携带工具名，即使 args 片段为空也算 token。
 * @param stream - 未知形状的流时间线（只在数组时解析）。
 * @returns 首个与最后一个 token 的时间；没有 token 时为 null。
 */
function streamWindow(stream: unknown): { firstAt: number | null; lastAt: number | null } {
  if (!Array.isArray(stream)) return { firstAt: null, lastAt: null }
  let firstAt: number | null = null
  let lastAt: number | null = null
  const observe = (time: number): void => {
    if (firstAt === null || time < firstAt) firstAt = time
    if (lastAt === null || time > lastAt) lastAt = time
  }
  for (const item of stream) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { type?: unknown; time?: unknown; chunk?: unknown; time0?: unknown; dt?: unknown; texts?: unknown; args?: unknown; name?: unknown }
    if (record.type === 'chunk') {
      if (typeof record.time === 'number' && Number.isFinite(record.time) && isTokenDeltaChunk(record.chunk)) observe(record.time)
      continue
    }
    if (typeof record.time0 !== 'number' || !Number.isFinite(record.time0)) continue
    const fragments = Array.isArray(record.texts) ? record.texts : Array.isArray(record.args) ? record.args : null
    if (fragments === null) continue
    const deltas = Array.isArray(record.dt) ? record.dt : []
    // 累加器只合并同名的 tool-call delta：带 name 的段里每个片段都携带工具名。
    const namedToolCall = typeof record.name === 'string' && record.name !== ''
    let time = record.time0
    for (let index = 0; index < fragments.length; index++) {
      if (index > 0) {
        const delta = deltas[index - 1]
        // 增量缺失或非法时无法定位后续片段，停在已知时间为止。
        if (typeof delta !== 'number' || !Number.isFinite(delta) || delta < 0) break
        time += delta
      }
      if (isTokenFragment(fragments[index]) || namedToolCall) observe(time)
    }
  }
  return { firstAt, lastAt }
}

/**
 * 归一 0.2.x `user/message.source.kind`：`user` / `user-*` 是人工输入；目标续跑保持原名；
 * 其余（tool-jobs、subagent-settled、agent-message 等）都是运行时注入，统一带上
 * `agent.` 前缀，使面板按 Agent 注入展示，而不是误判为人工。
 */
function sourceKindOf(kind: string): string {
  // user、user-question-reply、user-approval 等都是人的输入
  if (kind === 'user' || kind.startsWith('user-')) return 'human'
  if (/agent|goal|continuation/i.test(kind)) return kind
  return `agent.${kind}`
}

/**
 * 归一用户输入来源：0.1.x 字符串原样保留；0.2.x 对象按 `kind` 归一（见 sourceKindOf）；
 * 都缺席时按历史行为回退 'human'。
 */
function userSourceOf(data: SessionEventLike['data']): string | null {
  if (typeof data.source === 'string' && data.source !== '') return data.source
  if (typeof data.source === 'object' && data.source !== null) {
    const kind = data.source.kind
    if (typeof kind === 'string' && kind !== '') return sourceKindOf(kind)
  }
  return typeof data.header?.source === 'string' && data.header.source !== '' ? data.header.source : 'human'
}

function turnReasonOf(reason: unknown): string | null {
  if (typeof reason === 'string' && reason !== '') return reason
  if (typeof reason === 'object' && reason !== null) {
    const kind = (reason as { kind?: unknown }).kind
    if (typeof kind === 'string' && kind !== '') return kind
  }
  return null
}

/**
 * 从会话日志折叠每轮用量（权威基准；client 观测只做实时指示，不合并）。
 *
 * 折叠语义（与 token-meter 一致）：
 *  - 用量来自 `assistant/chunk`（chunk.type === 'usage'）、`assistant/message`，以及
 *    0.2.x 的 `assistant/attempt`（失败/重试请求的已结算用量，内嵌在其 stream 中）；
 *  - 同一 (turn, step) 的重复样本替换而不是累加（chunk 早样 → message 终样）；
 *  - `assistant/attempt` 是一次已结算的独立请求：立即入账，不会被同一步骤之后的
 *    重试样本替换（重试边界两侧的尝试分别计费）；
 *  - 步骤按日志顺序推进（不变量：后续步骤不会回补更早步骤的用量）。
 *
 * 时序字段只统计有用量样本的轮次；端点缺失（如当前未结束轮）对应字段为 null。
 *
 * @param events - 会话日志事件（按 seq 升序）。
 * @param resolvePricing - 价格解析注入点（接缝）；缺省用内置刊例价。
 */
export function foldRounds(events: readonly SessionEventLike[], resolvePricing?: PricingResolver): FoldResult {
  const resolver = resolvePricing ?? createPricingResolver()
  const totals = zeroBuckets()
  const states = new Map<number, TurnState>()
  let openTurn: number | null = null
  let openStepTurn: number | null = null
  /** 跨轮携带回退：最近一次出现的模型。 */
  let carryModel: string | null = null

  // token 折叠状态（沿用 v0.1 foldTurnUsage 的 step 替换语义）。
  let currentKey = ''
  let currentTurn = -1
  let stepBuckets: TokenUsageBuckets | null = null

  const stateFor = (turn: number): TurnState => {
    const existing = states.get(turn)
    if (existing !== undefined) return existing
    const created: TurnState = { start: null, end: null, endReason: null, model: null, firstUsageAt: null, firstOutputAt: null, outputEndAt: null, streamOutputMs: 0, buckets: zeroBuckets(), userSource: null }
    states.set(turn, created)
    return created
  }
  const commitStep = (turn: number, buckets: TokenUsageBuckets): void => {
    addInto(stateFor(turn).buckets, buckets)
    addInto(totals, buckets)
  }
  const recordUsageAt = (turn: number, time: number): void => {
    const state = states.get(turn)
    if (state === undefined) return
    if (state.firstUsageAt === null || time < state.firstUsageAt) state.firstUsageAt = time
  }

  const attributeModel = (model: string | null): void => {
    if (model === null || model === undefined || model.trim() === '') return
    const normalized = model.trim()
    carryModel = normalized
    const target = openStepTurn ?? openTurn
    if (target !== null) {
      const state = states.get(target)
      if (state !== undefined && state.model === null) state.model = normalized
    }
  }

  for (const event of events) {
    const { type, data, time } = event
    switch (type) {
      case 'turn/start': {
        const turn = data.turn ?? -1
        openTurn = turn
        const state = stateFor(turn)
        if (state.start === null) state.start = time
        break
      }
      case 'turn/end': {
        const turn = data.turn ?? -1
        const state = states.get(turn)
        if (state !== undefined) {
          state.end = time
          state.endReason = turnReasonOf(data.reason)
          if (state.model === null) state.model = carryModel
        }
        openTurn = null
        openStepTurn = null
        break
      }
      case 'step/start': {
        openStepTurn = data.turn ?? null
        break
      }
      case 'request/context': {
        attributeModel(data.model ?? null)
        break
      }
      case 'request/header': {
        attributeModel(data.header?.config?.model ?? null)
        break
      }
      case 'user/message': {
        const targetTurn = openStepTurn ?? openTurn ?? data.turn
        if (targetTurn !== undefined && targetTurn !== null) {
          const state = stateFor(targetTurn)
          if (state.userSource === null) state.userSource = userSourceOf(data)
        }
        break
      }
      default: {
        // 0.2.x：流式时间线内嵌在 assistant/message|attempt.stream 中，先记录首/末输出时间。
        if ((type === 'assistant/message' || type === 'assistant/attempt') && data.turn !== undefined) {
          const window = streamWindow(data.stream)
          if (window.firstAt !== null || window.lastAt !== null) {
            const state = stateFor(data.turn)
            if (window.firstAt !== null && (state.firstOutputAt === null || window.firstAt < state.firstOutputAt)) state.firstOutputAt = window.firstAt
            if (window.lastAt !== null && (state.outputEndAt === null || window.lastAt > state.outputEndAt)) state.outputEndAt = window.lastAt
            if (window.firstAt !== null && window.lastAt !== null) state.streamOutputMs += window.lastAt - window.firstAt
          }
        }
        if (type === 'assistant/attempt') {
          const { turn, step } = data
          const sample = bucketsOf(attemptUsageOf(data.stream))
          if (sample === null || turn === undefined || step === undefined) continue
          // 已结算的失败尝试：替换同步骤未结算的早样，并立即入账；之后的重试另起一段。
          if (stepBuckets !== null && currentKey !== `${turn}:${step}`) commitStep(currentTurn, stepBuckets)
          commitStep(turn, sample)
          currentKey = ''
          currentTurn = -1
          stepBuckets = null
          recordUsageAt(turn, time)
          continue
        }
        let usage: unknown
        let turn: number | undefined
        let step: number | undefined
        if (type === 'assistant/chunk' && data.chunk?.type === 'usage') {
          ;({ turn, step } = data)
          usage = data.chunk.usage
        } else if (type === 'assistant/message') {
          ;({ turn, step } = data)
          // 与官方 usageOf 一致：data.usage 缺席时回退到流里最后一个 usage 记录。
          usage = data.usage ?? attemptUsageOf(data.stream)
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
        recordUsageAt(turn, time)
      }
    }
  }
  if (stepBuckets !== null) commitStep(currentTurn, stepBuckets)

  // 未结束的最后一轮：模型回退到最近出现的模型。
  if (openTurn !== null) {
    const state = states.get(openTurn)
    if (state !== undefined && state.model === null) state.model = carryModel
  }

  const rounds: UsageRound[] = []
  for (const [turn, state] of states) {
    if (!anyTokens(state.buckets)) continue
    const model = state.model ?? carryModel
    const durationMs = state.start !== null && state.end !== null ? state.end - state.start : null
    // TTFT：0.2.x 用流时间线首个 token；旧日志回退到首个 usage 样本。
    const outputStart = state.firstOutputAt ?? state.firstUsageAt
    const ttftMs = state.start !== null && outputStart !== null ? outputStart - state.start : null
    // TPS：0.2.x 用各条消息流的生成时长之和（不含工具执行与步骤间等待）；整段只有一个
    // token 片段时时长为 0，不报吞吐。旧日志（无流时间线）沿用首个 usage → turn 结束。
    const hasStream = state.firstOutputAt !== null
    const outputMs = hasStream
      ? state.streamOutputMs
      : state.end !== null && state.firstUsageAt !== null ? state.end - state.firstUsageAt : 0
    const outputTps = state.buckets.outputTokens > 0 && outputMs > 0 ? state.buckets.outputTokens / (outputMs / 1_000) : null
    const resolved = resolver.resolve(model)
    // 按轮次开始时刻推断高峰/空闲时段计费；时刻缺失（无 turn/start）时按高峰保守估算。
    // 双币种各算一份（官方 CNY / USD 刊例价），client 按显示币种选用。
    const cny = costSplitAt(state.buckets, resolved.pricing, state.start ?? state.end, 'cny')
    const usd = costSplitAt(state.buckets, resolved.pricing, state.start ?? state.end, 'usd')
    const cost: RoundCost = {
      cny,
      usd,
      estimated: resolved.estimated,
      unknownModel: !resolved.known,
      unpriced: resolved.unpriced,
      source: resolved.source,
      verifiedAt: resolved.verifiedAt,
    }
    rounds.push({
      turn,
      buckets: { ...state.buckets },
      model,
      startedAt: state.start,
      endedAt: state.end,
      durationMs,
      ttftMs,
      outputTps,
      endReason: state.endReason,
      userSource: state.userSource,
      cost,
    })
  }
  rounds.sort((a, b) => a.turn - b.turn)

  return { totals, rounds }
}

/**
 * v0.1 兼容出口：仅折叠四桶（语义与 foldRounds 一致，不做时序/模型/成本）。
 * 新代码请用 foldRounds。
 */
export function foldTurnUsage(events: readonly SessionEventLike[]): {
  totals: TokenUsageBuckets
  turns: Array<{ turn: number; buckets: TokenUsageBuckets }>
} {
  const { totals, rounds } = foldRounds(events)
  return {
    totals,
    turns: rounds.map((round) => ({ turn: round.turn, buckets: round.buckets })),
  }
}
