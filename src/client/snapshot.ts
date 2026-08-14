/**
 * 客户端运行时数据形状（自包含、与 DSH 0.1.0-rc.6 web 运行时一致的最小声明）。
 * 仅描述本插件实际读取的字段；真实类型来自
 * @deepseek-ai/dsh-client-runtime/client（会话快照）与 @deepseek-ai/dsh-session（事件）。
 */

/** 会话 id（wire 上即字符串）。 */
export type SessionId = string

/** 会话快照中的节点（本插件只读取 kind/turn/provenance/requestConfig/messageId）。 */
export interface ConversationNode {
  kind: string
  seq: number
  turn: number
  step?: number
  time?: number
  /** 完成请求的稳定模型身份（adapter 上报）。 */
  provenance?: { provider: string; model: string }
  requestConfig?: { provider?: string; model?: string }
  /** 稳定消息身份（assistant 节点；CostBadge 用 messageId → turn 归因）。 */
  messageId?: string
  blocks?: readonly unknown[]
  content?: readonly unknown[]
}

/** 会话快照（ConversationSnapshot 的子集）。 */
export interface ConversationSnapshot {
  sessionId: SessionId
  /** 兼容字段：完整节点列表（含 user/assistant/tool 等）。 */
  nodes: readonly ConversationNode[]
  /** rc.6 实际填充节点列表的位置（官方 StatsLine 读这里）。 */
  chat: {
    legacy: {
      nodes: readonly ConversationNode[]
    }
  }
  running: boolean
  blank: boolean
  removed: boolean
  composerPhase: unknown
  [key: string]: unknown
}

/** 从快照取节点列表：优先 chat.legacy.nodes（rc.6 实际路径），回退顶层 nodes。 */
export function snapshotNodes(snapshot: ConversationSnapshot): readonly ConversationNode[] {
  const legacy = snapshot.chat?.legacy?.nodes
  if (Array.isArray(legacy) && legacy.length > 0) return legacy
  return Array.isArray(snapshot.nodes) ? snapshot.nodes : []
}
