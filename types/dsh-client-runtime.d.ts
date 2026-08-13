/**
 * 最小 @deepseek-ai/dsh-client-runtime/client 声明（vendored，见 cordis.d.ts 说明）。
 * 仅覆盖本插件用到的类型：ClientContext / SessionId / 投影钩子。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 会话 id（wire 上即字符串）。 */
export type SessionId = string

/** 会话投影表（token-meter 注册的两个 key；client 端 wire payload 即四桶合计）。 */
export interface SessionProjectionMap {
  tokenUsage: {
    uncachedInputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  contextPressure: {
    pressureTokens?: number
    projectedTokens?: number
    contextWindow?: number
  }
}

/** framework 第五钩子位：按键读投影（undefined = 能力缺失/无值）。 */
export type UseProjection = {
  <K extends keyof SessionProjectionMap & string>(key: K): SessionProjectionMap[K] | undefined
  <K extends keyof SessionProjectionMap & string, S>(
    key: K,
    selector: (value: SessionProjectionMap[K] | undefined) => S,
    eq?: (a: S, b: S) => boolean,
  ): S
}

/** 会话快照选择器钩子。 */
export type SnapshotSelectorHook<T> = <S>(
  selector: (state: T) => S,
  equalityFn?: (a: S, b: S) => boolean,
) => S

/** 浏览器端 cordis Context（含 slots 合并）。 */
export type ClientContext = Context
