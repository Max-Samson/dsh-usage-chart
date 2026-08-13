/**
 * 客户端半区入口：向 'conversation.composer.dock' 注册用量指示器。
 * 挂载后即出现在输入框下方（与官方 StatsLine 同槽位，order 1 排在其后）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UsageIndicator } from './UsageIndicator.tsx'
import { injectPluginCss } from './styles.ts'

export const name = 'dsh-usage-chart'

/** 依赖 slots 服务（槽位注册）。 */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  injectPluginCss()
  ctx.slots.register(
    {
      name: 'conversation.composer.dock',
      id: 'dsh-usage-chart',
      order: 1,
      registrant: 'dsh-usage-chart',
    },
    UsageIndicator,
  )
}
