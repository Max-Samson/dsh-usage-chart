import { useSyncExternalStore } from 'react'

export type UiLocale = 'zh' | 'en'

export type RoundChartModeName = 'absolute' | 'ratio' | 'cost'

export interface UiCopy {
  input: string
  output: string
  cache: string
  cost: string
  balance: string
  usage: string
  expandUsage: string
  collapseUsage: string
  retryBalanceTitle: string
  officialBalanceTitle: string
  usageDetails: string
  sessionUsage: string
  billedInput: string
  cacheHit: string
  contextUsage: string
  unavailable: string
  sessionEmpty: string
  costEstimate: string
  inputCost: string
  outputCost: string
  pricingNote: (miss: string, hit: string, output: string, currencySuffix: string, source: string, verified: string) => string
  pricingSourceLabel: string
  pricingVerifiedLabel: string
  pricingFileLabel: string
  unknownModel: string
  costUnavailable: string
  roundUsage: string
  chartDisplay: string
  totalMode: string
  compositionMode: string
  costMode: string
  totalModeTitle: string
  compositionModeTitle: string
  costModeTitle: string
  refresh: string
  roundExplainer: string
  totalExplainer: string
  compositionExplainer: string
  costExplainer: string
  roundEmpty: string
  accountBalance: string
  loadingBalance: string
  balanceEnough: string
  balanceLow: string
  currency: string
  currencyToggleLabel: string
  currencyToggleUsdTitle: string
  currencyToggleCnyTitle: string
  refreshRate: string
  refreshingRate: string
  refreshRateTitle: string
  rateLive: (rate: number, time: string) => string
  rateError: (rate: number) => string
  toppedUp: string
  granted: string
  noApiKey: string
  balanceError: (message: string) => string
  unknown: string
  retry: string
  balanceIdle: string
  historySource: (count: number) => string
  historyFallback: (error: string) => string
  historyLoading: string
  roundsLabel: (count: number, mode: RoundChartModeName) => string
  currentRound: string
  roundLabel: (turn: number) => string
  roundTitle: (turn: number, current: boolean) => string
  roundTotalLabel: (turn: number, current: boolean, total: string) => string
  /** v1.0.0 横向滚动：查看更早轮次 / 回到最新轮次的箭头按钮标签。 */
  scrollEarlier: string
  scrollLatest: string
  segments: {
    miss: string
    hit: string
    output: string
    write: string
  }
  // v1.0.1：高峰/空闲时段 tag 与逐轮计费时段
  tierLabel: string
  tiers: {
    peak: string
    offPeak: string
  }
  tierWindow: {
    peak: string
    offPeak: string
  }
  // v0.2 解释卡 / 异常 / 徽章 / 压力条
  costLabel: string
  modelLabel: string
  duration: string
  ttft: string
  outputTps: string
  endReason: string
  endReasonLabel: (reason: string) => string
  estimatedMark: string
  anomaly: string
  anomalyReason: (reason: 'output-growth' | 'context-bloat' | 'cache-hit-drop') => string
  badgeCost: (cny: string) => string
  badgeTitle: string
  dismissBadge: string
  pressureBarTitle: (percent: number) => string
  pressureBarLabel: (percent: string) => string
}

