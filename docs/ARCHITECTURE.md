# dsh-usage-chart · 功能模块架构

> 设计语言：深模块（deep module）——小接口、大实现、清晰接缝、接口即测试面。
> 词汇：**模块 / 接口 / 深度 / 接缝（seam）/ 适配器（adapter）/ 杠杆（leverage）/ 局部性（locality）**。
> 目标版本：v0.2（会话成本解释力）→ v0.3（多币种成本显示）→ **v1.0（首个完整版本：全部轮次横向滚动）** → v1.1（上下文诊断）→ v1.2（跨会话概览），见 [ROADMAP.md](./ROADMAP.md)。

## 1. 现状地图（v1.1.9）

```
Host 半区（Node）：src/
├─ index.ts                  apply：/balance、/usage、/pricing、/meta、/rate
├─ usage/rounds.ts            RoundFold：轮次用量 / 成本 / 时序 / 来源
├─ usage/compactions.ts       CompactionFold：压缩历史
└─ pricing/
   ├─ calc.ts                两半区共享的纯数学
   ├─ source.ts              builtin / pricing.json 来源适配器
   └─ resolve.ts             来源优先级解析

Client 半区（浏览器）：src/client/
├─ index.ts / context.ts      槽位注册 / 最小 Context 类型
├─ UsageIndicator.tsx         Dock 编排根、实时成本调停、压力条
├─ UsagePanel.tsx             面板编排根
├─ chart/RoundBars.tsx        三视角图表、耗时叠加、解释卡
├─ rounds/                   observed / history / summary / types
├─ diagnose/                 anomaly / context（纯函数）
├─ badge/CostBadge.tsx        消息尾部成本徽章
├─ pricing-api.ts            /pricing 快照消费
└─ currency / balance / snapshot / i18n / styles / charts
```

客户端 Context 的最小自包含声明位于 `src/client/context.ts`（slots / locale）；宿主 Cordis 类型位于 `types/cordis.d.ts`。客户端不再依赖已退役的 `dsh-client-runtime`。

**深模块（保持方向，继续加深）**：

- `foldRounds`（host，纯函数）：`events → { totals, rounds }`——折叠语义、去重、回退 + 耗时/TTFT/TPS/模型归因/结束原因/每轮成本，✅ 深模块。
- `RoundBars`（client，React）：`{ rounds, mode: absolute|ratio|cost, flags, locale } → 图表`——三视角 + 耗时叠加 + 异常标记 + 解释卡，✅ 深模块。
- `filePricingSource` / `createPricingResolver`（host）：价格「来源」与「优先级」分离，接缝成型（ADR 2）。
- `currency.ts`（client，v0.3）：`/meta` 配置 + 用户切换 + `/rate` 实时汇率的单点状态（store），成本币种只有一处真相。

**摩擦点（v0.1 记录 → v0.2 处置）**：

1. **两套折叠实现**（host `foldRounds` vs client 观测）：**决策 2 维持独立**——client 观测服务实时开轮（`rounds/observed.ts`），host 折叠是权威基准（`rounds/history.ts`）；指示器在历史追上投影时使用逐轮成本，否则显示标记为估算的实时成本，面板共用这份汇总。
2. **两条价格路径会分叉**：✅ **已解决**——`pricing.ts` 拆为 `calc.ts`（纯数学，两半区共享）+ host `source/resolve`；client 唯一价格输入是 `/pricing` 快照（ADR 2），不再内置价格常量。
3. **模型归因两个来源**：✅ **已收敛**——host `foldRounds` 从 `request/context` 等事件按轮归因（权威）；指示器与面板使用同一调停结果：历史与投影一致时优先 host 模型，否则优先实时节点，再按可用来源回退。节点模型按 `provenance` → `providerMetadata` → `requestConfig` 回退。
4. **派生计算内联在编排根**：✅ **已下沉**——异常判定（`diagnose/anomaly.ts`）、成本解析（`pricing-api.ts`）、图表（`chart/RoundBars.tsx`）均为独立模块，`UsagePanel` 只做编排。

