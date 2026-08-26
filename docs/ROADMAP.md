# dsh-usage-chart · Roadmap

> 定位：**会话内、低侵入、准确归因的用量解释器**（in-session usage interpreter），
> 不是覆盖全局账单的“大而全成本中心”。

## 1. 定位与边界

**做什么**：在 DSH Web 输入框下方，实时回答三个问题——

1. 这一轮花了多少钱、花在哪（输入/缓存/输出、模型、耗时）；
2. 上下文为什么变大、哪一轮被压缩、释放了多少；
3. 会话 / 工作区层面的用量趋势（作为轻量二级视图）。

**不做什么**（防冗杂护栏，见 §6）：多提供商账本、订阅额度识别、拖拽悬浮窗、
宠物式 UI、大型图表库。这些已被生态内插件覆盖，或会削弱与原生 Composer Dock
融合的优势。

## 2. 竞争格局：借鉴什么、不借鉴什么

| 相似项目 | 借鉴（为我所用） | 不借鉴（避免重叠/冗杂） |
|---|---|---|
| [Ghost011118/dsh-balance-meter](https://github.com/Ghost011118/dsh-balance-meter) | 官方价格自动抓取（6h）+ 峰谷计价；按模型读请求头 | 它整体就是“余额 chip”，不做 |
| [Han-1413141/dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) | 价格配置、预算阈值、历史聚合的成熟形态 | 侧栏全量历史看板——第一版不复制 |
| [Make0209/dsh-usage-stats](https://github.com/Make0209/dsh-usage-stats) | 跨会话/工作区历史页的交互范式（30/90 天范围） | 热力图作为主入口——只做入口之一，展示“每日成本/Token”而非回合数 |
| [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) / [GooodWei/context-vista](https://github.com/GooodWei/context-vista) | “上下文为什么变大”的可解释视图 | 完整复刻上下文面板——坚持 Dock 入口 + 成本关联解释 |
| [Sttrevens/dsh-cost-meter](https://github.com/Sttrevens/dsh-cost-meter) | 每轮消息尾部成本徽章 + 明细 Tooltip | — |
| [feibi-mochi/deepseek-harness-wallet](https://github.com/feibi-mochi/deepseek-harness-wallet) | 余额告警；官方/非官方数据明确分层 | 多 provider 分账、充值跳转（远期可选） |
| [nonewind/dsh-spend](https://github.com/nonewind/dsh-spend) | 多维度统计的组织方式 | 多提供商账本、订阅额度——远期也不正面重叠 |

## 3. 可行性验证（@ DeepSeek Harness 0.1.0-rc.6，源码实测）

以下结论来自本机安装的 `@deepseek-ai/dsh@0.1.0-rc.6` 源码
（`dsh-session`、`dsh-token-meter`、`dsh-compaction`、`dsh-session-projection`），
不是猜测。若将来 API 变化，以官方包为准复核本节。

### 3.1 每个会话事件都带时间戳

`SessionEvent` 信封恒带 `seq` + `time`（Unix 毫秒）——**轮次耗时、TTFT、输出吞吐全部可从会话日志折叠得出**，无需额外事件订阅：

```ts
// @deepseek-ai/dsh-session/lib/types/types.d.ts
export type SessionEvent = {
  seq: number;      // 会话内单调递增
  time: number;     // Unix epoch 毫秒
  data: ...;
}
```

### 3.2 可消费的会话事件词汇表

| 事件 | 载荷要点 | 路线图用途 |
|---|---|---|
| `turn/start` / `turn/end` | `turn`；`reason`: `completed \| aborted \| blocked \| error \| max-tokens \| interrupted` | 轮次生命周期、耗时、结束原因（v0.2 轮次诊断、成本异常归因） |
| `step/start` / `step/end` | `turn` / `step` | 步骤边界（TTFT 归一到首个 step） |
| `assistant/chunk`（`chunk.type === 'usage'`）+ `assistant/message`（`usage`） | `TokenUsage`: `inputTokens / outputTokens / cacheReadTokens? / cacheWriteTokens? / reasoningTokens?` | 现有四桶折叠（已实现）；`reasoningTokens` 可扩展推理占比显示 |
| `request/header` | `config`（provider/model/reasoning effort）、`system`、`tools` | 按轮归因模型与系统提示（v0.2） |
| `request/context` | `provider` / `model` / `contextWindow?` | 模型路由与上下文容量（v1.1 分母） |
| `user/message` | `source`: direct human / `agent.inject()` / goal continuation | 上下文增长来源归因（v1.1） |
| `compaction/start` / `compaction/summary` / `compaction/prune` / `compaction/end` | `summary` 带 `shadowedTokenCount`、`shadowedRange{start,end}`、`shadowedSeqs`、`provider`、`model`、`usage?` | **压缩诊断完整数据源**（v1.1）：哪轮压缩、释放多少 token、哪次 summarize 调用花了多少 |

### 3.3 官方投影（无需自研估算器）

`@deepseek-ai/dsh-token-meter` 已注册三个投影，client 侧经 `useProjection` 直接消费：

| 投影 | 形状 | 说明 |
|---|---|---|
| `tokenUsage` | `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens` | 全量累计四桶（与现有 host 折叠语义一致） |
| `contextPressure` | `pressureTokens / projectedTokens / contextWindow` | 最近一次请求的 prompt 规模 + 投影值 + 容量；`projectedTokens` 已含压缩阴影定价 |
| `contextBreakdown` | `systemTokens / toolsTokens / messageTokens` | **“上下文为什么变大”官方已算好**——系统提示 / 工具 schema / 消息 的启发式分桶（v1.1 直接消费，标注为近似值） |

### 3.4 结论

- v0.2 全部数据源 ✅ 已验证；
- v1.1 上下文组成用 `contextBreakdown` 投影，压缩用 `compaction/summary.shadowedTokenCount` ✅ 已验证；
- v1.1 跨会话历史：官方另有 `dsh-session-query`（SQLite FTS5）与 `dsh-session-stats` 可作为宿主侧聚合的参考，实施时再验证。

## 4. 最优先工程项：价格治理

把价格表从代码常量升级为**带来源与时效的状态**（比任何新图表都重要）：

```
pricing 解析优先级（host 侧，每次请求实时解析）：
1. 用户覆盖：数据目录 pricing.json（{ model: { uncachedInput, cacheRead, output, cacheWrite } }）
2. 内置默认值（当前 PRICING 表迁移而来）
3. 每个条目带 lastVerifiedAt（来源：官方价格页 / 用户覆盖 / 内置默认）
4. 未知模型：显式标记（不静默按 0 计），在 UI 中标注“未定价模型”
```

- 内置默认值 + 用户覆盖 + 最后核验日期 + 未知模型显式标记；
- 官方价格可能调整（[DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)），
  用户应能知道估算依据与时效；自动抓取官方价格页（借鉴 Ghost011118 的 6h 抓取）作为远期优化，第一版先保证“可覆盖 + 可知晓”。

## 5. 路线图

### ✅ v0.2.0 — 会话成本解释力（轮次级）· 已交付 2026-08-15

**数据层**（host 折叠扩展，全部已验证，见 §3）

- 每轮折叠扩展：`turn/start → turn/end` 时间差（总耗时）、`turn/start → 首个 usage chunk`（TTFT）、`outputTokens / 输出时长`（输出 TPS）、`request/context` 模型归因；
- 每轮成本分拆（输入/缓存/输出 × 单价）随折叠一并产出，作为可视化层的数据底座；
- 价格治理（§4）落地：`pricing.json` 覆盖 + 来源/时效显示 + 未知模型标记。

**可视化层**（延续零依赖 SVG——升级现有柱状图，不新增图表种类）

- 柱状图新增 **cost 视角**：与 `absolute`（token 量）/ `ratio`（构成）并列，按各桶 × 单价堆叠为成本柱、柱顶标 $——现有 `TurnBars` 加一个 mode 即可复用全部交互（hover / 焦点 / 当前轮高亮）；
- Tooltip 升级为**解释卡**：现有 token 分桶 + 该轮成本、模型、耗时、TTFT、TPS、缓存命中率，一卡回答“这一轮发生了什么”；
- **耗时叠加层**：柱顶叠加总耗时点线（零依赖 SVG 折线），让“贵是因为慢还是 token 多”一眼可见；
- **异常轮次标记**：相对最近 N 轮成本突增的轮次加警示色描边/角标，点击显示归因 chip（缓存命中下降 / 输出增长 / 上下文膨胀，结合 `turn/end.reason`）；
- **缓存命中率迷你趋势**：每轮 hit% 以柱内小点或底部点线融入现有图，不单独成图；
- assistant 消息尾部可关闭的“本轮 ≈ $0.00xx”徽章（借鉴 Sttrevens，hook 在消息尾部槽位）；
- Dock 指示器增加细**上下文压力条**（`contextPressure.pressureTokens / contextWindow` %）——v1.1 上下文诊断的前置可视入口，体积极小。

**验收**：保持零运行时依赖；明暗主题可读（沿用 `--duc-*` CSS 变量）；键盘可达（沿用现有 tabIndex / focus 路径）；中英双语文案同步。

#### 交付记录（2026-08-15）

- 实现见 [ARCHITECTURE.md §2](./ARCHITECTURE.md)：RoundFold（`usage/rounds.ts`）、
  PricingSource 接缝（`pricing/source.ts`，builtin + file 适配器）、PricingResolver
  （`pricing/resolve.ts`）、`/pricing` 路由、RoundBars 三视角 + 耗时叠加 + 异常标记 +
  解释卡、Anomaly（`diagnose/anomaly.ts`）、CostBadge（assistant-actions 槽位）、
  Dock 压力条；`pricing.ts` 已拆分 calc/source。
- 验证：`npm run verify` 28 项测试全绿；用官方解码器对真实会话日志（26 万事件 / 22 轮）
  实测折叠正确；`scripts/verify-render.mjs` 对运行中的 DSH Web 端到端通过
  （退出码 0、无控制台错误、成本/耗时/解释卡/中英文界面均正常）。
- **运维要点**：宿主进程无插件热重载，升级 0.2.0 后必须重启 `dsh web` 才能挂载新路由
  （已写入 CHANGELOG 升级注意）。

### ✅ v0.3.0 — 多币种成本显示（USD/CNY + 实时汇率）· 已交付 2026-08-15

**目标**：成本数字以用户可读的币种呈现——默认 USD，可切换 CNY，汇率可实时刷新。

**落地内容**（PR #5）

- **显示币种**：`config.currency`（'usd' | 'cny'）+ `config.cnyPerUsd`（默认 6.76）；成本区 USD/CNY
  切换按钮，选择经 localStorage 记忆（`dsh-usage-chart:currency`）；
- **实时汇率**：「刷新汇率」经宿主 `/dsh-usage-chart/rate` 代理（`config.fxUrl` 可自定义，默认
  open.er-api.com）拉取最新 USD→CNY 并立即重估；**多源回退**（配置源 → 内置 frankfurter.dev），
  **上次成功汇率持久化**（`dsh-usage-chart:rate`），断网刷新沿用真实汇率而非写死默认值；
- **配置下发**：`/dsh-usage-chart/meta` 向 client 下发显示币种与汇率配置；价格注记跟随显示币种
  并标注所用汇率；
- **健壮性**：槽位注册改 `ctx.slots.inject` 等待声明，修复加载顺序变化时的 `slot "…" is not declared`。

**交付记录**：`npm run verify` 31 项测试全绿（新增汇率/币种用例）。本版实现偏离原 v0.3 定义
（上下文诊断）——货币显示为更高优先的工程项，上下文诊断顺延为 v1.1（见下），README 与架构文档
已同步。

### ✅ v1.0.0 — 首个完整版本：每轮图表横向滚动（视觉去拥挤）· 已交付 2026-08-15

> v1.0.0 定位：会话内用量解释器核心能力齐备——三视角轮次图（全部历史横向滚动）+ 每轮成本/
> 耗时/异常解释卡 + 多币种成本与实时汇率 + 账户余额。本次把轮次图从「最近 12 轮」升级为
> 「全部轮次横向滚动」，作为首个完整版本的收官项。

**问题**：轮次图最多显示最近 12 轮（`MAX_VISIBLE_ROUNDS`），柱宽随轮次增多变粗、值标签拥挤，
更早轮次完全不可见。

**落地**（延续零依赖 SVG，全部在 RoundBars 深模块内，不改接口）：

- **全部轮次 + 横向滚动**：去掉 12 轮截断，所有轮次渲染进 `overflow-x: auto` 容器；固定细柱宽
  （30px）+ 宽松间距，柱宽恒定，不再「较粗、视觉拥挤」；超出视口可左右滑动查看更早轮次；
- **自动滚到最新**：数据更新或切换视角时自动滚回最新轮次（当前轮高亮始终可见）；
- **越界提示**：可滚动时出现左右箭头按钮（`‹ ›`，可点击翻页滚动）+ 边缘渐隐 + 细滚动条；
- **值标签自适应**：密集（可滚动）时仅当前轮保留柱顶数值，其余轮次经悬浮解释卡查看，杜绝相邻
  标签重叠；不可滚动时省略过长的文本（如 `$0.0013`）；
- **最小宽度自适应容器**：轮次少时图表填满/居中显示且不拉伸柱宽（SVG 单位恒为 1:1 CSS px）；
  工具提示用「内容坐标 − scrollLeft」精确定位并收敛进可见区，滚动后不错位。

**验证**：新增 `scripts/probe-chart.mjs`（esbuild 打包 RoundBars + 合成数据，headless Chromium
独立渲染，无需运行 DSH Web）断言滚动/几何契约（全轮次渲染、溢出可滚、自动到最新、箭头显隐、
柱宽 30/槽距 40、值标签零重叠、短历史不滚动、解释卡在可见区、耗时点线/异常标记/当前轮描边
几何不变）；`npm run verify` 31 项测试全绿。
### ✅ v1.0.1 / v1.0.2 — 官方双币种刊例价与计费时段精确对齐 · 已交付 2026-08-26

> 定位：成本计算底座全面对齐 DeepSeek 官方刊例价体系（中/英文双页同价）与高峰/空闲精确窗口。

**落地内容**：

- **官方双币种刊例价（无需汇率换算）**：内置价表每个时段同时收录官方 CNY 与 USD 刊例价，成本按所选显示币种直接计算；
- **高峰/空闲（休闲期）时段精准判定**：`tierAt` 与 `isPeakHour` 引入星期维度判断（北京时间 UTC+8）——高峰时段严格限定为**周一至周五 09:00–12:00、14:00–18:00**（2 倍计费），**周六、周日全天及工作日其余时段为半价空闲时段**，彻底修复周末成本高估；
- **新模型收录**：收录 `deepseek-v4-flash-vision-exp` 模型定价；官方价表核验时间更新至 2026-08-26；
- **当前计费时段实时标注**：面板头部以红（高峰）/ 绿（空闲）tag 实时标注当前计费时段，跨整点与周末自动翻转。


### ✅ v1.1.0 — 上下文可解释性与压缩诊断 · 已交付 2026-08-26

**目标**：把「上下文为什么变大、哪一轮被压缩、释放了多少、压缩摘要自身花了多少」变成可解释视图（Dock 入口 + 面板诊断专区），同时支持输入来源归因。

**落地内容**：

1. **compaction 折叠**（Host，`usage/compactions.ts`）：从会话日志折叠压缩记录
   `{ seq, startedAt, endedAt, turn, shadowedTokenCount, shadowedRange, shadowedSeqs, model, summarizeUsage, cost }`，
   纯函数 + 合成事件流测试，`/usage` 路由聚合下发；
2. **ContextReport**（Client，`diagnose/context.ts`，纯函数）：
   `analyzeContext(pressure, breakdown, compactions, currency) → report`——容量占用率 + 三段构成占比（系统/工具/消息）+ 压缩聚合统计 + 阈值建议（`caution` ≥75%、`critical` ≥90%）；
3. **Dock 压力条深化**：
   消费官方 `contextBreakdown` 投影，在指示器压力条内将系统（蓝）、工具（橙）、消息（绿）按比例分段渲染，悬浮展示各段百分比，无 breakdown 时自动平滑回退；
4. **面板上下文与压缩诊断小节**：
   三列展示构成卡片 + 分段条 + 启发式近似注记 + 压缩时间线（轮次/释放量/summarize 成本）+ 优化建议条；
5. **轮次增长来源归因**：
   Host 端 `foldRounds` 提取 `user/message` 来源（`human` / `agent.inject` / `continuation`），图表 Tooltip 解释卡显式展示来源标识。

**交付记录（2026-08-26）**：
- 纯函数纯模块：零运行时依赖，测试集由 31 项扩充至 **39 项全绿**；
- 中英双语完整覆盖；深浅主题自适应；保持键盘可达。

### ⚡ v1.1.x — 工程性能与交互体验收敛（高性价比优化）

**目标**：保障超长会话下的秒开体验与配置调试流畅度。

1. **超长会话增量折叠与缓存（Large Session Incremental Fold）**：
   - 现状：目前每次请求均从 `seq=0` 线性扫描全量事件。
   - 优化：在 Host 端按 `lastFoldedSeq` 做增量计算与内存缓存，前端仅按需获取可视轮次，支撑数十万事件大型会话的流畅响应；
2. **`/pricing` 快照即时刷新通道**：
   - 在用量面板添加「刷新价格配置」交互，用户修改 `pricing.json` 后主动失效缓存，无需等待 5 分钟缓存过期即可立即生效；
3. **会话作用域状态精细化**：
   - 细化区分「会话未激活/跨工作区」、「首轮流式响应中」与「会话解析失败」，优化骨架屏与针对性提示，避免统一误读为“暂无数据”；
4. **官方价格定期自动探测（远期选配）**：
   - 借鉴 6h/12h 后台轻量探测官方价格更新，当官方调价时自动提示更新或刷新内置表。

### 📊 v1.2.0 — 跨会话轻量概览（二级扩展视图 · 选配）

**目标**：满足用户跨会话复盘 Token 消耗走势的需求，保持低侵入设计（独立设置页/二级弹窗，不干扰输入框主区）。

1. **多周期趋势看板**：近 7 天 / 30 天的每日 Token 消耗与成本折线图，展示缓存命中率的长期走势（评估 Prompt 优化效果）；
2. **GitHub 风格每日用量热力图**：展示“每日成本 / Token”而非单纯回合数；
3. **账单数据导出与隐私清理**：
   - 支持一键导出当前会话或历史用量为 CSV / JSON；
   - 提供“一键清除本地聚合历史”按钮，严格守住本地隐私边界；
4. **轻量持久化**：只持久化聚合数据（或从会话日志按需索引），不建立重型数据库。

### 🛡️ v1.3.0 — 预算警戒线与稳定收敛

**目标**：防止 Agent 递归死循环/超长任务造成意外高额扣费，冻结对外契约。

1. **单会话预算告警（Budget Guard）**：
   - 允许在配置中设置单会话成本软阈值（如超 ¥5.00 / $1.00 弹出温和提醒），避免 Agent 递归死循环造成账单失控；
2. **余额不足预警与官方直达链接**：
   - 当官方余额低于预设安全线时高亮预警，并提供官方充值后台的直达跳转链接；
3. **数据格式与配置契约冻结**：
   - 冻结 `pricing.json` Schema、历史数据聚合格式与外部 API，确保长期向下兼容。
## 6. 明确不做（防冗杂护栏）

- 多提供商价格知识库与订阅额度识别（`dsh-spend` 已覆盖较深）；
- 拖拽悬浮窗、宠物式 UI 等展示层（削弱 Composer Dock 融合优势）；
- 引入大型图表库（现有零依赖 SVG 已具备 Tooltip、当前轮高亮、构成/绝对值切换，继续维护）；
- 与 `dsh-context` 全面重叠的上下文面板（坚持 Dock 入口 + 成本关联解释的差异化）。

## 7. 技术边界（贯穿始终）

- **Host 半区**：路由、余额代理、pricing 解析、历史聚合/持久化（写文件）、密钥解析——密钥永不出 Host；
- **Client 半区**：`conversation.composer.dock` 槽位、`useProjection` 消费官方投影、零依赖 SVG；
- **安全**：同源 GET + `sec-fetch-site` 校验 + `no-store`（沿用现有 `isTrustedRequest`）；
- **体积**：保持零运行时依赖，TypeScript 源码 + esbuild 双产物构建不变。

---

*本文件是产品方向的单一事实来源；实施时以 §3 的已验证 API 为准，API 变化先更新 §3 再动代码。*