const COPY: Record<UiLocale, UiCopy> = {
  zh: {
    input: '输入', output: '输出', cache: '缓存', cost: '成本', balance: '余额', usage: '用量',
    expandUsage: '展开用量面板', collapseUsage: '收起用量面板', retryBalanceTitle: '点击重试余额查询', officialBalanceTitle: '余额来自官方接口',
    usageDetails: '会话用量详情', sessionUsage: '会话用量', billedInput: '计费输入', cacheHit: '缓存命中', contextUsage: '上下文占用', unavailable: '暂无',
    sessionEmpty: '发送消息后，这里会显示当前会话的 Token 用量。',
    costEstimate: '成本估算', inputCost: '输入', outputCost: '输出',
    pricingNote: (miss, hit, output, currencySuffix, source, verified) => `刊例价（空闲/高峰）：未命中输入 ${miss}/1M，命中输入 ${hit}/1M，输出 ${output}/1M ${currencySuffix}。来源 ${source}${verified}。估算值，不代表官方账单。`,
    pricingSourceLabel: '价格来源', pricingVerifiedLabel: '核验于', pricingFileLabel: '覆盖文件', unknownModel: '未定价模型', costUnavailable: '价格快照不可用，无法估算成本。',
    roundUsage: '轮次用量', chartDisplay: '图表显示方式', totalMode: '总量', compositionMode: '构成', costMode: '成本',
    totalModeTitle: '按实际 Token 总量比较各轮消耗', compositionModeTitle: '将每轮统一为 100%，比较 Token 构成', costModeTitle: '按各桶 × 单价堆叠成本，柱顶为所选币种金额（按高峰/空闲时段计价）', refresh: '刷新',
    roundExplainer: '每根柱代表一轮提问与回答', totalExplainer: '柱高表示本轮 Token 总量', compositionExplainer: '每根柱统一为 100%，仅比较 Token 构成', costExplainer: '柱高表示本轮估算成本（按刊例价）',
    roundEmpty: '发送消息后，这里会按轮次绘制 Token 用量。',
    accountBalance: '账户余额', loadingBalance: '正在查询账户余额', balanceEnough: '余额充足', balanceLow: '余额不足',
    currency: '币种',
    currencyToggleLabel: '成本显示币种',
    currencyToggleUsdTitle: '成本按美元（USD）显示，选择会在本浏览器中记住',
    currencyToggleCnyTitle: '成本按人民币（CNY）显示，选择会在本浏览器中记住',
    refreshRate: '刷新汇率', refreshingRate: '获取中…', refreshRateTitle: '获取最新汇率并重新估算（本次会话有效）',
    rateLive: (rate, time) => `实时汇率已更新：1 USD = ${rate} CNY（${time} 获取，本次会话有效）`,
    rateError: (rate) => `实时汇率获取失败（网络不可达或汇率源被拦截），沿用 1 USD = ${rate} CNY。可在 config.fxUrl 配置其他汇率源。`,
    toppedUp: '充值', granted: '赠送', noApiKey: '未配置 DEEPSEEK_API_KEY（或插件 config.apiKey），无法查询余额。',
    balanceError: (message) => `余额查询失败：${message}`, unknown: '未知错误', retry: '重试', balanceIdle: '点击输入框下方的余额信息即可查询。',
    historySource: (count) => `来自会话日志，完整历史，共 ${count} 轮${count > 12 ? '，可左右滑动查看更早轮次' : ''}`,
    historyFallback: (error) => `宿主历史不可用（${error}），已回退到本页观测增量。`, historyLoading: '加载会话日志历史…',
    roundsLabel: (count, mode) => `共 ${count} 轮用量，${mode === 'absolute' ? '总量' : mode === 'ratio' ? '构成' : '成本'}视图`,
    currentRound: '当前', roundLabel: (turn) => `轮 ${turn}`,
    roundTitle: (turn, current) => current ? (turn === -1 ? '当前轮' : `当前 · 第 ${turn} 轮`) : `第 ${turn} 轮`,
    roundTotalLabel: (turn, current, total) => `${current ? (turn === -1 ? '当前轮' : `第 ${turn} 轮，当前`) : `第 ${turn} 轮`}，总量 ${total}`,
    scrollEarlier: '查看更早轮次', scrollLatest: '回到最新轮次',
    segments: { miss: '未命中输入', hit: '缓存输入', output: '模型输出', write: '写入缓存' },
    tierLabel: '计费时段',
    tiers: { peak: '高峰时段', offPeak: '空闲时段' },
    tierWindow: { peak: '北京时间 09:00–12:00、14:00–18:00，按 2 倍计费', offPeak: '其余时间，按高峰价的一半计费' },
    costLabel: '本轮成本', modelLabel: '模型', duration: '总耗时', ttft: 'TTFT', outputTps: '输出速率', endReason: '结束原因',
    endReasonLabel: (reason) => ({
      completed: '完成', aborted: '中断', blocked: '阻塞', error: '出错', 'max-tokens': '达上限', interrupted: '被打断',
    }[reason] ?? reason),
    estimatedMark: '≈估算', anomaly: '成本异常', anomalyReason: (reason) => ({
      'output-growth': '输出增长', 'context-bloat': '上下文膨胀', 'cache-hit-drop': '缓存命中下降',
    }[reason]),
    badgeCost: (cny) => `本轮 ≈ ${cny}`,
    badgeTitle: '本轮成本估算（官方刊例价），点击关闭',
    dismissBadge: '关闭成本徽章',
    pressureBarTitle: (percent) => `上下文压力 ${percent}%`,
    pressureBarLabel: (percent) => `上下文 ${percent}`,
  },
  en: {
    input: 'Input', output: 'Output', cache: 'Cache', cost: 'Cost', balance: 'Balance', usage: 'Usage',
    expandUsage: 'Expand usage panel', collapseUsage: 'Collapse usage panel', retryBalanceTitle: 'Retry balance query', officialBalanceTitle: 'Balance from the official API',
    usageDetails: 'Session usage details', sessionUsage: 'Session usage', billedInput: 'Billed input', cacheHit: 'Cache hit', contextUsage: 'Context used', unavailable: 'N/A',
    sessionEmpty: 'Token usage will appear after you send a message.',
    costEstimate: 'Estimated cost', inputCost: 'Input', outputCost: 'Output',
    pricingNote: (miss, hit, output, currencySuffix, source, verified) => `List price (off-peak/peak): cache-miss input ${miss}/1M, cache-hit input ${hit}/1M, output ${output}/1M ${currencySuffix}. Source: ${source}${verified}. Estimate only, not an official bill.`,
    pricingSourceLabel: 'Price source', pricingVerifiedLabel: 'Verified', pricingFileLabel: 'Override file', unknownModel: 'Unpriced model', costUnavailable: 'Price snapshot unavailable; cost cannot be estimated.',
    roundUsage: 'Usage by round', chartDisplay: 'Chart display', totalMode: 'Total', compositionMode: 'Mix', costMode: 'Cost',
    totalModeTitle: 'Compare rounds by actual Token usage', compositionModeTitle: 'Normalize each round to 100% and compare Token mix', costModeTitle: 'Stack cost by bucket × unit price; bar top shows the selected currency (peak/off-peak tiered)', refresh: 'Refresh',
    roundExplainer: 'Each bar represents one prompt and response', totalExplainer: 'Bar height shows total Tokens for the round', compositionExplainer: 'Each bar is normalized to 100% to compare Token mix', costExplainer: 'Bar height shows the estimated cost of the round',
    roundEmpty: 'Per-round Token usage will appear after you send a message.',
    accountBalance: 'Account balance', loadingBalance: 'Loading account balance', balanceEnough: 'Available', balanceLow: 'Insufficient',
    currency: 'Currency',
    currencyToggleLabel: 'Cost display currency',
    currencyToggleUsdTitle: 'Show cost in USD; remembered in this browser',
    currencyToggleCnyTitle: 'Show cost in CNY; remembered in this browser',
    refreshRate: 'Refresh rate', refreshingRate: 'Fetching…', refreshRateTitle: 'Fetch the latest exchange rate and re-estimate (valid for this session)',
    rateLive: (rate, time) => `Live rate updated: 1 USD = ${rate} CNY (fetched at ${time}, valid for this session)`,
    rateError: (rate) => `Could not fetch the live rate (network unreachable or the FX source is blocked); keeping 1 USD = ${rate} CNY. Configure config.fxUrl for another source.`,
    toppedUp: 'Topped up', granted: 'Granted', noApiKey: 'DEEPSEEK_API_KEY (or plugin config.apiKey) is not configured, so the balance cannot be queried.',
    balanceError: (message) => `Balance query failed: ${message}`, unknown: 'Unknown error', retry: 'Retry', balanceIdle: 'Select the balance below the composer to query it.',
    historySource: (count) => `Full history from the session log · ${count} rounds${count > 12 ? '; scroll horizontally for earlier rounds' : ''}`,
    historyFallback: (error) => `Host history unavailable (${error}); showing usage observed on this page.`, historyLoading: 'Loading session history…',
    roundsLabel: (count, mode) => `Usage across ${count} rounds, ${mode === 'absolute' ? 'total' : mode === 'ratio' ? 'mix' : 'cost'} view`,
    currentRound: 'Current', roundLabel: (turn) => `R${turn}`,
    roundTitle: (turn, current) => current ? (turn === -1 ? 'Current round' : `Current · Round ${turn}`) : `Round ${turn}`,
    roundTotalLabel: (turn, current, total) => `${current ? (turn === -1 ? 'Current round' : `Round ${turn}, current`) : `Round ${turn}`}, total ${total}`,
    scrollEarlier: 'View earlier rounds', scrollLatest: 'Go to latest rounds',
    segments: { miss: 'Cache-miss input', hit: 'Cached input', output: 'Model output', write: 'Cache write' },
    tierLabel: 'Billing tier',
    tiers: { peak: 'Peak', offPeak: 'Off-peak' },
    tierWindow: { peak: 'Beijing time 09:00–12:00 & 14:00–18:00, billed at 2×', offPeak: 'all other hours, billed at half the peak rate' },
    costLabel: 'Round cost', modelLabel: 'Model', duration: 'Duration', ttft: 'TTFT', outputTps: 'Output rate', endReason: 'End reason',
    endReasonLabel: (reason) => ({
      completed: 'Completed', aborted: 'Aborted', blocked: 'Blocked', error: 'Error', 'max-tokens': 'Max tokens', interrupted: 'Interrupted',
    }[reason] ?? reason),
    estimatedMark: '≈est.', anomaly: 'Cost anomaly', anomalyReason: (reason) => ({
      'output-growth': 'Output growth', 'context-bloat': 'Context bloat', 'cache-hit-drop': 'Cache hit drop',
    }[reason]),
    badgeCost: (cny) => `≈ ${cny} this round`,
    badgeTitle: 'Estimated cost of this round (official list price); click to dismiss',
    dismissBadge: 'Dismiss cost badge',
    pressureBarTitle: (percent) => `Context pressure ${percent}%`,
    pressureBarLabel: (percent) => `Context ${percent}`,
  },
}