**v0.2 / v0.3 / v1.0 落地后的新观察（记录，供 v1.1 决策）**：

- 宿主无插件热重载：升级后必须重启 `dsh web`（运维契约，见 CHANGELOG）；
- `ctx.sessions.get` 只解析当前已加载会话，跨工作区/未加载会话返回 `session-not-found`；
- 大会话（26 万事件）折叠正确，但每请求全量计算 + 全量传输（v1.2 HistoryStore 一并考虑截断/缓存）。

## 2. 当前模块地图（v1.1.9）与可选扩展（v1.2）

### 2.1 Host 半区

| 模块 | 接口（小） | 实现（深） | 接缝 / 适配器 |
|---|---|---|---|
| **RoundFold**（`usage/rounds.ts`） | `foldRounds(events) → { totals, rounds }`，`Round = { turn, buckets, model, startedAt, endedAt, durationMs, ttftMs, outputTps, endReason, userSource, cost }` | 四桶 + 轮次耗时/来源/模型/成本；0.2.x 读取 message/attempt 的 usage 与 stream，TTFT 取首 token，TPS 分母为各次流式生成时长之和；旧日志保留 chunk/usage 回退（详见 2.5） | 纯函数，无 IO；测试喂合成事件流 |
| **PricingResolver**（`pricing/resolve.ts`） | `resolve(model) → { pricing, source, verifiedAt, estimated, known, unpriced }` | 优先级解析（覆盖>内置>回退）、峰谷时段、未知模型标记、来源/时效标注；键匹配走 `matchPricingKey`（精确 > 最长前缀，Claude 仅接受日期快照后缀）；未收录的 Claude 不套 DeepSeek 回退价（`unpriced`，单价全零） | **接缝：PricingSource**（见 2.3） |
| **PricingCalc**（`pricing/calc.ts`） | `estimateCost / formatTokens / buckets 数学` | 纯共享计算，两个半区 bundle 同一份 | 无 IO；不解析来源 |
| **HostRoutes**（`src/index.ts`） | 注册 `/usage` `/balance` `/pricing` `/meta` `/rate` | 编排 RoundFold + PricingResolver + 安全守卫（沿用 `isTrustedRequest`） | 适配器：`webServer` 接缝 |
| **HistoryStore**（`history/store.ts`，v1.2） | `appendSample(round)` / `queryRange(from, to) → rows` | 聚合/按天落盘、索引、一键清除、导出 | **接缝：历史存储**（2.3） |

### 2.1.1 统一价格与汇率契约（v1.1.9）

- `createPricingResolver(file?, cnyPerUsd?)` 与 client `resolvePricing(table, model, cnyPerUsd?)` 都按文件 → 内置顺序解析，再在各来源内精确／最长有效前缀匹配。快照携带 `source`，不能拍平后忽略来源优先级。
- 每个 `PriceTier` 可带 `baseCurrency: 'usd' | 'cny'`：只有一种原币种时设置。`pricingAtRate` 从原币种重算派生报价，不修改内置表／文件快照；明确给出的双币种价格不设置标记、保持原价。允许高峰／空闲分别采用单币种或双币种形状。
- 唯一展示汇率来自 client `currency.ts` store：配置／默认 → 上次成功值 → 手动刷新。`/pricing` 用配置值补全初始形状并保留原币种标记；client 按当前 store 值重新补全。
- HistoryFeed 将当前汇率显式传给 `/usage?session=…&cnyPerUsd=…`，宿主用该汇率折叠轮次和压缩成本；非法参数回退配置值。参数仅控制展示，不修改事件，不保存历史账单汇率，也不改变其他标签页。
- HistoryFeed 的请求缓存与状态身份均为“会话 + 汇率”，请求版本防止旧响应回写。指示器、消息徽章共用该身份；观测回退与面板单价说明传同一汇率。刷新使换算金额重新估值，双币种原价不变。
- 面板成本构成与 RoundBars 统一为输入（未命中 + 写缓存）、缓存命中、输出；费用不得漏桶。

