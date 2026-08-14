import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package declares an installable DSH web bundle', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-locale'], '>=0.1.0-rc.6 <0.2.0')
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-locale'].optional, true)
})

test('all exported runtime and type files exist after build', async () => {
  const targets = [pkg.main, pkg.types]
  for (const value of Object.values(pkg.exports)) {
    if (typeof value === 'string') targets.push(value)
    else targets.push(...Object.values(value))
  }
  await Promise.all([...new Set(targets)].map((target) => access(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url))))
})
