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
import type { BucketPrices, ModelPricing, PriceTier } from './calc.ts'
import { pricingAtRate, matchPricingKey, normalizeModelId } from './calc.ts'

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

/**
 * 当前官方在售模型定价表（双币种 / 1M tokens，区分高峰/空闲时段）。
 * 来源：官方定价页（2026-09-10 核验）
 *  - 中文页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing（CNY 报价）
 *  - 英文页 https://api-docs.deepseek.com/quick_start/pricing（USD 报价）
 * 高峰时段（北京时间周一至周五 09:00–12:00、14:00–18:00 = UTC 01:00–04:00、06:00–10:00）
 * 价格为空闲时段的两倍。
 */
const FLASH_PRICING: ModelPricing = {
  offPeak: {
    cny: { cacheMissInput: 1, cacheHitInput: 0.02, output: 4 },
    usd: { cacheMissInput: 0.15, cacheHitInput: 0.003, output: 0.6 },
  },
  peak: {
    cny: { cacheMissInput: 2, cacheHitInput: 0.04, output: 8 },
    usd: { cacheMissInput: 0.3, cacheHitInput: 0.006, output: 1.2 },
  },
}

export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'deepseek-flash': FLASH_PRICING,
  'deepseek-v4-pro': {
    offPeak: {
      cny: { cacheMissInput: 4.5, cacheHitInput: 0.15, output: 13.5 },
      usd: { cacheMissInput: 0.66, cacheHitInput: 0.022, output: 1.98 },
    },
    peak: {
      cny: { cacheMissInput: 9.0, cacheHitInput: 0.30, output: 27.0 },
      usd: { cacheMissInput: 1.32, cacheHitInput: 0.044, output: 3.96 },
    },
  },
}

/**
 * 旧模型名兼容：
 *  - `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已并入 `deepseek-flash`，
 *    仍按同一价格表解析，避免历史会话突然变成「未定价模型」。
 */
BUILTIN_PRICING['deepseek-v4-flash'] = FLASH_PRICING
BUILTIN_PRICING['deepseek-v4-flash-vision-exp'] = FLASH_PRICING

/** 内置表的核验日期（来源：官方定价页中/英文版，2026-09-10 抓取核验）。 */
export const BUILTIN_VERIFIED_AT = Date.parse('2026-09-10T00:00:00Z')

/**
 * Anthropic Claude 官方 API 标准价（USD / 1M tokens）。
 * 来源：https://platform.claude.com/docs/en/about-claude/pricing（2026-11-05 核验，
 * 含「Additional models」表）。
 *  - 不分高峰/空闲：peak 与 offPeak 同价；
 *  - 官方只有美元报价：人民币按统一展示汇率折算（未指定时默认 DEFAULT_CNY_PER_USD）；
 *  - cacheWrite 取 5 分钟 TTL 写入价（1 小时 TTL 更贵，用量里无法区分）；
 *  - 批处理折扣、地区/inference_geo 溢价、Fast mode、工具调用费不计入；
 *  - Claude Haiku 5.5 按单次请求的输入长度分档（≤100K / >100K），按轮聚合无法
 *    判定档位，暂不收录（显示为「未定价模型」，不按 DeepSeek 回退价估算）。
 */
export const ANTHROPIC_VERIFIED_AT = Date.parse('2026-11-05T00:00:00Z')

function usdFlatPricing(usd: Required<BucketPrices>): ModelPricing {
  const tier: PriceTier = { cny: usd, usd, baseCurrency: 'usd' }
  return pricingAtRate({ peak: tier, offPeak: tier })
}

