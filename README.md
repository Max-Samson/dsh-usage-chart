# dsh-usage-chart

> DeepSeek 用量 / 成本 / 余额仪表盘 · DSH Web 插件

在 DeepSeek Harness Web UI 的**输入框下方**实时显示 token 用量、成本估算、模型与账户余额；点击展开**用量可视化图表面板**（参考 DeepSeek 开发者平台的用量页组织方式），全部使用零依赖 SVG 自绘，不引入任何图表库。

```
▸ 输入 34.8K · 输出 578 · 缓存 56% · 成本 ≈$0.0042 · v4-flash · 余额 ¥31.13
```

点击 ▸ 展开面板：

- **会话用量汇总** — 输入（未命中/命中）、输出、缓存命中率、上下文占用（均来自官方 adapter 上报的 `tokenUsage` / `contextPressure` 投影）
- **成本估算** — 按官方刊例价（USD/1M tokens）估算，标注「估算，非账单」
- **每轮用量（本页观测）** — 每轮输入/输出柱状图，按 adapter 每次上报的用量增量实时累积
- **账户余额** — 官方 `GET /user/balance` 接口实时查询（经宿主侧代理，密钥不暴露给浏览器）

## 特性

| 数据 | 来源 | 准确性 |
|---|---|---|
| token 用量 | DSH 官方 adapter 上报的会话投影（`tokenUsage` / `contextPressure`） | ✅ 官方真实数据，实时更新 |
| 成本 | 官方刊例价 × adapter 上报用量 | ⚠️ 估算值，非官方账单 |
| 余额 | 官方 `GET https://api.deepseek.com/user/balance` | ✅ 官方实时数据 |
| 模型名 | adapter 上报的请求 provenance | ✅ 官方真实数据 |

## 技术栈

- **语言**：TypeScript（DSH 插件官方唯一语言——官方文档：*"a plugin is a TypeScript module that exports an `apply` function"*；UI 插件运行在浏览器，Python 无法参与）
- **框架**：[Cordis](https://github.com/cordiverse/cordis) 插件模型 + React 18
- **构建**：esbuild（host 半区 = Node ESM；client 半区 = `window.__ModuleLoader__.load({id, factory})` 工厂包，外部依赖与 DSH web 的 `PLATFORM_MODULES` 完全一致）
- **可视化**：零依赖手写 SVG（DSH web 未内置图表库；自绘与平台渲染方式一致、体积最小、最稳定）

## 安装

需要 [DSH](https://github.com/deepseek-ai/deepseek-harness)（`npx @deepseek-ai/dsh`，版本 ≥ 0.1.0-rc.6）。

```sh
git clone https://github.com/<you>/dsh-usage-chart
cd dsh-usage-chart
npm install        # 安装构建依赖
npm run build      # 产出 lib/index.js（host）与 lib/client.js（client）

# 安装到 profile（默认 web）：
dsh plugin --profile web add ./dsh-usage-chart

# 重启 DSH web 后生效
dsh web --profile web
```

### 配置余额查询

余额查询需要 DeepSeek API Key，二选一：

1. **环境变量**（推荐）：启动 `dsh web` 前导出 `DEEPSEEK_API_KEY=sk-...`
2. **插件配置**：在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: dsh-usage-chart
  name: dsh-usage-chart
  config:
    apiKey: 'sk-...'        # 留空则回退到环境变量
    baseUrl: 'https://api.deepseek.com'
```

未配置 Key 时，指示器显示 `余额 –`，点击可重试；面板内会提示如何配置。

## 从 GitHub 安装（无发布）

```sh
dsh plugin --profile web add github:<you>/dsh-usage-chart
```

Git 安装会执行包的 `prepare` 脚本（`node build.mjs`）从源码构建。pnpm ≥ 10 首次会拒绝运行
`prepare`，需要在 profile 的 `pnpm-workspace.yaml` 中放行：

```yaml
allowBuilds:
  dsh-usage-chart: true
```

> 放行意味着允许该包源码在安装时于本机执行，请只对可信来源这么做，并固定 commit
> （`github:<you>/dsh-usage-chart#<sha>`）。

## 发布

```sh
npm run build
npm publish
# GitHub 仓库添加 topic: dsh-plugin，便于收录进 awesome-dsh-plugin
```

## 插件结构

```
dsh-usage-chart/
├── package.json          # dsh.bundle（安装层）+ dsh.client（浏览器半区）+ exports["./client"]
├── cordis.patch.yml      # 插件行插入（config.apiKey / baseUrl）
├── build.mjs             # esbuild 双产物构建
├── src/
│   ├── index.ts          # host 半区：/dsh-usage-chart/balance 余额代理路由
│   ├── pricing.ts        # 官方刊例价表 + 成本计算（host/client 共享）
│   └── client/
│       ├── index.ts      # client 入口：注册 'conversation.composer.dock' 槽位
│       ├── UsageIndicator.tsx  # 输入框下方一行指示器
│       ├── UsagePanel.tsx      # 可视化面板（汇总 / 成本 / 每轮柱状图 / 余额）
│       ├── charts.tsx          # 零依赖 SVG 柱状图
│       ├── balance.ts          # 余额读取 hook（经宿主代理）
│       └── styles.ts           # 注入样式（<style data-plugin>）
└── types/                # vendored 最小类型声明（DSH client 包未发布稳定版）
```

## 已知边界

- 「每轮用量」柱状图仅覆盖**本页面加载以来**的观测增量（投影只持久化累计值，不持久化逐轮历史）；累计值始终准确。
- 成本为官方刊例价估算；官方价格调整后需升级本插件。
- 余额经宿主同源路由代理（浏览器直连官方 API 有 CORS 与密钥暴露问题）。

## License

MIT
