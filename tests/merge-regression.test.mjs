import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

async function loadClientModule(path) {
  const result = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

const [{ useSessionNodes }, { sumRoundCosts }] = await Promise.all([
  loadClientModule('../src/client/snapshot.ts'),
  loadClientModule('../src/client/rounds/types.ts'),
])

test('chat nodes take priority in DSH 0.1.2+ while both hooks keep a stable call order', () => {
  const calls = []
  const chatNodes = [{ kind: 'assistant', turn: 2, messageId: 'new' }]
  const oldNodes = [{ kind: 'assistant', turn: 1, messageId: 'old' }]
  const nodes = useSessionNodes(
    (selector) => { calls.push('chat'); return selector({ legacy: { nodes: chatNodes } }) },
    (selector) => { calls.push('session'); return selector({ nodes: oldNodes }) },
  )
  assert.equal(nodes, chatNodes)
  assert.deepEqual(calls, ['chat', 'session'])
})

test('session nodes remain available when the chat source is absent or empty', () => {
  const oldNodes = [{ kind: 'assistant', turn: 1, messageId: 'old' }]
  const useSession = (selector) => selector({ chat: { legacy: { nodes: oldNodes } }, nodes: [] })
  assert.equal(useSessionNodes(undefined, useSession), oldNodes)
  assert.equal(useSessionNodes((selector) => selector({ legacy: { nodes: [] } }), useSession), oldNodes)
})

test('session cost sums each round in its own currency and carries the estimate flag', () => {
  const rounds = [
    { cost: { cny: { input: 2, cacheRead: 0.1, output: 1, total: 3.1 }, usd: { input: 0.3, cacheRead: 0.01, output: 0.1, total: 0.41 }, estimated: false } },
    { cost: { cny: { input: 1, cacheRead: 0.2, output: 2, total: 3.2 }, usd: { input: 0.1, cacheRead: 0.02, output: 0.2, total: 0.32 }, estimated: true } },
  ]
  assert.deepEqual(sumRoundCosts(rounds, 'cny'), { input: 3, cacheRead: 0.30000000000000004, output: 3, total: 6.300000000000001, estimated: true })
  assert.deepEqual(sumRoundCosts(rounds, 'usd'), { input: 0.4, cacheRead: 0.03, output: 0.30000000000000004, total: 0.73, estimated: true })
  assert.equal(sumRoundCosts([], 'cny'), null)
  assert.equal(sumRoundCosts([...rounds, { cost: null }], 'cny'), null)
})