### 2.2 Client 半区

| 模块 | 接口（小） | 实现（深） | 接缝 / 适配器 |
|---|---|---|---|
| **LiveObservation**（`rounds/observed.ts`） | `useObservedRounds(totals, nodes, pricing, currency, cnyPerUsd) → ChartRound[]` | 投影 delta 增量观测 + 轮次封存——指示器与面板回退路径，只回答“本页加载以来的增量”，如实标注 | 投影实时路径（见 2.4） |
| **HistoryFeed**（`rounds/history.ts`） | `useHistoryRounds(sessionId, cnyPerUsd) → { rounds, status, totals, load }` | 宿主 `/usage` 完整历史折叠；指示器与面板共享实例，徽章读取同一路由；实时投影变化后去抖刷新 | 路由历史路径（见 2.4） |
| **RoundBars**（`chart/RoundBars.tsx`） | `{ rounds, mode: absolute\|ratio\|cost, locale } → 图表` | 三种视角堆叠 + 耗时点线叠加 + 异常轮次标记 + 缓存命中迷你趋势 + Tooltip 解释卡；v1.0.0 起**全部轮次**渲染进横向滚动容器（固定细柱宽、自动滚到最新、箭头/渐隐提示越界），零依赖 SVG | 复用现有交互路径（hover/focus/当前轮高亮） |
| **Anomaly**（`diagnose/anomaly.ts`） | `flagAnomalies(rounds, options?) → { turn, costCny, reasons[] }[]` | 相对近 N 轮成本突增判定 + 归因（缓存命中下降/输出增长/上下文膨胀，结合 `endReason`） | 纯函数；图表与徽章共享 |
| **ContextReport**（`diagnose/context.ts`，v1.1） | `analyzeContext(pressure, breakdown, compactions, currency) → ContextReport` | 组成（官方 `contextBreakdown`）+ 压缩时间线（`compaction/summary`）+ 阈值建议 | 纯函数，喂投影与事件折叠结果 |
| **CostBadge**（`badge/CostBadge.tsx`，v0.2） | 挂 `conversation.chat.assistant-actions` 槽位，props = 当前消息轮次成本 | 每轮成本 → 可关闭“本轮 ≈ $0.00xx”徽章；数据来自 HistoryFeed（host `/usage`） | 槽位适配器 |
| **Composition roots**（`client/UsageIndicator.tsx`、`client/UsagePanel.tsx`） | 只做编排，不内联派生 | 派生全部下沉到上面模块 | — |
| 保留 | `client/balance.ts`、`client/i18n.ts`、`client/styles.ts`、`client/snapshot.ts` | 现状即合理 | — |

### 2.3 两个真正的接缝（两个适配器才算）

**① PricingSource 接缝**（v0.2 落地）：

```
PricingSource = { resolve(model): ResolvedPricing }   // 接口
├─ builtinSource    适配器：内置刊例价常量（现状迁移）
├─ fileSource       适配器：数据目录 pricing.json（用户覆盖，host 读文件+变更监听）
└─ officialFetchSource  适配器（远期）：定时抓官方价格页（借鉴 dsh-balance-meter 6h 策略）
```

两个适配器 → 真接缝。**解析只在 host**；client 经 `/pricing` 拿解析快照做实时计算——单一价格真相，杜绝两条路径分叉。

**② HistoryStore 接缝**（v1.2 落地）：

```
HistoryStore = { appendSample(round), queryRange(from,to) }   // 接口
├─ jsonlStore      适配器：按天 JSONL（借鉴 dsh-token-usage）
├─ aggregateStore  适配器：滚动聚合（体积更小）
└─ memoryStore     适配器：测试用 in-memory fake
```

### 2.4 数据路径接缝（已存在，显式化）

