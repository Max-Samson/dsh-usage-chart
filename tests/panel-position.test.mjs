/**
 * 面板拖动偏移的纯函数回归：持久化读取容错 + 边界夹取。
 * 交互本身（pointer 拖动 / 双击复位）由运行中的 DSH Web 手工验证；这里锁住数学与容错。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/** 与 merge-regression.test.mjs 同款：esbuild 打包 src 后以 ESM 载入（同 realm）。 */
async function loadModule(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

const { readPanelOffset, clampPanelOffset, PANEL_POS_KEY, MIN_VISIBLE_PX } =
  await loadModule('../src/client/panel-position.ts')

/** 只实现 getItem 的假存储。 */
const storage = (raw) => ({ getItem: (key) => (key === PANEL_POS_KEY ? raw : null) })

test('readPanelOffset: missing / broken / invalid values fall back to zero', () => {
  assert.deepEqual(readPanelOffset(storage(null)), { x: 0, y: 0 })
  assert.deepEqual(readPanelOffset(storage('not json')), { x: 0, y: 0 })
  assert.deepEqual(readPanelOffset(storage('null')), { x: 0, y: 0 })
  assert.deepEqual(readPanelOffset(storage('{"x":12}')), { x: 12, y: 0 })
  assert.deepEqual(readPanelOffset(storage('{"x":"12","y":null}')), { x: 0, y: 0 })
  assert.deepEqual(readPanelOffset(storage('{"x":1e999,"y":-3}')), { x: 0, y: -3 })
  assert.deepEqual(readPanelOffset(undefined), { x: 0, y: 0 })
})

test('readPanelOffset: valid offsets round-trip', () => {
  assert.deepEqual(readPanelOffset(storage('{"x":-40,"y":120}')), { x: -40, y: 120 })
})

const BOUNDS = { left: 0, top: 0, right: 1000, bottom: 800 }
const PANEL = { left: 100, top: 100, right: 600, bottom: 500 }

test('clampPanelOffset: keeps MIN_VISIBLE_PX of the panel inside the containing block', () => {
  const right = clampPanelOffset({ x: 5000, y: 5000 }, PANEL, BOUNDS)
  assert.equal(right.x, BOUNDS.right - PANEL.left - MIN_VISIBLE_PX)
  assert.equal(right.y, BOUNDS.bottom - PANEL.top - MIN_VISIBLE_PX)
  const left = clampPanelOffset({ x: -5000, y: -5000 }, PANEL, BOUNDS)
  assert.equal(left.x, BOUNDS.left - PANEL.right + MIN_VISIBLE_PX)
  assert.equal(left.y, BOUNDS.top - PANEL.bottom + MIN_VISIBLE_PX)
})

test('clampPanelOffset: in-range offsets and oversized panels pass through', () => {
  assert.deepEqual(clampPanelOffset({ x: 12, y: -20 }, PANEL, BOUNDS), { x: 12, y: -20 })
  const huge = { left: 0, top: 0, right: 1400, bottom: 900 }
  assert.deepEqual(clampPanelOffset({ x: 300, y: 300 }, huge, BOUNDS), { x: 300, y: 300 })
})
