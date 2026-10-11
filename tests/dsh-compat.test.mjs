/**
 * DSH 运行时兼容性门禁——把"假绿"换成真检查。
 *
 * DSH 启动时会用 dsh-app-boot 的 evaluatePluginCompatibility 判定每个 profile bundle 的
 * peerDependencies；判为不兼容的 bundle 会被整包跳过，用量面板与全部路由一起消失，
 * 只在 dsh web 的 stderr 留一行。本文件直接调用同一个函数，对着插件自己的 manifest 断言
 * 声明仍然成立，并且**覆盖各线正式版**（0.2.0 / 0.2.1），而不只是 rc —— "<0.2.0" 那个区间
 * 正是"rc 通过、正式版被拒"，也就是这里要拦住的东西。
 *
 * 解析不到 DSH 安装时跳过：插件自身的 CI 只装插件，不装 DSH。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** 声明支持的 DSH 运行时版本（含各线正式版）。 */
const SUPPORTED = ['0.1.0-rc.6', '0.1.5', '0.1.9', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1']
/** 明确不支持、必须被拒的版本；要放宽区间就先改这里。 */
const REJECTED = ['0.3.0']

/** 候选 DSH 安装根（DSH_CHECKOUT 优先，其次本机全局安装）。 */
const DSH_ROOTS = [process.env.DSH_CHECKOUT, '/usr/local/lib/node_modules/@deepseek-ai/dsh'].filter(Boolean)

/** 取真正的判定函数与提供它的 DSH 根；取不到返回 undefined（CI 上正常）。 */
async function loadDsh() {
  for (const base of DSH_ROOTS) {
    try {
      const req = createRequire(join(base, 'package.json'))
      const entry = req.resolve('@deepseek-ai/dsh-app-boot')
      return { root: base, module: await import(pathToFileURL(entry).href) }
    } catch {
      // 换下一个候选
    }
  }
  return undefined
}

const dsh = await loadDsh()
const skip = dsh === undefined ? 'DSH is not installed in this environment' : false

test('peerDependencies accept every supported DSH runtime', { skip }, () => {
  for (const version of SUPPORTED) {
    const issue = dsh.module.evaluatePluginCompatibility(manifest, {}, version)
    assert.equal(issue, undefined, `dsh ${version} rejects ${JSON.stringify(issue?.peers ?? {})}`)
  }
})

test('peerDependencies still reject runtimes outside the declared lines', { skip }, () => {
  for (const version of REJECTED) {
    const issue = dsh.module.evaluatePluginCompatibility(manifest, {}, version)
    assert.notEqual(issue, undefined, `dsh ${version} is accepted but the plugin declares no support for it`)
  }
})

test('every DSH package the manifest names is installed in the target DSH', { skip }, () => {
  const named = [...Object.keys(manifest.peerDependencies ?? {}), ...(manifest.dsh?.client?.inject ?? [])]
  const req = createRequire(join(dsh.root, 'package.json'))
  const missing = [...new Set(named)].filter((name) => {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) return false
    for (const specifier of [`${name}/package.json`, name]) {
      try {
        req.resolve(specifier)
        return false
      } catch {
        // 试下一个 specifier
      }
    }
    return true
  })
  assert.deepEqual(missing, [], `declared but absent from DSH ${dsh.module.getDshRuntimeVersion()}`)
})