export function detectUiLocale(candidates: readonly string[]): UiLocale {
  const language = candidates.find((candidate) => candidate.trim() !== '')?.toLowerCase() ?? ''
  return language.startsWith('zh') ? 'zh' : 'en'
}

// ── 活动语言源：DSH locale 服务 ─────────────────────────────────────────────
// DSH web 的 <html lang> 是静态的（index.html 模板），不会随「设置 → 语言」
// 切换而更新；浏览器嗅探也无法覆盖应用内偏好。因此活动语言由插件 apply 里
// 订阅 `ctx.locale`（getLocale 初始值 + subscribe 快照变更）写入下面的模块级
// store，组件经 useSyncExternalStore 读取。初始值先用浏览器语言兜底，
// 平台快照一到即被覆盖（平台 provisional 本身也做浏览器推导）。
let current: UiLocale = detectUiLocale(
  typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language],
)
const listeners = new Set<() => void>()

/** 读取当前活动语言（订阅源的 getSnapshot）。 */
export function getUiLocale(): UiLocale {
  return current
}

/** 写入活动语言（仅插件 apply 的 locale 订阅调用；相同值不通知）。 */
export function setUiLocale(locale: UiLocale): void {
  if (locale === current) return
  current = locale
  for (const listener of [...listeners]) listener()
}

/** 订阅活动语言变化（返回退订函数）。 */
export function subscribeUiLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 组件读活动语言：跟随平台设置切换（zh/en），无需 props 透传。 */
export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeUiLocale, getUiLocale)
}

export function getUiCopy(locale: UiLocale): UiCopy {
  return COPY[locale]
}
