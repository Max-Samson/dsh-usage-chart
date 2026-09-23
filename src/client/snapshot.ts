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

/** chat 快照（0.1.2+ 会话作用域标准源 'chat' 的形状，只取本插件需要的 legacy 切片）。 */
export interface ChatSnapshotLike {
  legacy?: { nodes?: readonly ConversationNode[] }
}

/** 标准源 hook（槽位套件把 'chat' 源包成 useChat 注入组件 props）。 */
export type ChatNodesHook = (selector: (snapshot: ChatSnapshotLike) => unknown) => unknown

export type SessionHook = <S>(selector: (snapshot: ConversationSnapshot) => S) => S

/** chat 源缺席时的占位实现（保持 Hook 调用顺序稳定）。 */
const NO_CHAT_NODES: ChatNodesHook = () => undefined

/** 从快照取节点列表：优先 chat.legacy.nodes（rc.6 实际路径），回退顶层 nodes。 */
export function snapshotNodes(snapshot: ConversationSnapshot): readonly ConversationNode[] {
  const legacy = snapshot.chat?.legacy?.nodes
  if (Array.isArray(legacy) && legacy.length > 0) return legacy
  return Array.isArray(snapshot.nodes) ? snapshot.nodes : []
}

/**
 * 读会话节点：0.1.2 起 chat 快照是独立标准源（props.useChat.legacy.nodes），
 * 不再挂在会话快照上；会话快照旧路径仅作回退（旧平台）。
 */
export function useSessionNodes(useChat: ChatNodesHook | undefined, useSession: SessionHook): readonly ConversationNode[] {
  // 两个 hook 必须无条件按固定顺序调用：任一条路径少调一次会错位后续 hook 状态
  // （症状是 useMemo 的 prevDeps 变成 undefined，报 "reading 'length'"）。
  const fromChat = (useChat ?? NO_CHAT_NODES)((snapshot) => snapshot.legacy?.nodes)
  const fromSession = useSession((snapshot) => snapshot)
  return Array.isArray(fromChat) && fromChat.length > 0 ? fromChat as readonly ConversationNode[] : snapshotNodes(fromSession)
}
