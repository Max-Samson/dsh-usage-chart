# 更新日志（中文）

本文件记录本项目所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。英文版见 [CHANGELOG.md](./CHANGELOG.md)。

## [0.2.0] - 2026-08-15

### 新增

- **每轮成本解释力（v0.2，见 `docs/ROADMAP.md`）**：宿主折叠
  （`RoundFold`，`src/usage/rounds.ts`）现在逐轮推导**总耗时**（`turn/start → turn/end`）、
  **TTFT**（start → 首个 usage 样本）、**输出吞吐**（tokens/s）、**模型归因**
  （`request/context` → `request/header` → 跨轮携带回退）、**结束原因**，以及**每轮成本分拆**
  （输入 / 缓存命中 / 输出 × 单价）。
- **价格治理**：`src/pricing.ts` 拆分为纯数学模块（`pricing/calc.ts`，两个半区 bundle 同一份）
  与 host 专用 `PricingSource` 接缝（`pricing/source.ts` —— 带核验日期的内置刊例价 +
  支持变更监听的用户覆盖 `pricing.json` 文件适配器），以及 `PricingResolver`
  （`pricing/resolve.ts`，优先级：文件 > 内置 > 回退，未知模型显式标记）。
  新增 `/dsh-usage-chart/pricing` 路由导出解析快照 —— client 的**唯一**价格输入（ADR 2），
  旧的 client 内置价格常量不再与宿主解析漂移。
- **`/usage` 路由**改为返回 `rounds`（含成本 / 时序 / 模型 / 结束原因），不再返回裸 `turns`
  （`foldTurnUsage` 保留为 v0.1 兼容出口）。
- **RoundBars 成本视角**：第三个图表模式按成本（各桶 × 单价）堆叠；柱顶叠加**总耗时点线**；
  相对最近 N 轮成本突增的轮次（`src/client/diagnose/anomaly.ts`）加**警示标记**与归因 chip；
  柱底加每轮**缓存命中迷你刻度**；悬浮提示升级为**解释卡**（token 分桶 + 成本 + 模型 +
  耗时 + TTFT + TPS + 缓存命中 + 结束原因 + 异常 chip）。
- **成本徽章**：每条助手消息尾部显示可关闭的「本轮 ≈ $0.00xx」徽章
  （`conversation.chat.assistant-actions` 槽位，数据来自宿主 `/usage` 历史）。
- **Dock 上下文压力条**：指示器内的细压力条（`contextPressure`），随占用升高由绿转黄再转红。
- **测试**：`tests/rounds.test.mjs`（折叠的耗时/TTFT/TPS/模型/成本 + 路由）、
  `tests/pricing.test.mjs`（解析优先级、临时目录文件源、未知标记 + 路由）、
  `tests/anomaly.test.mjs`（突增判定与归因）；`npm run verify` 共 28 项通过。
- **配置**：可选 `config.pricingFile` 覆盖默认的 `$DSH_HOME/data/dsh-usage-chart/pricing.json`
  （无 `DSH_HOME` 时回退 `~/.dsh/...`）。

### 修复

- 成本估算单一真相：指示器与面板的实时成本都消费 `/pricing` 快照；面板展示价格来源、
  核验日期与「未定价模型」标记。
- 面板成本解析优先使用宿主折叠的**权威模型归因**（ADR 1），不再依赖快照 provenance
  （老会话快照可能缺失模型字段，此前会误标「回退估算」来源）。

### 升级注意

- **升级到 0.2.0 后必须重启 `dsh web`。** 宿主进程会把插件代码缓存进内存（无热重载）：
  新的 `/dsh-usage-chart/pricing` 路由与 `rounds` 形状的 `/dsh-usage-chart/usage` 响应
  只有重启后才会生效。在此之前指示器会静默隐藏成本位、面板显示「价格快照不可用」。

## [0.1.1] - 2026-08-14

### 新增

- 余额查询现在通过 DSH 凭据服务（`ctx.get('credentials')`）解析 DeepSeek API Key，
  在网页端（设置 → 模型）或 `.credentials.yaml` 中配置的密钥无需环境变量或插件配置即可生效。

### 修复

- 安装警告 `missing peer react@^18.2.0`（react 由 DSH web 平台内置；peer 现标记为可选）。
- 文档：README 补充卸载/清理步骤。

## [0.1.0] - 2026-08-14

### 新增

- 输入框下方的用量指示器与可展开的 SVG 仪表盘。
- 会话 token、缓存、上下文压力、模型与成本估算视图。
- 每轮用量柱状图：总量/构成视图、悬浮与键盘 Tooltip、当前轮高亮；宿主侧从会话日志
  按轮聚合。
- 宿主侧 DeepSeek 余额代理。
- 完整中英文本地化：指示器、面板、图表与余额视图跟随 DSH 应用内语言设置
  （经 `locale` 服务；浏览器语言只做初始兜底）。
- 发布元数据、双语文档、CI、贡献/安全策略，以及可移植的视觉探测脚本（`scripts/*.mjs`）。
- 隐私安全的 README 演示截图（虚构用量数据，不含任何账户数据）。

### 修复

- 浅色主题可读性：指示器、面板与 SVG 图表改用 DSH 主题 token
  （`--dsw-alias-label-*` / `--dsw-alias-bg-*`）与主题静态色板，明暗外观下文字与
  图表分桶均清晰可读。

### 安全

- Host JSON 路由仅接受同源 GET 请求。
- 自定义 API 地址强制 HTTPS；仅回环地址允许 HTTP（便于连接本地代理）。
- 聚合前校验 token 用量样本。
