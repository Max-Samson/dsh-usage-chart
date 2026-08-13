/**
 * 用量可视化面板（参考 DeepSeek 开发者平台 usage 页的信息组织）：
 *  1) 会话汇总  2) 成本估算  3) 每轮用量柱状图  4) 账户余额
 * 汇总数字来自官方 adapter 上报的 tokenUsage 投影；余额来自官方接口；
 * 每轮柱状图优先取宿主从会话日志折叠的完整历史（/dsh-usage-chart/usage），
 * 请求失败时回退到「本页观测」增量（如实标注）。
 */
import { useMemo } from 'react'
import type { TokenUsageBuckets } from '../pricing.ts'
import { billedInputTokens, cacheHitPercent, estimateCost, formatTokens, formatUsd, pricingFor } from '../pricing.ts'
import { currencySymbol, type BalanceData, type BalanceStatus } from './balance.ts'
import { HStack, Legend, TOKEN_LEGEND, TurnBars, type TurnUsage } from './charts.tsx'
import { useSessionUsage } from './usage-api.ts'

export interface ContextPressureView {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

export interface UsagePanelProps {
  sessionId: string | undefined
  totals: TokenUsageBuckets
  model: string | undefined
  /** 回退：本页观测的每轮增量（仅当宿主历史不可用时展示）。 */
  observedTurns: readonly TurnUsage[]
  pressure: ContextPressureView | undefined
  /** 余额状态由指示器共享（同一实例，避免重复查询）。 */
  balanceStatus: BalanceStatus
  balanceData: BalanceData | null
  loadBalance: () => Promise<void>
}

function occupancyPercent(pressure: ContextPressureView | undefined): number | null {
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined || pressure?.contextWindow === undefined || pressure.contextWindow <= 0) return null
  return Math.min(100, Math.round((used / pressure.contextWindow) * 100))
}

export function UsagePanel(props: UsagePanelProps): JSX.Element {
  const {
    sessionId, totals, model, observedTurns, pressure,
    balanceStatus: status, balanceData: data, loadBalance: load,
  } = props

  const usage = useSessionUsage(sessionId)

  const cost = useMemo(() => estimateCost(totals, model), [totals, model])
  const pricing = pricingFor(model)
  const inputCost =
    ((totals.uncachedInputTokens + totals.cacheWriteTokens) * pricing.pricing.cacheMissInput
      + totals.cacheReadTokens * pricing.pricing.cacheHitInput) / 1_000_000
  const outputCost = (totals.outputTokens * pricing.pricing.output) / 1_000_000
  const occupancy = occupancyPercent(pressure)
  const cacheHit = cacheHitPercent(totals)
  const hasTokens = billedInputTokens(totals) > 0 || totals.outputTokens > 0

  const balance = data?.balances?.[0]

  // 每轮柱状图数据：优先宿主折叠的完整历史；失败/加载中时回退本页观测。
  const historyTurns = usage.status === 'ok' ? usage.turns : null
  const chartTurns = historyTurns ?? observedTurns
  const chartSourceNote = historyTurns !== null
    ? '来自会话日志（adapter 上报），完整历史 · 点击刷新'
    : usage.status === 'error'
      ? `宿主历史不可用（${usage.error ?? '未知'}），已回退到本页观测增量。`
      : '加载会话日志历史…'

  return (
    <div className="duc-panel">
      <h4>会话用量汇总</h4>
      {hasTokens ? (
        <>
          <div className="duc-grid">
            <div className="duc-cell"><b>{formatTokens(billedInputTokens(totals))}</b><span>输入（计费）</span></div>
            <div className="duc-cell"><b>{formatTokens(totals.outputTokens)}</b><span>输出</span></div>
            <div className="duc-cell"><b>{cacheHit !== null ? `${cacheHit}%` : '–'}</b><span>缓存命中率</span></div>
            <div className="duc-cell"><b>{occupancy !== null ? `${occupancy}%` : '–'}</b><span>上下文占用</span></div>
          </div>
          <HStack
            segments={[
              { label: '输入(未命中)', value: totals.uncachedInputTokens, color: '#4d9fff' },
              { label: '输入(命中)', value: totals.cacheReadTokens, color: '#9ad4ff' },
              { label: '输出', value: totals.outputTokens, color: '#4ade80' },
            ]}
          />
          <Legend items={TOKEN_LEGEND} />
        </>
      ) : (
        <div className="duc-note">本会话暂无 adapter 上报的 token 用量（发送消息后实时更新）。</div>
      )}

      <h4>成本估算</h4>
      <div className="duc-grid">
        <div className="duc-cell">
          <b>{formatUsd(cost.usd)}</b>
          <span>{model !== undefined ? `模型 ${model}` : '模型未知'}{cost.estimated ? '（刊例价估算）' : ''}</span>
        </div>
      </div>
      <HStack
        segments={[
          { label: '输入成本', value: inputCost, color: '#4d9fff' },
          { label: '输出成本', value: outputCost, color: '#4ade80' },
        ]}
        width={200}
      />
      <div className="duc-note">按官方刊例价（{pricing.pricing.cacheMissInput}/1M 未命中输入 · {pricing.pricing.cacheHitInput}/1M 命中输入 · {pricing.pricing.output}/1M 输出，USD）估算，非官方账单。</div>

      <h4>每轮用量</h4>
      <TurnBars turns={chartTurns} />
      {chartTurns.length === 0
        ? <div className="duc-note">会话日志中暂无按轮次归类的用量（发送消息后自动绘制）。</div>
        : <><Legend items={TOKEN_LEGEND} /><div className="duc-note">{chartSourceNote}</div></>}
      {usage.status === 'ok' && (
        <button type="button" className="duc-refresh" onClick={() => void usage.load()}>刷新历史</button>
      )}

      <h4>账户余额（官方 /user/balance）</h4>
      {status === 'loading' && <div className="duc-note">查询中…</div>}
      {status === 'ok' && balance !== undefined && (
        <div className="duc-bal">
          <span className="amount">{currencySymbol(balance.currency)}{balance.totalBalance}</span>
          <span className="sub">可用额度（{balance.currency}）· 充值 {balance.toppedUpBalance} · 赠送 {balance.grantedBalance}</span>
          <span className="sub">{data?.isAvailable ? '余额充足' : '余额不足'}</span>
        </div>
      )}
      {(status === 'error' || status === 'idle') && data !== null && (
        <div className="duc-err">
          <span>{data.reason === 'no-api-key'
            ? '未配置 DEEPSEEK_API_KEY（或插件 config.apiKey），无法查询余额。'
            : `余额查询失败：${data.message ?? data.reason ?? '未知错误'}`}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </div>
      )}
      {status === 'idle' && data === null && (
        <div className="duc-note">点击上方余额可查询。</div>
      )}
    </div>
  )
}
