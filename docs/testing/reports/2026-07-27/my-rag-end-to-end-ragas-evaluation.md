# My-RAG 端到端 Ragas 评估改造与真实基线

## 结论

当前评估系统已从 retrieval-only 升级为真实端到端 RAG 评估：每个 case
调用一次生产同路径的 `answer_question`，保存生成答案、结构化引用、完整
检索 trace、延迟、逐指标错误和 tag slices。数据集字段对齐 Ragas 0.4
`SingleTurnSample`，报告 schema 为 `rag-evaluation-v3`。

2026-07-27 的 15-case 真实 deterministic 基线全部完成，索引审计通过：

- 15/15 case 为 `ok`，14 个可回答问题全部回答，1 个不可回答问题正确拒答；
- `Response Status Accuracy = 1.0`；
- `ID Context Recall@8 = 1.0`，`Hit Rate@8 = 1.0`；
- `MRR = 0.90714286`；
- `Citation Recall = 1.0`，exact-ID `Citation Precision = 0.92857143`；
- PostgreSQL/S3 预期 45 个 chunk，Elasticsearch 45 个，checksum 45/45，
  projection coverage 为 1.0。

这证明当前单文档语料上的 Top-8 召回、引用覆盖和拒答路径可工作，但不构成
生产质量结论。完整 15-case 的五个 LLM judge 指标尚未运行。

## Ragas 方法映射

本次实现严格采用 stable 文档的评估驱动循环：建立数据集，定义少量且
单一维度的指标，运行命名 baseline，逐 case 定位错误，只改变一个变量，
再在相同 dataset SHA-256 上比较 candidate。

| Ragas 方法 | My-RAG 实现 |
| --- | --- |
| `SingleTurnSample` | JSONL 保存 input/reference/reference IDs 和可选 metadata；运行时补齐 retrieved contexts/IDs 与 response 后构造真实 sample |
| Retrieval components | exact-ID precision/recall、Hit Rate、MRR、Ragas Context Precision/Recall |
| Generation components | Faithfulness、Factual Correctness、Answer Relevancy |
| End-to-end behavior | response status、citation precision/recall、真实 `answer_question` latency |
| Error analysis | 每个 case 保留 response、citations、`QueryPlan`、scores、reasons、skips 和 errors |
| Experiment comparison | `experiment_name`、dataset SHA-256、profile ID/fingerprint |
| Judge alignment | 当前只作诊断；人工标注对齐前不作为 CI release gate |

核心 judge suite 使用 Ragas 0.4.3 collections API：

1. `ContextPrecision`：相关上下文是否排在无关上下文之前；
2. `ContextRecall`：reference 中的事实是否都能归因到 retrieved contexts；
3. `Faithfulness`：response claims 是否受 retrieved contexts 支持；
4. `FactualCorrectness(mode="f1")`：response 相对 reference 的事实准确性与完整性；
5. `AnswerRelevancy`：response 是否直接回答 user input。

`NoiseSensitivity`、`ContextEntityRecall`、rubric metrics 和
`QuotedSpansAlignment` 保留为专项诊断指标，不混入核心 suite。Agent 和多轮
指标不适用于当前无 Agent、无会话状态的单轮 RAG 路径。

参考：

- <https://docs.ragas.org.cn/en/stable/tutorials/rag/>
- <https://docs.ragas.org.cn/en/stable/howtos/applications/evaluate-and-improve-rag/>
- <https://docs.ragas.org.cn/en/stable/concepts/components/eval_sample/>
- <https://docs.ragas.org.cn/en/stable/concepts/metrics/overview/>
- <https://docs.ragas.org.cn/en/stable/getstarted/rag_testset_generation/>

## 数据集与运行证据

### 15-case 端到端 deterministic baseline

| 项目 | 值 |
| --- | --- |
| Dataset | `evaluation/datasets/ai-news-requirements-rag-v2.jsonl` |
| Dataset SHA-256 | `d739d1f1924418f73a0cef549f420da78a50cd80ac8192b6ea2d16fb16d49ba2` |
| Raw report | `evaluation/reports/ai-news-requirements-rag-v2-smoke.json` |
| Experiment | `rag-v2-live-smoke` |
| 时间 | 2026-07-27 12:10:37 - 12:14:56 Asia/Shanghai |
| Cases | 15：14 answered，1 unanswerable |
| Generation model | `deepseek-ai/DeepSeek-V4-Flash` |
| System latency | mean 31,759.145 ms；min 5,878.287 ms；max 106,101.681 ms |
| Ragas judge | 未启用 |

| Case | Gold rank | MRR | Citation P/R | Status |
| --- | ---: | ---: | ---: | --- |
| `ordinary-user-capabilities` | 1 | 1.0 | 0.5 / 1.0 | answered |
| `internal-user-roles` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `source-types` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `duplicate-similarity-signals` | 1, 3 | 1.0 | 1.0 / 1.0 | answered |
| `ai-structured-json-fields` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `report-status-flow` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `task-failure-retry-flow` | 5 | 0.2 | 0.5 / 1.0 | answered |
| `report-publish-permission` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `internal-admin-pages` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `project-deliverables` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `login-session-method` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `feedback-report-notifications` | 1, 2 | 1.0 | 1.0 / 1.0 | answered |
| `task-failure-retry-flow-variant` | 2 | 0.5 | 1.0 / 1.0 | answered |
| `report-status-flow-en` | 1 | 1.0 | 1.0 / 1.0 | answered |
| `unsupported-mars-budget` | n/a | n/a | n/a | insufficient evidence |