/** 简写：输入 / 输出 / 5 分钟写缓存 / 缓存命中（USD / 1M）。 */
function claude(input: number, output: number, cacheWrite: number, cacheHit: number): ModelPricing {
  return usdFlatPricing({ cacheMissInput: input, cacheHitInput: cacheHit, output, cacheWrite })
}

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // 当前主力型号
  'claude-fable-5-1': claude(10, 50, 12.5, 0.25),
  'claude-opus-5-5': claude(4, 20, 5, 0.2),
  'claude-sonnet-5-5': claude(2, 10, 2.5, 0.1),
  // Additional models
  'claude-mythos-5-1': claude(10, 50, 12.5, 0.25),
  'claude-fable-5': claude(10, 50, 12.5, 1),
  'claude-mythos-5': claude(10, 50, 12.5, 1),
  'claude-opus-5': claude(5, 25, 6.25, 0.5),
  'claude-opus-4-8': claude(5, 25, 6.25, 0.5),
  'claude-opus-4-7': claude(5, 25, 6.25, 0.5),
  'claude-opus-4-6': claude(5, 25, 6.25, 0.5),
  'claude-opus-4-5': claude(5, 25, 6.25, 0.5),
  'claude-opus-4-1': claude(15, 75, 18.75, 1.5),
  'claude-opus-4': claude(15, 75, 18.75, 1.5),
  'claude-sonnet-5': claude(2, 10, 2.5, 0.2),
  'claude-sonnet-4-6': claude(3, 15, 3.75, 0.3),
  'claude-sonnet-4-5': claude(3, 15, 3.75, 0.3),
  'claude-sonnet-4': claude(3, 15, 3.75, 0.3),
  'claude-haiku-4-5': claude(1, 5, 1.25, 0.1),
}
Object.assign(BUILTIN_PRICING, ANTHROPIC_PRICING)

/** 内置条目的核验日期：Anthropic 条目单独核验，其余沿用 BUILTIN_VERIFIED_AT。 */
function builtinVerifiedAt(model: string | null): number {
  return model !== null && model in ANTHROPIC_PRICING ? ANTHROPIC_VERIFIED_AT : BUILTIN_VERIFIED_AT
}

/** 未收录模型回退：按 deepseek-flash 刊例价估算并标记 ≈（Claude 例外，见 isUnpricedWhenUnknown）。 */
export const FALLBACK_PRICING: ModelPricing = FLASH_PRICING

/** 选键：精确优先，其次最长前缀（Claude 键仅接受日期快照后缀），见 matchPricingKey。 */
function matchKey(table: Record<string, unknown>, model: string): string | null {
  return matchPricingKey(Object.keys(table), model)
}

function matchEntry<T>(table: Record<string, T>, model: string): T | null {
  const key = matchKey(table, model)
  return key === null ? null : table[key] ?? null
}

/** 适配器①：内置刊例价常量。 */
export function builtinPricingSource(table: Record<string, ModelPricing> = BUILTIN_PRICING): PricingSource {
  return {
    id: 'builtin',
    resolve(model) {
      const normalized = normalizeModelId(model)
      const key = matchKey(table, normalized)
      return {
        pricing: key === null ? null : table[key] ?? null,
        verifiedAt: builtinVerifiedAt(key),
      }
    },
    knownModels() {
      return Object.keys(table)
    },
  }
}

/** pricing.json 里单条用户覆盖的合法形状（verifiedAt 可选）。 */
export type FilePricingEntry = ModelPricing & { verifiedAt?: number }

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 校验一个单币种单价（{ cacheMissInput, cacheHitInput, output } 均须为非负有限数）。
 */
function normalizeBucketPrices(value: unknown): BucketPrices | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (
    !isFiniteNonNegative(record.cacheMissInput)
    || !isFiniteNonNegative(record.cacheHitInput)
    || !isFiniteNonNegative(record.output)
  ) return null
  if (record.cacheWrite !== undefined && !isFiniteNonNegative(record.cacheWrite)) return null
  const prices: BucketPrices = {
    cacheMissInput: record.cacheMissInput,
    cacheHitInput: record.cacheHitInput,
    output: record.output,
  }
  if (isFiniteNonNegative(record.cacheWrite)) prices.cacheWrite = record.cacheWrite
  return prices
}

