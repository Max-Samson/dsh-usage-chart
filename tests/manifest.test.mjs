import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package declares an installable DSH web bundle', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  // 区间语义由 tests/dsh-compat.test.mjs 对着 DSH 自己的门禁校验；这里只锁声明形状。
  for (const name of ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-slots']) {
    assert.equal(typeof pkg.peerDependencies[name], 'string', name)
    assert.equal(pkg.peerDependenciesMeta[name].optional, true, name)
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
