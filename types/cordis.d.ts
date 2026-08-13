/**
 * 最小 cordis Context 声明（自包含 vendored 类型）。
 *
 * 说明：DSH 的客户端包（dsh-client-runtime / dsh-client-ui-slots 等）尚未
 * 对外发布稳定版本（npm 上仅 0.0.1-rc.1），因此本插件按「运行中的
 * dsh@0.1.0-rc.6」实际暴露的 API 形状 vendored 了所需的最小类型。
 * 宿主代码只做 type-only import，构建时被擦除，不影响运行。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** dsh-host-webserver 的 webServer 服务（仅声明本插件用到的面）。 */
export interface WebServer {
  readonly port: number
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** ui-slots 槽位注册选项（本插件用到的子集）。 */
export interface SlotRegisterOptions {
  name: string
  id?: string
  order?: number
  priority?: number
  registrant?: string
  locale?: string
}

/** ui-slots 的 SlotRegistry 服务（register 返回卸载函数）。 */
export interface SlotRegistry {
  register(options: SlotRegisterOptions, component: unknown): () => void
}

/** 会话日志事件的最小形状（assistant/chunk 与 assistant/message 携带 turn/step/usage）。 */
export interface SessionEventLike {
  type: string
  seq: number
  data: {
    turn?: number
    step?: number
    usage?: unknown
    chunk?: { type?: string; usage?: unknown }
  }
}

/** dsh-session 的 SessionStore 服务（仅声明本插件用到的面）。 */
export interface SessionStoreService {
  /** 按 id 查实时会话；不存在返回 undefined。 */
  get(id: string): { id: string; events: readonly SessionEventLike[] } | undefined
  /** 所有实时会话（创建顺序）。 */
  list(): { id: string; events: readonly SessionEventLike[] }[]
}

/** cordis Context（本插件用到的面：effect + webServer + slots + sessions；均因 inject 声明而保证存在）。 */
export interface Context {
  /** 注册一个资源释放器，插件卸载时执行。 */
  effect(disposer: () => (() => void) | void, label?: string): void
  webServer: WebServer
  slots: SlotRegistry
  sessions: SessionStoreService
  [key: string]: unknown
}
