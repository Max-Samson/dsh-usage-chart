# dsh-usage-chart · 功能模块架构

> 设计语言：深模块（deep module）——小接口、大实现、清晰接缝、接口即测试面。
> 词汇：**模块 / 接口 / 深度 / 接缝（seam）/ 适配器（adapter）/ 杠杆（leverage）/ 局部性（locality）**。
> 目标版本：v0.2（会话成本解释力）→ v0.3（多币种成本显示）→ **v1.0（首个完整版本：全部轮次横向滚动）** → v1.1（上下文诊断）→ v1.2（跨会话概览），见 [ROADMAP.md](./ROADMAP.md)。

## 1. 现状地图（v1.0.0 · 已交付，23 个源文件）

```
Host 半区（Node）                           Client 半区（浏览器）
┌──────────────────────────────────┐        ┌──────────────────────────────────────────┐
│ src/index.ts                     │        │ client/index.ts       槽位×2 + locale 注册│
│  ├─ apply(): 注册 5 路由           │        │ client/UsageIndicator  Dock 编排根 + 压力条 │
│  │   /balance  余额代理            │◄──────►│ client/UsagePanel      面板编排根（薄）     │
│  │   /usage    会话日志折叠(rounds) │        │ client/charts          原语 HStack/Legend   │
│  │   /pricing  价格解析快照         │        │ client/chart/RoundBars 深模块：三视角+叠加   │
│  │   /meta     币种/汇率配置下发    │        │ client/rounds/         observed+history     │
│  │   /rate     实时汇率代理(多源)   │        │ client/diagnose/       anomaly（纯）        │
│  ├─ usage/rounds.ts  RoundFold    │        │ client/badge/          CostBadge            │
│  └─ pricing/                      │        │ client/pricing-api     usePricing(/pricing) │
│       ├─ calc.ts     纯共享数学     │◄──────►│ client/currency.ts     币种/汇率 store       │
│       ├─ source.ts   PricingSource │        │ client/balance + snapshot + i18n + styles   │
│       └─ resolve.ts  Resolver     │        └──────────────────────────────────────────┘
└──────────────────────────────────┘
```

**深模块（保持方向，继续加深）**：

- `foldRounds`（host，纯函数）：`events → { totals, rounds }`——折叠语义、去重、回退 + 耗时/TTFT/TPS/模型归因/结束原因/每轮成本，✅ 深模块。
- `RoundBars`（client，React）：`{ rounds, mode: absolute|ratio|cost, flags, locale } → 图表`——三视角 + 耗时叠加 + 异常标记 + 解释卡，✅ 深模块。
- `filePricingSource` / `createPricingResolver`（host）：价格「来源」与「优先级」分离，接缝成型（ADR 2）。
- `currency.ts`（client，v0.3）：`/meta` 配置 + 用户切换 + `/rate` 实时汇率的单点状态（store），成本币种只有一处真相。

**摩擦点（v0.1 记录 → v0.2 处置）**：

1. **两套折叠实现**（host `foldRounds` vs client 观测）：**决策 2 维持独立**——client 观测只服务实时指示器（`rounds/observed.ts`），host 折叠是权威基准（`rounds/history.ts`）；回退标注在面板统一。
2. **两条价格路径会分叉**：✅ **已解决**——`pricing.ts` 拆为 `calc.ts`（纯数学，两半区共享）+ host `source/resolve`；client 唯一价格输入是 `/pricing` 快照（ADR 2），不再内置价格常量。
3. **模型归因两个来源**：✅ **已收敛**——host `foldRounds` 从 `request/context` 按轮归因（权威）；面板成本解析**优先 host rounds 模型**（ADR 1），快照 provenance 仅作回退。
4. **派生计算内联在编排根**：✅ **已下沉**——异常判定（`diagnose/anomaly.ts`）、成本解析（`pricing-api.ts`）、图表（`chart/RoundBars.tsx`）均为独立模块，`UsagePanel` 只做编排。

**v0.2 / v0.3 / v1.0 落地后的新观察（记录，供 v1.1 决策）**：

- 宿主无插件热重载：升级后必须重启 `dsh web`（运维契约，见 CHANGELOG）；
- `ctx.sessions.get` 只解析当前已加载会话，跨工作区/未加载会话返回 `session-not-found`；
- 大会话（26 万事件）折叠正确，但每请求全量计算 + 全量传输（v1.2 HistoryStore 一并考虑截断/缓存）。

## 2. 目标架构（v0.2/v0.3/v1.0 已落地 → v1.1 模块地图）