- **权威历史**：host 路由 `/usage`（RoundFold 折叠完整日志）→ HistoryFeed（指示器、面板、徽章）；
- **实时开轮**：官方投影 `tokenUsage` delta → LiveObservation（指示器，仅本页增量）；
- **上下文**：官方投影 `contextPressure` / `contextBreakdown` 直接 `useProjection` 消费。
- 两条折叠路径仍独立（决策 2）：历史追上投影时采用逐轮成本，投影领先时采用带估算标记的实时成本并刷新历史；指示器与面板共用同一份调停结果，client 观测不替代 host 折叠。

### 2.5 DSH 0.1.x / 0.2.x 适配契约

- 用量：0.1.x 使用 `assistant/chunk` usage 与 `assistant/message.usage`；0.2.x 的消息优先读取 `data.usage`，缺席时读取 stream 最后一条 usage，失败的 `assistant/attempt.stream` 也计费。每次已结算失败尝试独立入账，后续重试不会覆盖它。
- TTFT：`turn/start` → 首个携带 token 的流片段；跳过结构记录与空片段，工具名 delta 也算 token。旧日志无流时间线时回退到首个 usage 样本。
- TPS：0.2.x 为输出 token ÷ 各条 message/attempt 的首/末 token 时间差之和，排除工具与步骤间等待；时长为零时返回 null。无流时间线的旧日志沿用首个 usage → turn/end。
- 来源：0.1.x 字符串原样保留；0.2.x `{ kind }` 中 `user` / `user-*` 归为 human，其他运行时注入按当前来源归一化逻辑展示。
- 验证边界：两代事件形状有单元回归；PR 作者报告了 0.2.1-rc.2 链接构建浏览器冒烟。移除 runtime inject 后的 0.1.x 实机安装及双版本干净 profile 安装未因此获证，不能从测试全绿推断。

## 3. 版本落地映射

| 版本 | 落地的模块 | 删除/重构 | 状态 |
|---|---|---|---|
| v0.2.0 | RoundFold 加深（耗时/TTFT/TPS/**模型归因 `request/context`+回退**/结束原因）、**PricingSource 接缝现在就立**（builtin + file 适配器）+ Resolver、`/pricing` 路由、RoundBars cost 模式 + 叠加 + 异常标记、Anomaly、CostBadge、Dock 压力条 | `pricing.ts` 拆分 calc/source；LiveObservation / HistoryFeed **保持独立**（决策 2）；`usage-api.ts` 移除 → `rounds/` | ✅ 已交付 2026-08-15 |
| v0.3.0 | **多币种成本显示**：`config.currency`/`cnyPerUsd`、`/meta` 配置下发、`/rate` 实时汇率代理（多源回退 + 上次汇率持久化）、client `currency.ts` store（切换 + localStorage） | 成本格式化下沉 `pricing/calc.ts`（`formatUsd` → 多币种）；槽位注册改 `ctx.slots.inject` 等待声明 | ✅ 已交付 2026-08-15 |
| v1.0.0 | **首个完整版本**：RoundBars 全量轮次横向滚动（固定细柱宽、自动滚到最新、箭头/渐隐提示越界）、值标签自适应、图表最小宽自适应、`scripts/probe-chart.mjs` 验证脚本 | 移除 12 轮截断（`MAX_VISIBLE_ROUNDS`）；工具提示改「内容坐标 − scrollLeft」定位 | ✅ 已交付 2026-08-15 |
| v1.1.0 | ContextReport（`diagnose/context.ts`）、compaction 折叠（独立 `usage/compactions.ts`）、Dock 压力条深化（breakdown 分段 + 悬浮详情）、输入来源归因（`userSource`） | 压力条用 `contextPressure` + `contextBreakdown` 投影，不新开路由；`contextBreakdown` 消费标注近似值；`/usage` 路由返回 compactions | ✅ 已交付 2026-08-26 |
| v1.1.8 | DSH 0.2.x peer / Context 类型适配、providerMetadata 模型回退、message/attempt 用量与首 token 时序、来源归一化 | 移除退役 runtime peer/inject/类型导入；补齐 manifest、模型与事件回归 | 已发布 2026-10-22；实机验证边界见 2.5 |
| v1.1.9 | Claude 标准定价、cacheWrite 单价、模型 ID 归一化、未定价下限；来源优先级一致、共享 FX 与完整成本分项 | PriceTier 原币种元数据与纯换算；HistoryFeed 会话＋汇率身份／旧响应保护；补充双语说明 | 内容定稿 2026-11-10；85 项测试与隔离浏览器验证，npm 由维护者发布；不等于 DSH 干净安装认证 |
| v1.2.0 | HistoryStore 接缝 + 设置页历史视图、导出 | 热力图作为入口之一（复用 RoundBars 的 SVG 设施） | 可选 |

