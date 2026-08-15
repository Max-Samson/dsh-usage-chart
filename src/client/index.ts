/**
 * 客户端半区入口：向 'conversation.composer.dock' 注册用量指示器，
 * 向 'conversation.chat.assistant-actions' 注册每轮成本徽章。
 * 指示器挂载后即出现在输入框下方（与官方 StatsLine 同槽位，order 1 排在其后）。
 *
 * 本地化（DSH locale 体系）：订阅 `locale` 服务的活动语言快照（getLocale +
 * subscribe），写入 i18n.ts 的 store；组件经 useUiLocale() 读取，随「设置 →
 * 语言」实时切换。可见文案只维护在 i18n.ts，避免平台注册字典与组件字典漂移。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { CostBadge } from './badge/CostBadge.tsx'
import { UsageIndicator } from './UsageIndicator.tsx'
import { initDisplayMeta } from './currency.ts'
import { injectPluginCss } from './styles.ts'
import { setUiLocale } from './i18n.ts'

export const name = 'dsh-usage-chart'

/** 依赖 slots 服务（槽位注册）与 locale 服务（活动语言订阅）。 */
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  injectPluginCss()

  // 成本显示币种：读 /meta 配置 + localStorage 用户选择。
  initDisplayMeta()

  // 活动语言：初始取平台快照（含宿主设置与浏览器推导），此后随快照切换。
  // 注意：locale.subscribe 的监听器无参调用（publish 里 fn()），需自行重读快照。
  const syncLocale = (): void => {
    setUiLocale(ctx.locale.getLocale().active === 'en' ? 'en' : 'zh')
  }
  syncLocale()
  ctx.effect(() => ctx.locale.subscribe(syncLocale), 'dsh-usage-chart: locale subscription')

  // 槽位注册等待声明（slots.inject）：直接 register 依赖加载顺序，顺序变化时
  // 会抛 `slot "…" is not declared`；inject 在声明出现时回调并经 fiber 卸载清理。
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    {
      name: 'conversation.composer.dock',
      id: 'dsh-usage-chart',
      order: 1,
      registrant: 'dsh-usage-chart',
    },
    UsageIndicator,
  ))

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    {
      name: 'conversation.chat.assistant-actions',
      id: 'dsh-usage-chart',
      order: 1,
      registrant: 'dsh-usage-chart',
    },
    CostBadge,
  ))
}
