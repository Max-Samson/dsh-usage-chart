#!/usr/bin/env node
/**
 * dsh-usage-chart 构建脚本（零框架依赖：esbuild 两个产物）。
 *
 *  - lib/index.js  —— host 半区（Node ESM，加载器按 package.json main 导入）
 *  - lib/client.js —— client 半区（浏览器 CJS 工厂包，`window.__ModuleLoader__.load`
 *                     注册；外部依赖 = DSH web 的 PLATFORM_MODULES + runtime/client 豁免，
 *                     与 monorepo packages/client/tsdown.client.ts 的规则保持一致）
 *
 * 用法：node build.mjs   （可选 DSH_PLUGIN_ID 覆盖注册 id，默认 dsh-usage-chart）
 */
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

const PLUGIN_ID = process.env.DSH_PLUGIN_ID ?? 'dsh-usage-chart'

// 与 @deepseek-ai/dsh-client-web/src/platform.ts 的 PLATFORM_MODULES 完全一致
// + RUNTIME_STORE_EXEMPTION（packages/client/tsdown.client.ts 的 CLIENT_EXTERNALS）。
// 运行时这些 specifier 由浏览器的模块表（loader）回答，绝不内联。
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

// A clean output directory prevents stale chunks or declarations from leaking
// into an npm release when an entry point is renamed or removed.
rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })

await Promise.all([
  // ── Host half ────────────────────────────────────────────────────────────
  build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    // 只允许把 DSH 的 cordis 留在外部（加载器提供）；实际上宿主代码对
    // cordis 只做 type-only import，会被 esbuild 擦除，产物基本是纯业务代码。
    external: ['@deepseek-ai/cordis'],
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  }),

  // ── Client half（浏览器工厂包） ──────────────────────────────────────────
  build({
    entryPoints: ['src/client/index.ts'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    external: CLIENT_EXTERNALS,
    // 除平台模块外全部内联（业务包本身 + 任何非共享依赖）。
    // 运行时模块表答不出的 require 一定抛错，所以规则就是模块表本身。
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {\n`
        + 'var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    jsx: 'automatic',
  }),
])

// ── 类型声明（lib/types/*.d.ts，package.json exports.types 指向这里） ────────
// esbuild 不产出 .d.ts；tsconfig.build.json 走声明-only 编译，保证
// `import ... from 'dsh-usage-chart'` 与 `... from 'dsh-usage-chart/client'`
// 的类型契约真实存在（发布/安装后不悬挂）。
const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
  stdio: 'inherit',
})
if (tsc.status !== 0) process.exit(tsc.status ?? 1)

console.log(`[dsh-usage-chart] built lib/index.js + lib/client.js + lib/types (id=${PLUGIN_ID})`)
