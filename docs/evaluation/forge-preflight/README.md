# Forge 文档小规模预验收（2026-09-12）

本轮是用户授权的真实文档、真实模型预验收，不是 #18 的正式发布验收。
**预验收未通过：原文问答存在大量超时，自动派生尚未可用，不能证明 Wiki + GraphRAG 融合收益。** 本轮不修改产品行为、不调参、不放宽超时。

## 冻结输入与执行方式

- 被测 LoreWeave：`6d352ff8557eb79009704c5a84b1027e377bb16e`。
- 素材来自 `/home/l1ngg/dev/forge-agent/docs`：16 篇 ADR，加文档索引、SDK、release、session-management，共 20 份 Markdown、71,458 Unicode 字符、134,721 UTF-8 字节，解析为 453 个 passage。
- Forge HEAD：`ead9bf28cbd9fafccb8b3fbcc8d3589c0b755916`。源仓库存在未提交修改（包括入选的 `docs/README.md`）；**本轮依据逐文件 SHA256 和实际文本快照，不声称素材等于纯 Git 提交版本**。
- 问题先于问答冻结：20 题（16 普通、4 复杂），其中 18 题预设有依据、2 题检验资料不足。题目 SHA256：`d3460561faa1bf27d741de9f658f0158a49a70a93665b52cee02e331edb8932d`。
- 题目、参考片段和要点由助手依据原文准备，独立人工复核及最终评分仍为 `pending`；这些标签从未导入知识库。它们用于定位问题，不充当人工质量金标。
- Chat：`deepseek-ai/DeepSeek-V4-Flash`；Embedding：`BAAI/bge-m3`，1024 维；使用已有真实 provider 配置，凭据不进入报告。
- 使用隔离 PostgreSQL/pgvector，20 份原文全部达到 `searchable` 后先跑 `source`，再执行自动维护，最后跑 `combined`。每组同一批 20 题，客户端并发 1，普通/复杂硬限保持 30/60 秒。
- 维护调度窗口为 12 分钟；只在任务之间检查窗口，正在执行的任务可越过窗口。这是本次资源上限，不是新增产品刷新 SLA。Wiki、graph、identity 各自领取队列任务，不能把日志序号理解为同一份文档的连续阶段。
- 问答通过本地真实 HTTP、认证会话及只有 `read` 权限的成员调用；导入和更新通过管理模块设置。使用 ad hoc driver 是为了明确保留未审核标签的预验收身份，没有绕过正式评估器后冒充正式验收。
- 没有人工录入 entity mention；只导入自然文档。维护结束后停止 worker，因此融合问答观测的是该时点的派生状态，不能外推“无限时间也不会完成”。

## 运行结果

执行时间：`2026-09-12T02:11:12.103Z` 至 `2026-09-12T02:46:46.794Z`（UTC）。下表为同题各跑一次的观测，不估计稳定质量收益。

| 路线 / 类别 | 题数 | answered | partial | timed_out | failed | 中位数 ms | 样本 p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| source / ordinary | 16 | 0 | 2 | 14 | 0 | 30022 | 30039 |
| source / complex | 4 | 0 | 1 | 2 | 1 | 57155 | 60027 |
| source / all | 20 | 0 | 3 | 16 | 1 | 30024 | 60025 |
| combined / ordinary | 16 | 0 | 3 | 13 | 0 | 30017.5 | 30041 |
| combined / complex | 4 | 0 | 0 | 4 | 0 | 60016 | 60031 |
| combined / all | 20 | 0 | 3 | 17 | 0 | 30019 | 60020 |

普通问答样本 p95 均高于既定 15 秒目标；并发仅 1 就出现大量 30 秒超时。该结果没有达到基本可用性要求，也不代表正式五并发容量已测。

| 题目 ID | source 状态 / ms | combined 状态 / ms |
| --- | --- | --- |
| request-shape | timed_out / 30039 | timed_out / 30018 |
| headless | timed_out / 30037 | timed_out / 30018 |
| permission | timed_out / 30021 | partial / 15613 |
| dangerous | timed_out / 30009 | timed_out / 30012 |
| isolation | timed_out / 30024 | timed_out / 30020 |
| reference | timed_out / 30009 | timed_out / 30036 |
| team | timed_out / 30015 | timed_out / 30041 |
| release | timed_out / 30010 | timed_out / 30029 |
| draft-release | timed_out / 30031 | timed_out / 30021 |
| clear | partial / 22591 | partial / 25677 |
| session-path | timed_out / 30024 | timed_out / 30011 |
| storage | timed_out / 30028 | partial / 18711 |
| manual-compact | partial / 18099 | timed_out / 30025 |
| markdown | timed_out / 30029 | timed_out / 30012 |
| sla-missing | timed_out / 30023 | timed_out / 30017 |
| revenue-missing | timed_out / 30009 | timed_out / 30012 |
| core-evolution | timed_out / 60025 | timed_out / 60012 |
| context-evolution | partial / 54285 | timed_out / 60012 |
| cancel-persistence | timed_out / 60027 | timed_out / 60031 |
| render-evolution | failed / 47088 | timed_out / 60020 |