### 2.1 Host 半区

| 模块 | 接口（小） | 实现（深） | 接缝 / 适配器 |
|---|---|---|---|
| **RoundFold**（`usage/rounds.ts`） | `foldRounds(events) → { totals, rounds }`，`Round = { turn, buckets, model, startedAt, durationMs, ttftMs, outputTps, endReason, cost }` | 事件流折叠：四桶 + `turn/start→end` 耗时 + `turn/start→首个 usage chunk` TTFT + `outputTokens/时长` TPS + `request/context` 模型归因 + `turn/end.reason` + 每轮成本 | 纯函数，无 IO；测试喂合成事件流 |
| **PricingResolver**（`pricing/resolve.ts`） | `resolve(model) → { pricing, source, verifiedAt?, estimated, unknown? }` | 优先级解析（覆盖>内置>回退）、峰谷时段、未知模型标记、来源/时效标注 | **接缝：PricingSource**（见 2.3） |
| **PricingCalc**（`pricing/calc.ts`） | `estimateCost / formatTokens / buckets 数学` | 纯共享计算，两个半区 bundle 同一份 | 无 IO；不解析来源 |
| **HostRoutes**（`usage/route.ts` + `balance/route.ts`） | 注册 `/usage` `/balance`（v0.2 增 `/pricing`） | 编排 RoundFold + PricingResolver + 安全守卫（沿用 `isTrustedRequest`） | 适配器：`webServer` 接缝 |
| **HistoryStore**（`history/store.ts`，v1.2） | `appendSample(round)` / `queryRange(from, to) → rows` | 聚合/按天落盘、索引、一键清除、导出 | **接缝：历史存储**（2.3） |

### 2.2 Client 半区

| 模块 | 接口（小） | 实现（深） | 接缝 / 适配器 |
|---|---|---|---|
| **LiveObservation**（`rounds/observed.ts`，= 现有 `useTurnUsage`） | `useObservedRounds(totals, nodes) → { sealed, open }` | 投影 delta 增量观测 + 轮次封存——**指示器专用**，只回答“本页加载以来的增量”，如实标注 | 投影实时路径（见 2.4） |
| **HistoryFeed**（`rounds/history.ts`，= 现有 `useSessionUsage`） | `useHistoryRounds(sessionId) → { rounds, source: history\|loading\|error }` | 宿主 `/usage` 完整历史折叠 + 失败时回退观测增量的**标注逻辑**——**面板/徽章专用** | 路由历史路径（见 2.4） |
| **RoundBars**（`chart/RoundBars.tsx`） | `{ rounds, mode: absolute\|ratio\|cost, locale } → 图表` | 三种视角堆叠 + 耗时点线叠加 + 异常轮次标记 + 缓存命中迷你趋势 + Tooltip 解释卡；v1.0.0 起**全部轮次**渲染进横向滚动容器（固定细柱宽、自动滚到最新、箭头/渐隐提示越界），零依赖 SVG | 复用现有交互路径（hover/focus/当前轮高亮） |
| **Anomaly**（`diagnose/anomaly.ts`） | `flag(rounds, { window, threshold }) → { turn, reasons[] }[]` | 相对近 N 轮成本突增判定 + 归因（缓存命中下降/输出增长/上下文膨胀，结合 `endReason`） | 纯函数；图表与徽章共享 |
| **ContextReport**（`diagnose/context.ts`，v1.1） | `report(pressure, breakdown, compactions) → sections[]` | 组成（官方 `contextBreakdown`）+ 压缩时间线（`compaction/summary`）+ 阈值建议 | 纯函数，喂投影与事件折叠结果 |
| **CostBadge**（`badge/CostBadge.tsx`，v0.2） | 挂 `conversation.chat.assistant-actions` 槽位，props = 当前消息轮次成本 | 每轮成本 → 可关闭“本轮 ≈ $0.00xx”徽章；数据来自 HistoryFeed（host `/usage`） | 槽位适配器 |
| **Composition roots**（`ui/UsageIndicator.tsx`、`ui/UsagePanel.tsx`） | 只做编排，不内联派生 | 派生全部下沉到上面模块 | — |
| 保留 | `ui/balance.ts`、`ui/i18n.ts`、`ui/styles.ts`、`client/snapshot.ts` | 现状即合理 | — |

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

