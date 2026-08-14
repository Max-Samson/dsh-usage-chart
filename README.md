# dsh-usage-chart

> DeepSeek 用量 / 成本 / 余额仪表盘 · DSH Web 插件

[![npm version](https://img.shields.io/npm/v/dsh-usage-chart)](https://www.npmjs.com/package/dsh-usage-chart)
[![CI](https://img.shields.io/github/actions/workflow/status/Max-Samson/dsh-usage-chart/ci.yml?branch=main)](https://github.com/Max-Samson/dsh-usage-chart/actions)
[![License](https://img.shields.io/github/license/Max-Samson/dsh-usage-chart)](./LICENSE)

[English](./README_EN.md) · [问题反馈](https://github.com/Max-Samson/dsh-usage-chart/issues)

界面预览：左侧为浅色英文界面，右侧为深色简体中文界面。两者均会跟随 DSH 的主题与语言设置。

<table>
  <tr>
    <td width="50%"><img src="./docs/images/usage-panel-demo-en-light.png" alt="浅色主题的英文用量面板演示" /><br /><sub>浅色主题 · English</sub></td>
    <td width="50%"><img src="./docs/images/usage-panel-demo-zh-dark.png" alt="深色主题的简体中文用量面板演示" /><br /><sub>深色主题 · 简体中文</sub></td>
  </tr>
</table>

> 图片仅使用虚构演示数据：不含真实会话内容、Token、成本、余额或 API Key。

在 DeepSeek Harness Web UI 的**输入框下方**实时显示 token 用量、成本估算、模型与账户余额；点击展开**用量可视化图表面板**（参考 DeepSeek 开发者平台的用量页组织方式），全部使用零依赖 SVG 自绘，不引入任何图表库。

```
▸ 输入 12.4M · 输出 86.2K · 缓存 72% · 成本 ≈$0.042 · demo-model · 余额 --
```

点击 ▸ 展开面板：

- **会话用量汇总** — 输入（未命中/命中）、输出、缓存命中率、上下文占用（均来自官方 adapter 上报的 `tokenUsage` / `contextPressure` 投影）
- **成本估算** — 按官方刊例价（USD/1M tokens）估算并标注来源与核验日期；支持用户覆盖 `pricing.json`；未定价模型显式标记「未定价模型」
- **轮次用量** — 支持“总量 / 构成 / **成本**”三视角；柱顶叠加**总耗时点线**；成本突增轮次加**异常标记**（归因 chip：输出增长 / 上下文膨胀 / 缓存命中下降）；柱底缓存命中迷你刻度；悬浮**解释卡**（token 分桶 + 成本 + 模型 + 耗时/TTFT/TPS + 结束原因）；从宿主会话日志折叠完整历史，不可用时回退到本页观测增量
- **成本徽章** — 每条助手消息尾部显示可关闭的「本轮 ≈ $0.00xx」徽章
- **上下文压力条** — 指示器行内的细压力条（`contextPressure / contextWindow`），随占用升高由绿转红
- **账户余额** — 官方 `GET /user/balance` 接口实时查询（经宿主侧代理，密钥不暴露给浏览器）
- **中英双语** — 自动跟随 DSH 应用内语言设置，支持运行时切换 `zh` / `en`

## 特性

| 数据 | 来源 | 准确性 |
|---|---|---|
| token 用量 | DSH 官方 adapter 上报的会话投影（`tokenUsage` / `contextPressure`） | ✅ 官方真实数据，实时更新 |
| 成本 | 官方刊例价（内置表 + 可选用户覆盖 `pricing.json`）× adapter 上报用量 | ⚠️ 估算值，非官方账单；价格经宿主 `/pricing` 单点解析 |
| 轮次明细 | 宿主会话日志折叠（`/usage`）：耗时 / TTFT / TPS / 模型归因 / 结束原因 / 每轮成本 | ✅ 官方事件流折叠 |
| 余额 | 官方 `GET https://api.deepseek.com/user/balance` | ✅ 官方实时数据 |
| 模型名 | adapter 上报的请求 provenance / `request/context` | ✅ 官方真实数据 |

## 技术栈

- **语言**：TypeScript 源码，发布为 DSH 可加载的 JavaScript bundle
- **框架**：[Cordis](https://github.com/cordiverse/cordis) 插件模型 + React 18
- **构建**：esbuild（host 半区 = Node ESM；client 半区 = `window.__ModuleLoader__.load({id, factory})` 工厂包，外部依赖与 DSH web 的 `PLATFORM_MODULES` 完全一致）
- **可视化**：零依赖手写 SVG（DSH web 未内置图表库；自绘与平台渲染方式一致、体积最小、最稳定）

## 安装

前置要求：**[DSH](https://github.com/deepseek-ai/deepseek-harness) ≥ 0.1.0-rc.6** · **Node.js ≥ 20** · PATH 上有 **[pnpm](https://pnpm.io/install)**（`dsh plugin` 会把安装命令转发给 pnpm）。

> 若提示 `dsh: command not found`（或 PowerShell `无法将“dsh”项识别为…`），说明只通过
> `npx @deepseek-ai/dsh` 临时运行过、未安装全局命令——按 [FAQ](#常见问题faq) 第一条解决
> （全局安装后重开终端，或每条 `dsh ...` 前加 `npx --yes @deepseek-ai/dsh`）。

### 方式一：npm 仓库安装（推荐，预构建产物，无需构建工具）

```sh
dsh plugin --profile web add dsh-usage-chart   # 安装并自动登记为 profile 插件层
dsh web --profile web                          # 启动 DSH Web（已在运行时先停止再启动）
```

更新（升级到新版本）：pnpm 对已安装的依赖重新 `add` 可能显示 `Already up to date`
而不升级，请用**显式版本**（推荐）或**先卸载再安装**：

```sh
# 方式①：显式指定目标版本
dsh plugin --profile web add dsh-usage-chart@0.2.0
# 方式②：先移除再重装（回到最新版）
dsh plugin --profile web remove dsh-usage-chart
dsh plugin --profile web add dsh-usage-chart
```

完成后重启 DSH Web。

> ⚠️ **未全局安装 dsh（报 `dsh: command not found` / PowerShell `无法将“dsh”项识别为…`）？
> 把上面每条 `dsh` 都写成 `npx --yes @deepseek-ai/dsh`**，例如
> `npx --yes @deepseek-ai/dsh plugin --profile web add dsh-usage-chart@0.2.0`
> （原因与解法见 [FAQ](#常见问题faq) 第一条）。

### 方式二：从 GitHub 安装（源码构建）

```sh
dsh plugin --profile web add github:Max-Samson/dsh-usage-chart#<commit-sha>
```

Git 安装会执行包的 `prepare` 脚本（`node build.mjs`）从源码构建。pnpm ≥ 10 首次会拒绝运行
`prepare`，需要在 profile 的 `pnpm-workspace.yaml` 中放行：

```yaml
allowBuilds:
  dsh-usage-chart: true
```

> 放行意味着允许该包源码在安装时于本机执行，请只对可信来源这么做，并固定 commit
> （`github:Max-Samson/dsh-usage-chart#<sha>`）。

### 方式三：本地目录安装（开发自测）

```sh
git clone https://github.com/Max-Samson/dsh-usage-chart.git
cd dsh-usage-chart
npm ci && npm run build
dsh plugin --profile web add "$PWD"   # 以链接方式安装当前目录
dsh web --profile web
```

### 验证安装

1. 组合配置中应出现插件行：

   ```sh
   dsh --profile web --dump-config | grep -A4 'id: dsh-usage-chart'
   ```

2. 打开 DSH Web，进入任意已有会话：输入框下方应出现「用量」指示器（含 token/成本/模型），
   右侧为余额；点击 ▸ 展开可视化面板。未配置 API Key 时余额显示 `–`，面板内会提示配置方式。

### 配置余额查询

余额查询需要 DeepSeek API Key，按以下优先级解析（每次请求实时解析，改后无需重启）：

1. **DSH 网页端配置（推荐，需插件 ≥ 0.1.1）**：在 DSH Web 的「设置 → 模型」中配置
   DeepSeek API Key。插件经 DSH 凭据服务读取同一密钥（`.credentials.yaml` 用户层），
   无需额外操作；
2. **环境变量**：启动 `dsh web` 前导出 `DEEPSEEK_API_KEY=sk-...`（凭据服务的 env 层，同样生效）；
3. **插件配置**：在 profile 的 `cordis.patch.yml` 中覆盖（Key 会以明文落盘，仅建议用于受保护的本机 profile）：

```yaml
- insert:
    - id: dsh-usage-chart
      name: dsh-usage-chart
      config:
        apiKey: 'sk-...'        # 留空则回退到网页端/环境变量
        baseUrl: 'https://api.deepseek.com'
        # pricingFile: '/path/to/pricing.json'   # 可选：价格覆盖文件（默认 $DSH_HOME/data/dsh-usage-chart/pricing.json）
```

> 插件版本 < 0.1.1 时不读取网页端密钥：请用环境变量或上面的 `config.apiKey` 配置。

未配置 Key 时，指示器显示 `余额 –`，点击可重试；面板内会提示如何配置。

### 价格覆盖（可选，v0.2+）

成本按「用户覆盖 > 内置刊例价 > 回退估算」解析（价格只在宿主解析，client 经
`/dsh-usage-chart/pricing` 快照消费，单一价格真相）。默认覆盖文件
`$DSH_HOME/data/dsh-usage-chart/pricing.json`（无 `DSH_HOME` 时 `~/.dsh/...`），
支持两种形状，文件变更即时生效：

```json
{
  "deepseek-v4-flash": { "cacheMissInput": 0.14, "cacheHitInput": 0.0028, "output": 0.28, "verifiedAt": 1755100800000 }
}
```

或 `{ "models": { "<model>": { … } } }`。`verifiedAt`（epoch 毫秒）可选，用于面板展示
核验日期；未收录的模型会在 UI 中显式标记「未定价模型」，不会静默按 0 计。

### 卸载

> ⚠️ **未全局安装 dsh（报 `dsh: command not found` / PowerShell `无法将“dsh”项识别为…`）？
> 把下面每条 `dsh` 都写成 `npx --yes @deepseek-ai/dsh`**，例如
> `npx --yes @deepseek-ai/dsh plugin --profile web remove dsh-usage-chart`
> （原因与解法见 [FAQ](#常见问题faq) 第一条）。

```sh
dsh plugin --profile web remove dsh-usage-chart   # 移除依赖并自动从 profile 插件层注销
dsh web --profile web                             # 重启后指示器/面板消失
```

`remove` 会同时清理 `node_modules` 中的包并把它从 `dsh.profile.bundles` 移除（无残留）。
彻底清理（按需）：

- 若曾在 profile 的 `cordis.patch.yml` 中写过 `config.apiKey`/`baseUrl` 覆盖块，删除该段；
- 若为 GitHub 安装加过 `allowBuilds`，可移除 `pnpm-workspace.yaml` 中对应的 `dsh-usage-chart` 条目；
- 网页端配置的 DeepSeek API Key 存于 DSH 凭据文件（`~/.dsh/.credentials.yaml`），
  **不要删除**——DSH 自身的模型服务仍在使用该密钥；只有确定不再使用 DSH 的 DeepSeek 服务时才考虑移除。

## 常见问题（FAQ）

**Q：`dsh` 命令找不到（`command not found` / PowerShell `无法将“dsh”项识别为…`）？**
A：`npx @deepseek-ai/dsh` 是临时运行、不产生全局命令。请 `npm install -g @deepseek-ai/dsh`
并重开终端（Windows 还需确保 `npm config get prefix` 目录在 PATH）；或把每条 `dsh ...`
换成 `npx --yes @deepseek-ai/dsh ...`。pnpm 缺失同理：`npm install -g pnpm`。

**Q：安装时提示 `WARN missing peer react@^18.2.0`？**
A：正常且无害——react 由 DSH Web 平台在浏览器端内置，profile 无需安装。插件 ≥ 0.1.1
已把 react 标记为可选 peer，不再报警；0.1.0 的该警告可忽略。

**Q：网页端配了 API Key，余额仍显示 `–` 或「未配置」？**
A：请确认插件版本 ≥ 0.1.1（0.1.1 起余额查询才走 DSH 凭据服务读取网页端密钥）；
升级后重启 `dsh web`。临时方案：先设环境变量 `DEEPSEEK_API_KEY` 或 `config.apiKey`。

**Q：`add` 时报 `dsh-usage-chart is not in the npm registry`？**
A：包尚未发布到 npm。请用「方式三：本地目录安装」测试，或等待维护者发布后重试。

## 参与开发

```sh
git clone https://github.com/Max-Samson/dsh-usage-chart.git
cd dsh-usage-chart
npm ci
npm run verify       # typecheck + build + node:test
npm pack --dry-run   # 检查最终发布内容
```

本地自测安装见上文「方式三」；贡献前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，
安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告。

### 可视化验证脚本（可选）

`scripts/` 下有基于 playwright-core 的探测脚本，针对**已运行**的 DSH Web（默认
`http://127.0.0.1:3080`，需要本机 Chrome/Chromium），通过环境变量与你的环境解耦：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PROBE_URL` | `http://127.0.0.1:3080` | 目标 DSH Web 地址 |
| `DSH_PROBE_CHROME` | 平台常见位置 | Chrome/Chromium 可执行文件路径 |
| `DSH_PROBE_SESSION` | 内置常用标题 | 目标会话标题片段（逗号分隔多个备选） |
| `DSH_PROBE_ARTIFACTS` | `<仓库>/artifacts` | 截图输出目录（已 gitignore） |

```sh
node scripts/shot.mjs          # 收起/展开两张截图
node scripts/probe-panel.mjs   # 面板是否被容器裁剪
node scripts/probe-popover.mjs # 悬浮面板边界与开合
node scripts/verify-render.mjs # 完整渲染验证（含明暗主题、中英文界面）
```

## 维护者发布

首次发布需要先在本地完成 npm 的账户验证并执行 `npm publish --access public`；包在 npm 上创建成功后，再为仓库配置 Trusted Publisher。之后创建 GitHub Release 即会由工作流发布新版本。工作流会检测版本是否已存在，因此补建 `v0.1.0` Release 时不会重复发布。

1. 确认 `package.json` 与 `CHANGELOG.md` 版本一致并执行 `npm run verify`。
2. 创建 `v<version>` GitHub Release。
3. `release.yml` 通过 npm Trusted Publishing 发布带 provenance 的预构建包。
4. 在 GitHub 添加 `dsh-plugin`、`dsh`、`deepseek-harness` topics，供 Awesome DSH Plugin 自动发现。

首次发布前，需要在 npm 包设置中把本仓库的 `release.yml` 配置为 Trusted Publisher，并在 GitHub 创建 `npm` environment。

## 插件结构

```
dsh-usage-chart/
├── package.json          # dsh.bundle（安装层）+ dsh.client（浏览器半区）+ exports["./client"]
├── cordis.patch.yml      # 插件行插入（config.apiKey / baseUrl / pricingFile）
├── build.mjs             # esbuild 双产物（+ client 纯模块测试束）+ tsc 类型声明（lib/types）
├── src/
│   ├── index.ts          # host 半区：/balance 余额代理 + /usage 轮次折叠 + /pricing 价格快照
│   ├── pricing/
│   │   ├── calc.ts       # 纯共享计算（成本分拆/格式化；两个半区 bundle 同一份）
│   │   ├── source.ts     # PricingSource 接缝：builtin 刊例价 + pricing.json 文件适配器
│   │   └── resolve.ts    # PricingResolver：覆盖 > 内置 > 回退，未知模型显式标记
│   ├── usage/
│   │   └── rounds.ts     # RoundFold：耗时/TTFT/TPS/模型归因/结束原因/每轮成本（纯函数）
│   └── client/
│       ├── index.ts      # client 入口：注册 composer.dock + assistant-actions 槽位
│       ├── UsageIndicator.tsx  # 输入框下方一行指示器（含上下文压力条）
│       ├── UsagePanel.tsx      # 可视化面板（汇总 / 成本 / 每轮图表 / 余额）编排根
│       ├── charts.tsx          # 零依赖 SVG/HTML 原语（堆叠条/图例）
│       ├── chart/RoundBars.tsx # 深模块柱状图（三视角 + 耗时叠加 + 异常标记 + 解释卡）
│       ├── rounds/             # observed.ts（本页观测）/ history.ts（宿主历史）/ types.ts
│       ├── diagnose/anomaly.ts # 成本突增判定（图表与徽章共享的纯模块）
│       ├── badge/CostBadge.tsx # assistant 消息尾部可关闭成本徽章
│       ├── pricing-api.ts      # usePricing：/pricing 快照消费（client 唯一价格输入）
│       ├── balance.ts          # 余额读取 hook（经宿主代理）
│       └── styles.ts           # 注入样式（<style data-plugin>）
└── types/                # vendored 最小类型声明（DSH client 包未发布稳定版）
```

## 数据与安全边界

- token 与上下文数据来自当前 DSH 会话投影；每轮图表优先读取会话日志，读取失败时会明确标注并回退到本页观测。
- 成本为官方刊例价估算（支持用户覆盖 `pricing.json`）；价格只在宿主解析，client 经 `/pricing` 快照消费，官方价格调整后可通过覆盖文件即时修正。
- 余额经宿主同源路由代理（浏览器直连官方 API 有 CORS 与密钥暴露问题）。
- Host 路由只接受同源 GET 请求，并为 JSON 响应设置 `no-store`；插件不会把 API Key 发送到浏览器。
- 自定义 API 地址必须使用 HTTPS；仅回环地址允许 HTTP，便于连接本地代理。

## 兼容性

| 组件 | 支持范围 |
|---|---|
| DSH | ≥ 0.1.0-rc.6，当前按 0.1.x API 构建 |
| Node.js | ≥ 20 |
| Web UI | React 18 / `conversation.composer.dock` + `conversation.chat.assistant-actions` |
| 系统 | macOS、Linux、Windows（纯 JavaScript，无原生依赖） |

## 社区与开源

- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)
- [支持渠道](./SUPPORT.md)
- [安全报告](./SECURITY.md)
- [第三方声明](./THIRD_PARTY_NOTICES.md)

## License

MIT
