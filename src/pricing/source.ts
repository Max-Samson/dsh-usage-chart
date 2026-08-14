/**
 * PricingSource 接缝（host 半区）：价格的「来源」。
 *
 * 接口极小：`resolve(model) → 该模型的定价，或 null（未知模型）`。
 * 适配器：
 *  - builtinPricingSource：内置刊例价常量（v0.1 PRICING 表迁移而来），带核验日期；
 *  - filePricingSource：数据目录 pricing.json（用户覆盖，读文件 + 变更监听）。
 *
 * client 永不 import 本文件；client 的价格唯一输入是 /pricing 快照
 * （ADR 2：价格解析只在 host）。
 */
import { readFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelPricing } from './calc.ts'

/** 价格来源标识。 */
export type PricingSourceId = 'builtin' | 'file'

/**
 * 一个可解析价格的来源。`resolve(model)` 返回定价或 null（未收录）；
 * `verifiedAt` 是该条目最后核验时间（epoch 毫秒），未知为 null。
 * `knownModels()` 枚举来源收录的全部模型名（供快照导出）。
 */
export interface PricingSource {
  readonly id: PricingSourceId
  resolve(model: string): { pricing: ModelPricing | null; verifiedAt: number | null }
  knownModels(): readonly string[]
}

/** 当前官方在售模型定价表（USD / 1M tokens）。 */
export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': { cacheMissInput: 0.14, cacheHitInput: 0.0028, output: 0.28 },
  'deepseek-v4-pro': { cacheMissInput: 0.435, cacheHitInput: 0.003625, output: 0.87 },
}

/** 内置表的核验日期（来源：官方定价页 https://api-docs.deepseek.com/quick_start/pricing，2026-08-12 抓取）。 */
export const BUILTIN_VERIFIED_AT = Date.parse('2026-08-12T00:00:00Z')

/** 未收录模型回退：按 deepseek-v4-flash 刊例价估算并标记 ≈。 */
export const FALLBACK_PRICING: ModelPricing = BUILTIN_PRICING['deepseek-v4-flash']

/** 前缀匹配（如带日期后缀的模型版本）；精确匹配优先。 */
function matchEntry<T>(table: Record<string, T>, model: string): T | null {
  const direct = table[model]
  if (direct !== undefined) return direct
  for (const [key, value] of Object.entries(table)) {
    if (model.startsWith(key)) return value
  }
  return null
}

/** 适配器①：内置刊例价常量。 */
export function builtinPricingSource(table: Record<string, ModelPricing> = BUILTIN_PRICING): PricingSource {
  return {
    id: 'builtin',
    resolve(model) {
      const normalized = model.trim().toLowerCase()
      return {
        pricing: matchEntry(table, normalized),
        verifiedAt: BUILTIN_VERIFIED_AT,
      }
    },
    knownModels() {
      return Object.keys(table)
    },
  }
}

/** pricing.json 里单条用户覆盖的合法形状（verifiedAt 可选）。 */
export type FilePricingEntry = ModelPricing & { verifiedAt?: number }

/** pricing.json 支持两种形状：平铺 `{ model: {…} }` 或 `{ models: { model: {…} } }`。 */
export type PricingFileShape =
  | Record<string, FilePricingEntry>
  | { models: Record<string, FilePricingEntry> }

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 校验并规范化一个条目；非法返回 null。 */
export function normalizeFileEntry(value: unknown): FilePricingEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const cacheMissInput = record.cacheMissInput
  const cacheHitInput = record.cacheHitInput
  const output = record.output
  if (!isFiniteNonNegative(cacheMissInput) || !isFiniteNonNegative(cacheHitInput) || !isFiniteNonNegative(output)) {
    return null
  }
  const verifiedAt = record.verifiedAt
  const entry: FilePricingEntry = { cacheMissInput, cacheHitInput, output }
  if (isFiniteNonNegative(verifiedAt)) entry.verifiedAt = verifiedAt
  return entry
}

/** 解析 pricing.json 文本 → 规范化条目表；任何非法/缺失字段的条目被跳过。 */
export function parsePricingFile(text: string): Record<string, FilePricingEntry> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  const raw =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? 'models' in parsed && typeof (parsed as { models?: unknown }).models === 'object' && (parsed as { models: unknown }).models !== null
        ? (parsed as { models: Record<string, unknown> }).models
        : (parsed as Record<string, unknown>)
      : {}
  const entries: Record<string, FilePricingEntry> = {}
  for (const [model, value] of Object.entries(raw)) {
    const normalized = model.trim().toLowerCase()
    if (normalized === '') continue
    const entry = normalizeFileEntry(value)
    if (entry !== null) entries[normalized] = entry
  }
  return entries
}

/** 读取并解析 pricing.json；文件缺失/解析失败返回空表（不抛错）。 */
export async function loadPricingFile(filePath: string): Promise<Record<string, FilePricingEntry>> {
  try {
    const text = await readFile(filePath, 'utf8')
    return parsePricingFile(text)
  } catch {
    return {}
  }
}

/**
 * 适配器②：数据目录 pricing.json（用户覆盖）。
 * 启动时读一次（`ready()` 可等待首次加载完成），随后监听文件变更
 * （含目录内新建/删除，防抖 250ms）刷新。`reload()` 手动重读（测试/调试用）；
 * `onChange` 供宿主感知刷新时机；`dispose()` 停止监听。
 */
export function filePricingSource(
  filePath: string,
  onChange?: () => void,
): PricingSource & { dispose: () => void; ready: () => Promise<void>; reload: () => Promise<void> } {
  let entries: Record<string, FilePricingEntry> = {}
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let watching: ReturnType<typeof watch> | null = null
  let loadChain: Promise<void> = Promise.resolve()

  const refresh = (): Promise<void> => {
    const next = loadPricingFile(filePath).then((loaded) => {
      if (disposed) return
      const changed = Object.keys(loaded).length !== Object.keys(entries).length
        || Object.keys(loaded).some((k) => entries[k] !== loaded[k])
      entries = loaded
      if (changed) onChange?.()
    })
    loadChain = loadChain.then(() => next)
    return loadChain
  }

  const ready = refresh()

  const ensureWatcher = (): void => {
    if (disposed || watching !== null) return
    const target = dirname(filePath)
    try {
      watching = watch(target, (_event, filename) => {
        if (filename === null || filename === undefined) return
        // 只关心目标文件名（不含目录部分）的变更；dir 监听会收到 basename。
        if (filename.toString() !== filePath.split('/').pop()) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void refresh()
        }, 250)
      })
      watching.on('error', () => { watching = null })
    } catch {
      watching = null
    }
  }
  ensureWatcher()

  return {
    id: 'file',
    resolve(model) {
      // 自愈：目录尚未存在时首次监听失败；一旦目录就绪，下一次解析会补上监听。
      if (!disposed && watching === null) ensureWatcher()
      const normalized = model.trim().toLowerCase()
      const entry = matchEntry(entries, normalized)
      if (entry === null) return { pricing: null, verifiedAt: null }
      return {
        pricing: { cacheMissInput: entry.cacheMissInput, cacheHitInput: entry.cacheHitInput, output: entry.output },
        verifiedAt: entry.verifiedAt ?? null,
      }
    },
    knownModels() {
      return Object.keys(entries)
    },
    ready() {
      return ready
    },
    reload() {
      return refresh()
    },
    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      watching?.close()
      watching = null
    },
  }
}
