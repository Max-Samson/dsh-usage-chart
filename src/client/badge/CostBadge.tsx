/**
 * CostBadge（v0.2）：assistant 消息尾部的可关闭「本轮 ≈ $0.00xx」徽章。
 *
 * 挂 `conversation.chat.assistant-actions` 槽位（每轮助手消息尾部）。
 * 数据来自 HistoryFeed（host /usage 折叠的完整历史，含每轮成本）；
 * messageId → 快照节点 → turn → 该轮成本。历史不可用时保持隐藏。
 */
import { useMemo, useState } from 'react'
import { formatUsd } from '../../pricing/calc.ts'
import { getUiCopy, useUiLocale } from '../i18n.ts'
import { useHistoryRounds } from '../rounds/history.ts'
import { snapshotNodes, type ConversationSnapshot } from '../snapshot.ts'

export interface CostBadgeProps {
  messageId: string | undefined
  /** 会话快照选择器（framework 标准套件）。 */
  useSession: <S>(selector: (s: ConversationSnapshot) => S) => S
  /** 投影读取钩子（framework 标准套件；徽章暂不使用，保留签名一致性）。 */
  useProjection: (key: string) => unknown
  sessionId: string
}

export function CostBadge(props: CostBadgeProps): JSX.Element | null {
  const { messageId, useSession, sessionId } = props
  const locale = useUiLocale()
  const copy = getUiCopy(locale)
  const [dismissed, setDismissed] = useState(false)

  const nodes = useSession((s) => snapshotNodes(s))

  const turn = useMemo(() => {
    if (messageId === undefined) return null
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (node.kind !== 'assistant') continue
      if (node.messageId === messageId) return node.turn
    }
    return null
  }, [messageId, nodes])

  const history = useHistoryRounds(sessionId)

  const round = useMemo(() => {
    if (turn === null || history.status !== 'ok') return null
    return history.rounds.find((r) => r.turn === turn) ?? null
  }, [turn, history.status, history.rounds])

  if (dismissed || round === null || round.cost === null || round.cost.totalUsd <= 0) return null

  return (
    <button
      type="button"
      className={`duc-badge${round.cost.estimated ? ' duc-badge-est' : ''}${round.cost.unknownModel ? ' duc-badge-unknown' : ''}`}
      title={copy.badgeTitle}
      aria-label={`${copy.badgeCost(formatUsd(round.cost.totalUsd))}${round.cost.estimated ? ` (${copy.estimatedMark})` : ''}. ${copy.dismissBadge}.`}
      onClick={() => setDismissed(true)}
    >
      {copy.badgeCost(formatUsd(round.cost.totalUsd))}
      {round.cost.estimated && <span className="duc-badge-mark">{copy.estimatedMark}</span>}
    </button>
  )
}