### Ragas judge smoke

同一会话中一次可回答 case 的真实 judge smoke 曾完成，输入答案为
`草稿 -> 待审核 -> 审核中 -> 已发布 -> 已撤回[1]`，得到：

| Metric | Score |
| --- | ---: |
| Context Precision | 0.7 |
| Context Recall | 1.0 |
| Faithfulness | 1.0 |
| Factual Correctness | 1.0 |
| Answer Relevancy | 0.69781188 |

该 answered case judge 用时约 210,992 ms；配套 unanswerable case 正确返回
`insufficient_evidence`，不适用指标均记录为 skip。该次 smoke 没有落盘原始
JSON，因此上表仅作为接线证据，不作为可复现 baseline。

为了补齐 artifact，新增了固定的
`evaluation/datasets/ai-news-requirements-rag-v2-ragas-smoke.jsonl`。随后两次
独立真实复跑都在 answered case 的 generation citation schema 校验阶段失败，
尚未进入 judge；unanswerable case 两次均正确拒答，索引审计两次均通过。
失败被完整保留在：

- `evaluation/reports/ai-news-requirements-rag-v2-ragas-smoke.json`；
- `evaluation/reports/ai-news-requirements-rag-v2-ragas-smoke-attempt2.json`。

两个失败均为脱敏的
`GenerationError: generation provider returned an invalid answer`。这说明真实
provider 的结构化 citation 输出存在运行间方差，也证明评估器不会吞掉失败或
用零分冒充 judge 结果。

两份失败 artifact 生成于 retrieval-preservation 修复之前，因此其中的 failed
row 没有检索 trace。当前实现已让脱敏 `GenerationError` 携带已完成的 retrieval：
后续失败报告仍标记 `failed`，但会保留 `QueryPlan`、context IDs、ID precision/
recall、Hit Rate 和 MRR，并将 response/citation/judge 指标明确记为 skip。

## 误差分析

### Exact-ID citation precision 的两个 0.5

`ordinary-user-capabilities` 引用了 gold chunk 和另一个描述普通用户端
“通知中心”的 chunk。第二条与问题语义相关，只是未列入稀疏 gold labels。

`task-failure-retry-flow` 引用了 rank 1 的“任务失败重试/死信任务”说明和
rank 5 的完整任务状态流。rank 1 并非无关，但只有 rank 5 给出完整序列。

因此两个 0.5 不能直接解释为一半引用错误。exact-ID 指标是保守的 golden
coverage 信号；应结合 Ragas Context Precision、answer faithfulness 和人工
证据审核判断语义有效性。

### 可确认的 retrieval 弱项

`task-failure-retry-flow` 的精确状态流 chunk 排名第 5，原始 query variant
改写后提升到第 2。这是稳定可复现的排序敏感性。当前不能直接把 `top_k`
缩到 4，否则原问题会丢失必要 evidence。后续实验应针对状态序列 query
扩充回归集，再单独比较 question tokens、reranker 或检索权重；不要围绕一个
case 手工调参。

## 边界与下一步

当前数据只有一个文档、15 个 case、一个英文 query 和一个 unanswerable
query。尚缺多文档、多 revision、explicit filters、日期/实体约束、更多
cross-lingual、噪声注入和真实生产 query。

Ragas test generation 可通过 Knowledge Graph、document-specific transforms、
personas、query style/length 和 single/multi-hop distribution 补充覆盖，但合成
case 必须人工审核并冻结，不能替代生产问题和人工确认的 reference IDs。

在设置 CI threshold 前需要：

1. 建立代表性 holdout，保留 production-derived 与 synthetic-reviewed 两类来源；
2. 由领域专家标注 answer correctness、faithfulness、citation validity 和 abstention；
3. 将 LLM judge 与人工标签比较，二分类用 F1，连续分数测相关性与误差；
4. 对同一冻结数据重复运行，量化 judge 和 generation 方差；
5. 同 dataset SHA-256 比较 baseline/candidate，一次只改变一个 profile 变量。

完整 15-case 五指标 Ragas run 暂未执行：按已观测的单 answered case judge
约 211 秒估算，它耗时且有外部调用成本；更重要的是当前 generation schema
稳定性需先处理，否则全量结果会混入系统失败而不是质量分数。

## 最终验证

- `uv run pytest`：142 passed；
- `uv run ruff check src tests migrations`：通过；
- `uv run ruff format --check src tests migrations`：57 files already formatted；
- `uv run rag eval run --help`：`--experiment-name`、`--ragas`、
  `--verify-index` 均可用；
- Ragas 0.4.3 `SingleTurnSample` 字段和五个 collections metric `.ascore`
  签名已与本机安装版本逐项核对；
- 12-case、15-case、2-case 三份 JSONL 均通过 strict loader，case IDs 唯一；
- 三份真实 JSON report 均通过 schema、case count、dataset SHA-256 形态、
  45/45 索引 coverage 检查，secret pattern scan 无命中。