- `source`：主要参考片段命中 14/18；已返回答案的引用 6/6 可解析且文本包含于原 passage。超时和失败没有答案，不能作为引用通过样本。
- `combined`：主要参考片段命中 14/18；已返回答案的引用 3/3 可解析且文本包含于原 passage。超时和失败没有答案，不能作为引用通过样本。

### 实际返回的文本与人工评分边界

下面保留全部已返回答案；独立人工评分仍待完成。`partial` 不被改标为 `answered`，无答案不被计算为正确拒答。

**source / clear**（`partial`，`incomplete_support`）：

> TUI 的清屏操作不会清除 Core 会话历史；文档明确“清屏不操作 Core 历史”，TUI 仅负责命令处理、选择器和切换状态，历史存储与释放由 CLI 宿主和 Core/SDK 契约管理。

**source / manual-compact**（`partial`，`incomplete_support`）：

> 关闭自动压缩后，手动 compact 仍可执行；`enabled = false` 仅禁用主动压缩及 overflow/length 自动恢复，不关闭工具自身截断。

**source / context-evolution**（`partial`，`incomplete_support`）：

> ADR-014 取代了 ADR-012 的当前方案入口，ADR-012 状态标记为“被 ADR-014 取代”，不再作为当前施工规格。
> ADR-014 明确“工具自己截断”替代 ADR-012 第 7 项额外内核预算；“原文找回”替代第 8 项专用模型读取工具，并取消专用 read_context、持久原文分页引用和工具全文归档平台。因此严格上下文预算和 read_context 原文找回平台不再属于当前方案，仅保留原始会话记录供宿主查看/导出。

**combined / permission**（`partial`，`incomplete_support`）：

> permission 的 mode 只有三种：`default` / `accept-edits` / `deny-all`；`plan` 不在枚举里预留。

**combined / clear**（`partial`，`incomplete_support`）：

> TUI 的 /clear（清屏）不会清除 Core 会话历史；文档明确说明“清屏不操作 Core 历史”。

**combined / storage**（`partial`，`incomplete_support`）：

> 任一存储写入失败时，停止继续调度并停用实例，由宿主核对实际存储状态后重建；已开始的写入不可保证取消，抛错不代表零写入，也不盲目重试追加或回滚工具外部副作用。

### 自动维护

维护调度预算 720,000 ms，实际 727,726 ms；越界来自窗口内已开始的工作。各 worker 独立领取任务，本轮不是按文件名依次处理。

| 阶段 | 总文档 | 完成 | 失败 | 排队未尝试 | 租约过期、仍为 running |
| --- | ---: | ---: | ---: | ---: | ---: |
| Source | 20 | 20 | 0 | 0 | 0 |
| Wiki | 20 | 0 | 3 | 17 | 0 |
| Graph | 20 | 0 | 2 | 17 | 1 |
| Identity revalidation | 20 | 3 | 0 | 17 | 0 |

Wiki 已尝试 3/20：`17-README.md` 为 `needs_attention:source_coverage`；`02-002-request-bus-shape.md` 和 `09-009-self-owned-agent-core.md` 为模型调用超时。Graph 已尝试 3/20：`09-009-self-owned-agent-core.md` 和 `15-015-pi-core-source-migration.md` 超时；`07-007-no-compile-grok-reference.md` 出现 `stale_worker`，任务仍 `running`、generation 为 `staged`。没有自动重试/接管完成的证据。

数据库快照中 Wiki 页面、identity mentions、graph claims 和 supports 均为 0。所有融合问答的 `wikiCandidates` / `graphCandidates` 均为 0。因此两轮间的状态变化可能来自模型随机性、运行时延迟与降级提示，不能归因于 Wiki 或 GraphRAG 的知识增益。Identity revalidation 的 3 次完成是在零 mention 条件下，不是实体识别通过。

模型阶段记录（按 attempt 计，非文档数；`admitted` 不等于调用成功）：

| phase | state | attempts |
| --- | --- | ---: |
| extraction | completed | 9 |
| extraction | failed | 5 |
| graph_extraction | admitted | 1 |
| graph_extraction | completed | 1 |
| graph_extraction | failed | 4 |
| graph_review | completed | 1 |
| graph_review | failed | 1 |

上述维护 attempt 数不含问答调用，不能当总 token 或费用；本轮没有可靠的 token/pricing 统计，也没有据此给出成本结论。

### 来源更新检查

只给隔离数据库中 `16-016-markdown-rendering.md` 的新版本添加 `LW-CANARY-7429` 标记。新版本状态 `searchable`；旧版本仍可读取：`true`；Forge 对应源文件未改动：`true`。

更新后问答状态 `partial`，耗时 25,218 ms；Wiki/graph 尚待维护。

> 仅限预验收副本的构建代号是 LW-CANARY-7429，此标记不是 Forge 正式设计。