- **权威历史**：host 路由 `/usage`（RoundFold 折叠完整日志）→ HistoryFeed（面板、徽章）；
- **实时开轮**：官方投影 `tokenUsage` delta → LiveObservation（指示器，仅本页增量）；
- **上下文**：官方投影 `contextPressure` / `contextBreakdown` 直接 `useProjection` 消费。
- 两条路径**不合并**（决策 2）：指示器与面板各用各的、职责独立；`/usage` 是两者唯一共享的宿主出口，host 折叠是权威基准，client 观测只做实时指示。

## 3. 版本落地映射

| 版本 | 落地的模块 | 删除/重构 | 状态 |
|---|---|---|---|
| v0.2.0 | RoundFold 加深（耗时/TTFT/TPS/**模型归因 `request/context`+回退**/结束原因）、**PricingSource 接缝现在就立**（builtin + file 适配器）+ Resolver、`/pricing` 路由、RoundBars cost 模式 + 叠加 + 异常标记、Anomaly、CostBadge、Dock 压力条 | `pricing.ts` 拆分 calc/source；LiveObservation / HistoryFeed **保持独立**（决策 2）；`usage-api.ts` 移除 → `rounds/` | ✅ 已交付 2026-08-15 |
| v0.3.0 | **多币种成本显示**：`config.currency`/`cnyPerUsd`、`/meta` 配置下发、`/rate` 实时汇率代理（多源回退 + 上次汇率持久化）、client `currency.ts` store（切换 + localStorage） | 成本格式化下沉 `pricing/calc.ts`（`formatUsd` → 多币种）；槽位注册改 `ctx.slots.inject` 等待声明 | ✅ 已交付 2026-08-15 |
| v1.0.0 | **首个完整版本**：RoundBars 全量轮次横向滚动（固定细柱宽、自动滚到最新、箭头/渐隐提示越界）、值标签自适应、图表最小宽自适应、`scripts/probe-chart.mjs` 验证脚本 | 移除 12 轮截断（`MAX_VISIBLE_ROUNDS`）；工具提示改「内容坐标 − scrollLeft」定位 | ✅ 已交付 2026-08-15 |
| v1.1.0 | ContextReport（`diagnose/context.ts`）、compaction 折叠（独立 `usage/compactions.ts`）、Dock 压力条深化（breakdown 分段 + 压缩刻度） | 压力条用 `contextPressure` 投影，不新开路由；`contextBreakdown` 消费标注近似值 | 下一版本 |
| v1.2.0 | HistoryStore 接缝 + 设置页历史视图、导出 | 热力图作为入口之一（复用 RoundBars 的 SVG 设施） | 可选 |

## 4. 测试面（接口即测试面）

| 模块 | 测试方式 | 现有设施 |
|---|---|---|
| RoundFold | node --test 喂合成事件流（带 time 的 turn/start→chunk→end）断言 rounds | ✅ `tests/rounds.test.mjs`（含真实日志形状验证） |
| PricingResolver | 注入 source map fake（builtin/file），断言优先级与未知标记 | ✅ `tests/pricing.test.mjs`（临时目录真写读） |
| Anomaly | 喂 round 序列断言 flag | ✅ `tests/anomaly.test.mjs`（经 `lib/client-test.js` 束） |
| 币种/汇率（v0.3） | 断言 `normalizeFxUrl`、`fetchLiveRate` 多源回退、`/meta`/`/rate` 路由 | ✅ 并入 `tests/core.test.mjs` |
| HistoryStore（v1.2） | memory fake + 临时目录 JSONL 真写读 | 待 v1.2 |
| HistoryFeed / RoundBars / CostBadge | playwright-core 视觉验证（现有 `scripts/probe-*.mjs` 扩展） | ✅ `scripts/verify-render.mjs` 对运行中 DSH Web 端到端通过 |

> 当前 `npm run verify` 共 31 项测试全绿。

## 5. ADR 备忘（本设计的决策点）

1. **Host 权威折叠**：客户端投影只服务「实时开轮 + 上下文」，完整历史一律 host 折叠——避免两套折叠各自漂移。
2. **价格解析只在 host**：client 永不读价格来源文件；`/pricing` 快照是 client 唯一价格输入。
3. **不建推送通道**：维持「路由读历史 + 投影读实时」两条路径，RoundFeed 单点调停。
4. **异常判定是共享纯模块**：图表与徽章都要用，不埋在 RoundBars 内部。
5. **零运行时依赖不破**：所有新图继续零依赖 SVG；不引入图表库。

---

*本文件与 ROADMAP.md 配套：ROADMAP 定「做什么」，本文定「模块长什么样、接缝在哪、怎么测」。实施时按 §2 模块地图落文件，按 §4 补测试。*
