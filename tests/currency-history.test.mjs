import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

async function load(path, globals = {}, mockHooks = false) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], plugins: mockHooks ? [{ name: 'hooks', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hooks' }))
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: ['useState', 'useRef', 'useCallback', 'useEffect'].map((name) => `export const ${name}=(...args)=>globalThis.__hooks.${name}(...args);`).join('\n') }))
  } }] : [] })
  const ctx = { module: { exports: {} }, require: createRequire(import.meta.url), ...globals }
  ctx.exports = ctx.module.exports; ctx.globalThis = ctx
  runInNewContext(result.outputFiles[0].text, ctx)
  return { api: ctx.module.exports, ctx }
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const response = (body) => ({ ok: true, json: async () => body })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('one currency store restores a valid rate and still loads configured currency', async () => {
  const storage = new Map([['dsh-usage-chart:rate', JSON.stringify({ rate: 7.3, fetchedAt: 123 })]])
  const { api, ctx } = await load('src/client/currency.ts', {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => response({ ok: true, currency: 'cny', cnyPerUsd: 7.1 }),
  })
  api.initDisplayMeta(); await tick()
  assert.equal(api.getDisplayMeta().currency, 'cny')
  assert.equal(api.getDisplayMeta().cnyPerUsd, 7.3)
  api.setDisplayCurrency('usd')
  await api.fetchDisplayMeta()
  assert.equal(api.getDisplayMeta().currency, 'usd')
  assert.equal(api.getDisplayMeta().cnyPerUsd, 7.3)
  ctx.fetch = async () => response({ ok: true, rate: 8, fetchedAt: 456 })
  assert.equal(await api.refreshLiveRate(), 'ok')
  assert.equal(api.getDisplayMeta().cnyPerUsd, 8)
  assert.equal(JSON.parse(storage.get('dsh-usage-chart:rate')).rate, 8)
  ctx.fetch = async () => { throw Error('offline') }
  assert.equal(await api.refreshLiveRate(), 'request-failed')
  assert.equal(api.getDisplayMeta().cnyPerUsd, 8)
  for (const bad of [-1, NaN, Infinity, 0]) api.setLiveRate(bad, 999)
  assert.equal(api.getDisplayMeta().cnyPerUsd, 8)
})

test('no stored rate uses config, then all consumers observe a single live value', async () => {
  const { api } = await load('src/client/currency.ts', { fetch: async () => response({ ok: true, currency: 'usd', cnyPerUsd: 7.1 }) })
  let notifications = 0
  const unsubscribe = api.subscribeDisplayMeta(() => notifications++)
  await api.fetchDisplayMeta()
  assert.equal(api.getDisplayMeta().cnyPerUsd, 7.1)
  api.setLiveRate(7.3, 1)
  await api.fetchDisplayMeta()
  assert.equal(api.getDisplayMeta().cnyPerUsd, 7.3)
  assert.equal(notifications, 2)
  unsubscribe()
})

// 极小 hook 驱动器：只负责状态/依赖/提交时机，不重写被测 history 逻辑或请求缓存。
function hooksFor(api, ctx) {
  const cells = []; let cursor = 0; let pending = []
  const equal = (a, b) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]))
  const hooks = {
    useState(initial) {
      const i = cursor++
      cells[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [cells[i].value, (next) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next }]
    },
    useRef(initial) { const i = cursor++; cells[i] ??= { current: initial }; return cells[i] },
    useCallback(fn, deps) { const i = cursor++; if (!equal(cells[i]?.deps, deps)) cells[i] = { deps, fn }; return cells[i].fn },
    useEffect(fn, deps) { const i = cursor++; if (!equal(cells[i]?.deps, deps)) pending.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() } }) },
  }
  return {
    render(session, rate) { cursor = 0; ctx.__hooks = hooks; const result = api.useHistoryRounds(session, rate); const effects = pending; pending = []; effects.forEach((f) => f()); return result },
    unmount() { cells.forEach((c) => c.cleanup?.()) },
  }
}

test('history request identity includes FX; stale rate/session responses cannot replace new costs', async () => {
  const calls = []
  const { api, ctx } = await load('src/client/rounds/history.ts', { fetch: (url) => { const d = deferred(); calls.push({ url, ...d }); return d.promise } }, true)
  const h = hooksFor(api, ctx)
  h.render('session-a', 7.1)
  h.render('session-a', 7.3)
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /cnyPerUsd=7.1/)
  assert.match(calls[1].url, /cnyPerUsd=7.3/)
  calls[1].resolve(response({ ok: true, rounds: [{ turn: 2 }], totals: {} })); await tick()
  assert.equal(h.render('session-a', 7.3).rounds[0].turn, 2)
  calls[0].resolve(response({ ok: true, rounds: [{ turn: 1 }], totals: {} })); await tick()
  assert.equal(h.render('session-a', 7.3).rounds[0].turn, 2)
  const selected = h.render('session-b', 7.3)
  assert.equal(selected.rounds.length, 0, 'do not present another session/rate as current history')
  calls[2].resolve(response({ ok: true, rounds: [{ turn: 3 }], totals: {} })); await tick()
  assert.equal(h.render('session-b', 7.3).rounds[0].turn, 3)
  h.unmount()
})

test('same-session same-rate history requests are deduplicated and old manual loads cannot win', async () => {
  const calls = []
  const { api, ctx } = await load('src/client/rounds/history.ts', { fetch: (url) => { const d = deferred(); calls.push({ url, ...d }); return d.promise } }, true)
  const a = hooksFor(api, ctx), b = hooksFor(api, ctx)
  a.render('session-a', 7.3); b.render('session-a', 7.3)
  assert.equal(calls.length, 1)
  calls[0].resolve(response({ ok: true, rounds: [{ turn: 1 }], totals: {} })); await tick()
  const old = a.render('session-a', 7.3)
  const pending = old.load()
  a.render('session-b', 8)
  calls[2].resolve(response({ ok: true, rounds: [{ turn: 3 }], totals: {} })); await tick()
  calls[1].resolve(response({ ok: true, rounds: [{ turn: 2 }], totals: {} })); await pending
  assert.equal(a.render('session-b', 8).rounds[0].turn, 3)
  assert.equal(b.render('session-a', 7.3).rounds[0].turn, 1)
  a.unmount(); b.unmount()
})
