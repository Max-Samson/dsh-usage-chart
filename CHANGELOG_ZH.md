# 更新日志（中文）

本文件记录本项目所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。英文版见 [CHANGELOG.md](./CHANGELOG.md)。

## [1.0.0] - 2026-08-15

首个完整版本：会话内用量解释器核心能力齐备——三视角轮次图（全部历史横向滚动）+ 每轮成本/耗时/异常解释卡 + 多币种成本与实时汇率 + 账户余额。

### 变更

- 每轮图表不再截断最近 12 轮：**全部**轮次渲染进横向滚动区域，柱宽固定为细柱（30px），柱宽恒定、不再拥挤；自动滚到最新轮次，内容越界时出现箭头按钮与边缘渐隐提示，滚动条细化为 5px。
- 柱顶值标签自适应密度：可滚动（密集）时仅当前轮保留柱顶数值（其余经悬浮解释卡查看）；不可滚动时省略过长标签（如 `$0.0013`、`123.4K`），杜绝相邻标签重叠。
- 图表最小宽度自适应面板宽度：轮次少时填满/居中显示且不拉伸柱宽；工具提示按「内容坐标 − 滚动偏移」精确定位并收敛进可见区。

### 修复

- 图表可滚动后工具提示定位错位：现随滚动精确跟随当前柱。
- 窄面板下短历史不必要地横向溢出：自适应最小宽度已消除。
- 余额「无密钥」用例现在隔离 `$DEEPSEEK_API_KEY`，在宿主环境已配置该密钥时测试套件仍能通过；并新增环境变量回退的用例覆盖。

## [0.3.0] - 2026-08-15

### 新增

- 成本显示币种：`config.currency`（'usd' | 'cny'）与 `config.cnyPerUsd`（默认 6.76），成本按所选币种展示。
- 成本区 USD/CNY 切换按钮，选择在浏览器中记住（localStorage）。
- 「刷新汇率」按钮：经新同源代理路由 `/dsh-usage-chart/rate`（`config.fxUrl`）拉取最新 USD→CNY 汇率并立即重估。
- 新增 `/dsh-usage-chart/meta` 路由，向客户端下发显示币种配置。

### 变更

- 刊例价注记跟随显示币种并标注所用汇率。

### 修复

- 汇率刷新健壮性：默认源不可达时自动回退内置备用源（frankfurter.dev）；上次成功汇率持久化，断网刷新沿用真实汇率而非写死默认值。
- 槽位注册改为 `ctx.slots.inject` 等待声明，修复加载顺序变化时 `slot "…" is not declared`。

## [0.2.0] - 2026-08-15## [0.2.0] - 2026-08-15

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
