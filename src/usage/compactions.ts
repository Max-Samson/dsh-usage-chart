/**
 * CompactionFold（host 半区，深模块）：从会话日志折叠上下文压缩事件。
 *
 * 小接口：`foldCompactions(events, resolvePricing?) → CompactionRecord[]`。
 * 大实现：监听 `compaction/start`、`compaction/summary`、`compaction/prune`、
 * `compaction/end`，提取裁剪范围（shadowedRange）、释放 Token 规模（shadowedTokenCount）、
 * 归属轮次、摘要生成模型及 summarize 过程产生的 Token 消耗与成本分拆。
 *
 * 纯函数：不发网络请求、不读文件；价格解析器由调用方注入（接缝），缺省用内置价表。
 */
import type { CostSplit, TokenUsageBuckets } from '../pricing/calc.ts'
import { costSplitAt } from '../pricing/calc.ts'
import type { PricingResolver } from '../pricing/resolve.ts'
import { createPricingResolver } from '../pricing/resolve.ts'
import type { RoundCost, SessionEventLike } from './rounds.ts'

export interface CompactionRecord {
  /** 压缩事件序列号 */
  seq: number
  /** 压缩开始时刻（epoch 毫秒） */
  startedAt: number | null
  /** 压缩完成时刻（epoch 毫秒） */
  endedAt: number | null
  /** 发生压缩时所处的轮次（按事件序归因） */
  turn: number | null
  /** 压缩裁剪/释放的 Token 数量 */
  shadowedTokenCount: number
  /** 裁剪的消息/事件范围（起始与结束 seq） */
  shadowedRange: { start: number; end: number } | null
  /** 裁剪的 seq 列表（若有） */
  shadowedSeqs: readonly number[] | null
  /** 生成摘要所使用的模型 */
  model: string | null
  /** 生成摘要消耗的 Token 四桶（若有） */
  summarizeUsage: TokenUsageBuckets | null
  /** 生成摘要产生的成本估算（双币种） */
  cost: RoundCost | null
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

interface OpenCompaction {
  seq: number
  startedAt: number | null
  turn: number | null
  shadowedTokenCount: number
  shadowedRange: { start: number; end: number } | null
  shadowedSeqs: number[] | null
  model: string | null
  summarizeUsage: TokenUsageBuckets | null
}

/**
 * 从会话日志事件流折叠压缩记录列表。
 * @param events - 按 seq 升序排列的会话事件
 * @param resolvePricing - 价格解析器（接缝注入，默认使用内置表）
 */
export function foldCompactions(
  events: readonly SessionEventLike[],
  resolvePricing?: PricingResolver,
): CompactionRecord[] {
  const resolver = resolvePricing ?? createPricingResolver()
  const compactions: CompactionRecord[] = []
  let currentTurn: number | null = null
  let active: OpenCompaction | null = null

  for (const event of events) {
    const { type, seq, time, data } = event

    if (type === 'turn/start') {
      currentTurn = data.turn ?? null
    } else if (type === 'turn/end') {
      if (currentTurn === (data.turn ?? null)) {
        // 当前轮结束
      }
    } else if (type === 'compaction/start') {
      active = {
        seq,
        startedAt: time,
        turn: currentTurn,
        shadowedTokenCount: 0,
        shadowedRange: null,
        shadowedSeqs: null,
        model: null,
        summarizeUsage: null,
      }
    } else if (type === 'compaction/summary') {
      const summaryData = data as Record<string, unknown>
      const shadowedTokenCount = typeof summaryData.shadowedTokenCount === 'number' && summaryData.shadowedTokenCount > 0
        ? summaryData.shadowedTokenCount
        : 0
      const range = summaryData.shadowedRange as { start?: number; end?: number } | undefined
      const shadowedRange = range !== undefined && typeof range.start === 'number' && typeof range.end === 'number'
        ? { start: range.start, end: range.end }
        : null
      const seqs = Array.isArray(summaryData.shadowedSeqs)
        ? summaryData.shadowedSeqs.filter((s): s is number => typeof s === 'number')
        : null
      const model = typeof summaryData.model === 'string' && summaryData.model.trim() !== ''
        ? summaryData.model.trim()
        : null
      const usage = bucketsOf(summaryData.usage)

      if (active !== null) {
        active.shadowedTokenCount = shadowedTokenCount
        active.shadowedRange = shadowedRange
        active.shadowedSeqs = seqs
        active.model = model
        active.summarizeUsage = usage
      } else {
        // 容错：没有 compaction/start 仅有 compaction/summary
        active = {
          seq,
          startedAt: time,
          turn: currentTurn,
          shadowedTokenCount,
          shadowedRange,
          shadowedSeqs: seqs,
          model,
          summarizeUsage: usage,
        }
      }
    } else if (type === 'compaction/end' || (active !== null && type === 'compaction/prune' && active.shadowedTokenCount > 0)) {
      if (active !== null) {
        let cost: RoundCost | null = null
        if (active.summarizeUsage !== null) {
          const resolved = resolver.resolve(active.model)
          const cny: CostSplit = costSplitAt(active.summarizeUsage, resolved.pricing, active.startedAt ?? time, 'cny')
          const usd: CostSplit = costSplitAt(active.summarizeUsage, resolved.pricing, active.startedAt ?? time, 'usd')
          cost = {
            cny,
            usd,
            estimated: resolved.estimated,
            unknownModel: !resolved.known,
            source: resolved.source,
            verifiedAt: resolved.verifiedAt,
          }
        }

        compactions.push({
          seq: active.seq,
          startedAt: active.startedAt,
          endedAt: time,
          turn: active.turn,
          shadowedTokenCount: active.shadowedTokenCount,
          shadowedRange: active.shadowedRange,
          shadowedSeqs: active.shadowedSeqs,
          model: active.model,
          summarizeUsage: active.summarizeUsage,
          cost,
        })
        active = null
      }
    }
  }

  // 兜底：未收到 compaction/end 但有活跃的 summary 记录
  if (active !== null && active.shadowedTokenCount > 0) {
    let cost: RoundCost | null = null
    if (active.summarizeUsage !== null) {
      const resolved = resolver.resolve(active.model)
      const cny: CostSplit = costSplitAt(active.summarizeUsage, resolved.pricing, active.startedAt, 'cny')
      const usd: CostSplit = costSplitAt(active.summarizeUsage, resolved.pricing, active.startedAt, 'usd')
      cost = {
        cny,
        usd,
        estimated: resolved.estimated,
        unknownModel: !resolved.known,
        source: resolved.source,
        verifiedAt: resolved.verifiedAt,
      }
    }
    compactions.push({
      seq: active.seq,
      startedAt: active.startedAt,
      endedAt: null,
      turn: active.turn,
      shadowedTokenCount: active.shadowedTokenCount,
      shadowedRange: active.shadowedRange,
      shadowedSeqs: active.shadowedSeqs,
      model: active.model,
      summarizeUsage: active.summarizeUsage,
      cost,
    })
  }

  return compactions
}