/** 保留单币种来源标记；默认形状补全也走同一换算函数，避免厂商专属汇率。 */
function singleCurrencyTier(prices: BucketPrices, baseCurrency: 'cny' | 'usd'): PriceTier {
  const tier: PriceTier = { cny: prices, usd: prices, baseCurrency }
  return pricingAtRate({ peak: tier, offPeak: tier }).peak
}

/**
 * 校验并规范化一个时段单价（PriceTier）：
 *  - 双币种：`{ cny: {…}, usd: {…} }`（可只给 cny 或 usd；记录原币种，供统一展示汇率重算）；
 *  - 单币种（兼容）：平铺 `{ cacheMissInput, cacheHitInput, output }`，视为人民币，
 *    默认形状补全后保留原币种标记，解析时按统一展示汇率重算。
 */
function normalizePriceTier(value: unknown): PriceTier | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.cny !== undefined || record.usd !== undefined) {
    const cny = normalizeBucketPrices(record.cny)
    const usd = record.usd === undefined ? null : normalizeBucketPrices(record.usd)
    // 显式提供的非法报价不能静默当作缺失；只提供 USD/CNY 都可补全另一币种。
    if ((record.cny !== undefined && cny === null) || (record.usd !== undefined && usd === null)) return null
    if (cny !== null && usd !== null) return { cny, usd }
    if (cny !== null) return singleCurrencyTier(cny, 'cny')
    if (usd !== null) return singleCurrencyTier(usd, 'usd')
    return null
  }
  const cny = normalizeBucketPrices(record)
  if (cny === null) return null
  return singleCurrencyTier(cny, 'cny')
}

/** pricing.json 支持两种形状：平铺 `{ model: {…} }` 或 `{ models: { model: {…} } }`。 */
export type PricingFileShape =
  | Record<string, FilePricingEntry>
  | { models: Record<string, FilePricingEntry> }

/**
 * 校验并规范化一个条目；非法返回 null。
 *
 * 支持三种形状：
 *  - 新格式（推荐）：`{ peak: { cny, usd }, offPeak: { cny, usd }, verifiedAt? }`，
 *    双时段 × 双币种显式定价；
 *  - 兼容①：`{ peak: {…}, offPeak: {…} }`（时段单价平铺桶价）→ 视为人民币，
 *    按统一展示汇率补全美元；
 *  - 兼容②：平铺 `{ cacheMissInput, cacheHitInput, output }` → 高峰/空闲同价、
 *    单币种（人民币），默认形状补全后保留原币种标记，解析时按统一展示汇率重算。
 */
export function normalizeFileEntry(value: unknown): FilePricingEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const verifiedAt = record.verifiedAt
  if (!isFiniteNonNegative(verifiedAt) && verifiedAt !== undefined) return null

  const entry: FilePricingEntry = {
    offPeak: { cny: { cacheMissInput: 0, cacheHitInput: 0, output: 0 }, usd: { cacheMissInput: 0, cacheHitInput: 0, output: 0 } },
    peak: { cny: { cacheMissInput: 0, cacheHitInput: 0, output: 0 }, usd: { cacheMissInput: 0, cacheHitInput: 0, output: 0 } },
  }
  if (isFiniteNonNegative(verifiedAt)) entry.verifiedAt = verifiedAt

  // 新格式 / 兼容①：{ peak, offPeak } 双时段显式定价。
  if (record.peak !== undefined || record.offPeak !== undefined) {
    const peak = normalizePriceTier(record.peak)
    const offPeak = normalizePriceTier(record.offPeak)
    if (peak === null || offPeak === null) return null
    entry.peak = peak
    entry.offPeak = offPeak
    return entry
  }

  // 兼容②：平铺单价 → 高峰/空闲同价。
  const flat = normalizePriceTier(record)
  if (flat === null) return null
  entry.peak = flat
  entry.offPeak = flat
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
    const normalized = normalizeModelId(model)
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
      const normalized = normalizeModelId(model)
      const entry = matchEntry(entries, normalized)
      if (entry === null) return { pricing: null, verifiedAt: null }
      return {
        pricing: { peak: entry.peak, offPeak: entry.offPeak },
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