本轮没有引用该旧版本的已发布 Wiki 页面，因此 stale Wiki 可读/刷新场景没有被实际触发，不能记为通过；也没有执行完整更新回归或中断恢复。

## 判读边界

`answered`、`partial`、`timed_out`、`failed` 都是产品运行状态，不是人工正确率。所有失败保留在分母内。延迟从发起调用计到宿主结算与引用检查结束，含本地 HTTP/轮询开销；30/60 秒略微超出的端到端数值不直接证明服务端硬限失效。样本 p95 采用 nearest-rank，不能代替五并发正式容量结果。

“主要参考片段命中”只检查最终 `diagnostics.retrieved` 是否同时包含预选文件名和一个预选原文片段；不等于多文档完整召回、全部必要证据齐备或回答正确。引用检查只证明 locator 可解析且引用文本包含在原 passage 中；不能单凭此证明每项断言都被引用支持。模型独立 review 是系统机制，不能替代独立人工评分。

## 代码对应的诊断线索

1. [EvidenceService](../../../src/evidence.ts) 用序列化候选条目的 UTF-8 字节计入普通/复杂 8000/16000 预算；任意候选装不下都会加入 `context_limit`。最终只要这个 gap 存在，就返回 `partial/incomplete_support`。候选截断与实际问题是否答全混在一起，应在后续修复中分开验证。
2. [KnowledgeHost](../../../src/host.ts) 的探索、工具结果回传与最终生成/独立审查共同竞争 30/60 秒预算。部分请求已检索到主要参考片段仍超时；不能只调整检索来解释全部失败，也不能仅凭阶段计时断言 provider 是唯一原因。
3. [Wiki](../../../src/wiki.ts) 按包提取并要求来源覆盖完成后才发布。抽取超时和 `needs_attention:source_coverage` 应保留失败状态；需要进一步设计恢复/重试与真实文档覆盖策略，不能为了出页面删掉审查门槛。
4. [IdentityService](../../../src/identity.ts) 的 `record()` 需要显式原文 label；[GraphService](../../../src/graph.ts) 读取已有 `maintenanceMentions()` 给模型绑定端点。目前导入链没有自动补齐自然文档 mention 的步骤。没有合法端点时应排除关系，不能把零边或空图的 ready 视为 GraphRAG 有效。
5. Graph worker 领取 120 秒 lease，而单个文档可包含多个有重试的模型阶段；[Operations](../../../src/operations.ts) 在过期后拒绝 checkpoint/commit。此次出现 `stale_worker`，需要专门验证租约续期/接管与失败结算，不能称其已成功恢复。

## 下一步顺序

优先修复普通原文问答的端到端可用性与完整性状态判定，并用本轮数据作为开发回归。随后处理 Wiki 覆盖/恢复和 graph lease，再补自然文档实体发现链路。派生产物稳定可用后才值得比较 Wiki、graph 和融合的质量收益。

本轮题目运行后即成为开发数据，后续调优不能继续把它们当未见过的正式 holdout。正式 #18 仍需要人工审核的冻结数据、四路线比较、五并发容量、生命周期/恢复、主题路由与成本等证据；#18 和父 issue #1 均保持 open。本轮未运行 Web UI 交互验收、正式容量、完整维护恢复及人工 Wiki 抽样，不新增产品代码。

## 证据与复现

- `corpus-manifest.json`：源路径、提交背景、逐文件 SHA256、执行前冻结协议。
- `corpus.json`：实际文本副本；`questions.json` 与 `reference-evidence.json`：预先准备的题目和主要参考片段。
- `results.json`：41 次请求、20 份导入和维护诊断及更新检查的原始记录；`summary.json` 为离线统计。
- `originals.json`：原始版本/passages；`wiki-pages.json`：维护窗口结束时的发布页面列表；`derived-snapshot.json`：数据库派生计数与 generation 快照。
- `run.log`：阶段完成与异常记录；`summarize.py` 可离线重算 `summary.json`。
- `runner.ts.txt`：本轮实际执行的临时 driver，保留绝对路径，作为执行记录，不作为生产脚本。

在被测提交安装仓库依赖并配置真实 provider 后，可将 `corpus.json` 中的 `file/text` 还原到 `/tmp/loreweave-forge-preflight/corpus/`，复制 manifest 和 questions 到父目录，将 driver 还原为 `run.ts`，用独立空 PostgreSQL/pgvector 数据库执行：

```sh
TEST_DATABASE_URL=postgres://loreweave:loreweave_test@127.0.0.1:45436/preflight \
  bun --env-file=.env /tmp/loreweave-forge-preflight/run.ts
```

driver 绑定此次工作区绝对路径；在其他目录需替换 imports，且更新检查依赖 Forge 原始路径。重新运行会调用收费模型，具有随机性，数据库生成的 UUID 和队列处理顺序也可能变化，不保证复现同样的逐题状态。离线核对快照与统计不需要模型凭据。