## 4. 测试面（接口即测试面）

| 模块 | 测试方式 | 现有设施 |
|---|---|---|
| RoundFold | node --test 喂两代合成事件流，覆盖 stream-only usage、失败/重试、首 token 与跨步骤 TPS | ✅ `tests/rounds.test.mjs`（合成数据，不读取私人会话日志） |
| PricingResolver | 注入 source map fake（builtin/file），断言优先级与未知标记 | ✅ `tests/pricing.test.mjs` + `tests/pricing-consistency.test.mjs`（真实文件与快照、来源优先级、双向换算、历史/压缩路由） |
| Anomaly | 喂 round 序列断言 flag | ✅ `tests/anomaly.test.mjs`（经 `lib/client-test.js` 束） |
| 币种/汇率（v0.3） | 断言 `normalizeFxUrl`、`fetchLiveRate` 多源回退、`/meta`/`/rate` 路由 | ✅ `tests/core.test.mjs` + `tests/currency-history.test.mjs`（恢复、失败保留、会话/汇率切换、乱序响应与去重） |
| Compaction 折叠（v1.1） | 喂合成压缩事件流，断言 shadowed 规模与 summarize 成本核算 | ✅ `tests/compactions.test.mjs` |
| 上下文诊断（v1.1） | 喂投影与压缩历史，断言容量、分段比例与优化建议 | ✅ `tests/compactions.test.mjs`（经 `lib/context-test.js` 束） |
| 来源归因（v1.1） | 喂带 `source` 的 `user/message` 事件，断言 `userSource` 归因 | ✅ `tests/compactions.test.mjs` + `tests/rounds.test.mjs`（字符串与对象来源） |
| manifest / 模型兼容 | peer 与 lock 根元数据、发布声明、README 截图清单、模型回退 | `tests/manifest.test.mjs` + `tests/merge-regression.test.mjs` |
| UsagePanel | 真实组件静态渲染，断言双语/双币种分项、比例、汇率与写缓存说明 | ✅ `tests/usage-panel.test.mjs`；不等同实机安装/视觉验收 |
| HistoryStore（v1.2） | memory fake + 临时目录 JSONL 真写读 | 待 v1.2 |
| HistoryFeed / RoundBars / CostBadge | playwright-core 视觉验证（现有 `scripts/probe-*.mjs` 扩展） | `scripts/verify-render.mjs`；本次发布应单独记录运行时版本/profile/结果，不沿用旧版本结果 |

> 运行 `npm run verify` 检查当前测试数量与结果。

## 5. ADR 备忘（本设计的决策点）

1. **Host 权威折叠**：客户端投影只服务「实时开轮 + 上下文」，完整历史一律 host 折叠——避免两套折叠各自漂移。
2. **价格解析只在 host**：client 永不读价格来源文件；`/pricing` 快照是 client 唯一价格输入。
3. **不建推送通道**：维持「路由读历史 + 投影读实时」两条路径，在指示器编排根单点调停成本与模型，并把同一结果交给面板。
4. **异常判定是共享纯模块**：图表与徽章都要用，不埋在 RoundBars 内部。
5. **零运行时依赖不破**：所有新图继续零依赖 SVG；不引入图表库。

---

*本文件与 ROADMAP.md 配套：ROADMAP 定「做什么」，本文定「模块长什么样、接缝在哪、怎么测」。实施时按 §2 模块地图落文件，按 §4 补测试。*
