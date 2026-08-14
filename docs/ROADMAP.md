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
| `request/context` | `provider` / `model` / `contextWindow?` | 模型路由与上下文容量（v0.3 分母） |
| `user/message` | `source`: direct human / `agent.inject()` / goal continuation | 上下文增长来源归因（v0.3） |
| `compaction/start` / `compaction/summary` / `compaction/prune` / `compaction/end` | `summary` 带 `shadowedTokenCount`、`shadowedRange{start,end}`、`shadowedSeqs`、`provider`、`model`、`usage?` | **压缩诊断完整数据源**（v0.3）：哪轮压缩、释放多少 token、哪次 summarize 调用花了多少 |

### 3.3 官方投影（无需自研估算器）

`@deepseek-ai/dsh-token-meter` 已注册三个投影，client 侧经 `useProjection` 直接消费：

| 投影 | 形状 | 说明 |
|---|---|---|
| `tokenUsage` | `uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens` | 全量累计四桶（与现有 host 折叠语义一致） |
| `contextPressure` | `pressureTokens / projectedTokens / contextWindow` | 最近一次请求的 prompt 规模 + 投影值 + 容量；`projectedTokens` 已含压缩阴影定价 |
| `contextBreakdown` | `systemTokens / toolsTokens / messageTokens` | **“上下文为什么变大”官方已算好**——系统提示 / 工具 schema / 消息 的启发式分桶（v0.3 直接消费，标注为近似值） |

### 3.4 结论

- v0.2 全部数据源 ✅ 已验证；
- v0.3 上下文组成用 `contextBreakdown` 投影，压缩用 `compaction/summary.shadowedTokenCount` ✅ 已验证；
- v0.4 跨会话历史：官方另有 `dsh-session-query`（SQLite FTS5）与 `dsh-session-stats` 可作为宿主侧聚合的参考，实施时再验证。

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

### v0.2.0 — 会话成本解释力（轮次级）

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
- Dock 指示器增加细**上下文压力条**（`contextPressure.pressureTokens / contextWindow` %）——v0.3 上下文诊断的前置可视入口，体积极小。

**验收**：保持零运行时依赖；明暗主题可读（沿用 `--duc-*` CSS 变量）；键盘可达（沿用现有 tabIndex / focus 路径）；中英双语文案同步。

### v0.3.0 — 上下文诊断（差异化核心）

- 上下文组成视图：`contextBreakdown`（系统/工具/消息）+ `contextPressure`（压力 vs 容量）；
- 压缩事件时间线：`compaction/summary` 的 `shadowedTokenCount` / `shadowedRange` / model / usage——哪一轮压缩、释放多少、summarize 花费多少；
- 上下文增长归因：`user/message.source` 区分人工输入 / 注入 / 目标续跑；工具输出大文件归因；
- 接近阈值时的操作建议：开新会话 / 压缩 / 减少大文件注入（只做提示文案，不越权执行）。

### v0.4.0 — 跨会话概览（可选）

- 设置页历史视图：近 7/30 天成本与 Token 趋势、活跃会话数、缓存命中趋势；
- 工作区分组 + 本地别名；
- GitHub 风格热力图作为**入口之一**，展示“每日成本 / Token”而非回合数；
- 只持久化聚合数据（或从会话日志按需索引），提供“一键清除历史”与 CSV/JSON 导出，保持隐私边界。

### v1.0.0 — 收敛与契约

- 预算告警（阈值配置 + 面板内提示，可选桌面通知）；
- 可选官方充值入口（只做跳转链接）；
- 稳定的数据迁移与配置契约（`pricing.json` schema、历史数据格式冻结）。

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
