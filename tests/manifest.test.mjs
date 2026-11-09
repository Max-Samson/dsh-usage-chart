import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

test('npm lockfile root metadata matches the package manifest', () => {
  assert.equal(lock.name, pkg.name)
  assert.equal(lock.version, pkg.version)
  for (const key of ['name', 'version', 'engines', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    assert.deepEqual(lock.packages[''][key], pkg[key], `lockfile root ${key} must match package.json`)
  }
})

test('README screenshots exist and are included in the published files', async () => {
  for (const file of ['README.md', 'README_ZH.md']) {
    const markdown = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    const images = [...markdown.matchAll(/<img\b[^>]*\bsrc="\.\/([^"#?]+)"/g)]
    assert.ok(images.length > 0, `${file} must contain preview screenshots`)
    for (const [, path] of images) {
      assert.ok(pkg.files.includes(path), `${file}: ${path} must be listed in package.json files`)
      await access(new URL(`../${path}`, import.meta.url))
    }
  }
})

/**
 * DSH 客户端包 peer：范围必须同时容纳 0.1.x（如 0.1.0-rc.6）与 0.2.x（如 0.2.1-rc.2）。
 * DSH 门禁用 semver.satisfies(runtime, range, { includePrerelease: true }) 比较运行时版本，
 * 因此上界写成 <0.3.0-0：既接受 0.2.x 预发布，又不会把未来 0.3.0-rc.x 提前放行。
 * 不要用 engines.dsh 替代——声明 engines.dsh 会让 DSH 跳过 peerDependencies 范围检查。
 */
const CLIENT_PEERS = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots',
]

test('package declares an installable DSH web bundle', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.keywords.includes('dsh-plugin'))
})

test('client peer ranges admit DSH 0.1.x and 0.2.x runtimes', () => {
  for (const name of CLIENT_PEERS) {
    assert.equal(pkg.peerDependencies[name], '>=0.1.0-rc.6 <0.3.0-0')
    assert.equal(pkg.peerDependenciesMeta[name]?.optional, true)
  }
  // DSH 0.2.0 起 @deepseek-ai/dsh-client-runtime 已退役（最后版本 0.1.1-rc.2）：
  // 它不再有可被检查的运行时含义，客户端类型也不得再 import 它。
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.ok(!pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.equal(pkg.engines?.dsh, undefined)
})

test('built client bundle stays free of the retired client runtime', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(bundle.includes('__ModuleLoader__.load'), 'client bundle must register through the DSH module loader')
  assert.ok(!/require\(['"]@deepseek-ai\/dsh-client-runtime/.test(bundle), 'client bundle must not require the retired dsh-client-runtime package')
  // 扫描全部发布的 client 声明文件，而不只是入口
  const typesDir = new URL('../lib/types/client/', import.meta.url)
  const declarations = (await readdir(typesDir, { recursive: true })).filter((file) => file.endsWith('.d.ts'))
  assert.ok(declarations.length > 1, 'client declarations must be emitted')
  for (const file of declarations) {
    const text = await readFile(new URL(file, typesDir), 'utf8')
    assert.ok(!/from ['"]@deepseek-ai\/dsh-client-runtime/.test(text), `${file} must not import the retired dsh-client-runtime package`)
  }
})

test('all exported runtime and type files exist after build', async () => {
  const targets = [pkg.main, pkg.types]
  for (const value of Object.values(pkg.exports)) {
    if (typeof value === 'string') targets.push(value)
    else targets.push(...Object.values(value))
  }
  await Promise.all([...new Set(targets)].map((target) => access(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url))))
})

/** 当前版本入口必须同步；历史版本条目不替换，也不把源码版本当作已发布证明。 */
test('current release version is reflected in both changelogs and upgrade documentation', async () => {
  for (const file of ['CHANGELOG.md', 'CHANGELOG_ZH.md']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    const firstVersion = text.match(/^## \[([^\]]+)\]/m)?.[1]
    assert.equal(firstVersion, pkg.version, `${file}: first release must match package.json`)
  }
  for (const file of ['README.md', 'README_ZH.md']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.ok(text.includes(`dsh-usage-chart@${pkg.version}`), `${file}: pinned upgrade version must match package.json`)
    assert.ok(text.includes(`v${pkg.version}`), `${file}: describe the current source version`)
  }
})
