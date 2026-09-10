# My-RAG 真实检索与 Ragas 评估报告

> 迁移说明（2026-07-27）：本文保留的是 `retrieval-evaluation-v2` 的历史结果。
> 当前 `rag eval run` 已升级为端到端 `rag-evaluation-v3`，数据集字段也已
> 对齐 Ragas `SingleTurnSample`。新的基线应使用
> `evaluation/datasets/ai-news-requirements-rag-v2.jsonl` 和
> `docs/evaluation.md` 中的命令；不要将重新运行得到的 v3 报告与本文的
> retrieval-only 数值直接视为同一实验。

## 结论

本次评估使用当前运行中的 PostgreSQL、MinIO 和 Elasticsearch 数据，调用真实 `BAAI/bge-m3` embedding 服务完成查询向量化，并使用 `deepseek-ai/DeepSeek-V4-Flash` 作为 Ragas judge。12 个 case 全部完成，无 partial 或 failed case，索引一致性审计通过。

核心结果：

- `Hit Rate@8 = 1.0`，所有问题都在前 8 条结果中命中标注 chunk。
- `Context Recall@8 = 1.0`，14 个标注 chunk 全部被召回。
- `MRR = 0.93333333`，11/12 个问题的首个标注 chunk 排名第 1。
- `Ragas Context Precision = 0.87543651`。
- `Ragas Context Recall = 1.0`。
- 唯一明显的排序弱项是“任务执行失败后如何重试”，目标状态流 chunk 排名第 5。

这证明当前索引和检索层在本语料的已知问题上具备完整的 Top-8 召回能力，但结论仅适用于当前单文档、小规模 golden dataset，不能外推为生产质量结论。

## 运行信息

| 项目 | 实际值 |
| --- | --- |
| 评估时间 | 2026-07-26 18:29:47 - 18:51:56 Asia/Shanghai |
| 总耗时 | 22 分 09 秒 |
| Dataset | `evaluation/datasets/ai-news-requirements-real-v1.jsonl` |
| 原始报告 | `evaluation/reports/ai-news-requirements-real-v1.json` |
| Case 数 | 12 |
| Query 语言 | 中文 |
| `top_k` | 8 |
| Ragas | 0.4.3 |
| Judge model | `deepseek-ai/DeepSeek-V4-Flash` |
| Embedding profile | `openai-compatible:BAAI/bge-m3:1024:cosine:v1` |
| Retrieval weights | term `0.7` / vector `0.3` |
| Candidate settings | `candidate_k=64`, `num_candidates=128` |
| Score threshold | `0.2` |

Judge 仅用于离线评估检索上下文，没有生成最终答案，也没有评估 answer correctness 或 faithfulness。

## 语料与索引审计

| 项目 | 结果 |
| --- | ---: |
| Knowledge base | `default` |
| Document | `doc_8b9d80c2dce871aa4f420c47` |
| Active revision | `rev_ff572bc8385601ede7a3b4e7f62af13f` |
| Revision 数 | 1 |
| PostgreSQL/S3 预期 chunk | 45 |
| Elasticsearch chunk | 45 |
| 预期 checksum | 45 |
| 索引 checksum | 45 |
| 匹配 checksum | 45 |
| 缺失/额外 checksum | 0 / 0 |
| Projection coverage | 1.0 |
| Chunking version | `header-path-v1` |

索引 alias 为 `rag-chunks`。45 个 chunk 均属于同一文档和 revision，使用相同 embedding profile；语言标记为 40 个 `zh`、5 个 `en` chunk。

## 汇总指标

| 指标 | Count | Mean | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| Context Precision@8 | 12 | 0.14583333 | 0.125 | 0.25 |
| Context Recall@8 | 12 | 1.0 | 1.0 | 1.0 |
| Hit Rate@8 | 12 | 1.0 | 1.0 | 1.0 |
| MRR | 12 | 0.93333333 | 0.2 | 1.0 |
| Ragas Context Precision | 12 | 0.87543651 | 0.64285714 | 1.0 |
| Ragas Context Recall | 12 | 1.0 | 1.0 | 1.0 |

`Context Precision@8` 按明确标注的 chunk ID 计算。每个 case 只标注 1 或 2 个必要 evidence chunk，因此当固定返回 8 条时，其理论值通常就是 `1/8=0.125` 或 `2/8=0.25`。它适合检查精确 golden chunk 是否进入结果集，不等同于语义噪声比例。Ragas Context Precision 会逐条判断所有返回上下文与问题的语义相关性，更适合观察候选集质量。

## 逐题结果

| Case | 标注 chunk 排名 | Recall@8 | MRR | Ragas Precision | Ragas Recall |
| --- | --- | ---: | ---: | ---: | ---: |
| 普通用户可以使用哪些功能？ | 1 | 1.0 | 1.0 | 0.97619048 | 1.0 |
| 内部人员按职责分成哪些角色？ | 1 | 1.0 | 1.0 | 0.64285714 | 1.0 |
| 系统支持哪些类型的信息源？ | 1 | 1.0 | 1.0 | 1.0 | 1.0 |
| 判断重复或相似文章时会使用哪些依据？ | 1, 3 | 1.0 | 1.0 | 0.83333333 | 1.0 |
| AI 对文章生成的结构化 JSON 包含哪些字段？ | 1 | 1.0 | 1.0 | 0.83333333 | 1.0 |
| 日报从草稿到撤回的状态流转顺序是什么？ | 1 | 1.0 | 1.0 | 0.7 | 1.0 |
| 任务执行失败后如何重试，最终可能进入哪里？ | 5 | 1.0 | 0.2 | 0.87666667 | 1.0 |
| 权限标识 report.publish 表示什么？ | 1 | 1.0 | 1.0 | 1.0 | 1.0 |
| 内部管理端包含哪些页面？ | 1 | 1.0 | 1.0 | 0.64285714 | 1.0 |
| 项目开发至少要交付哪些内容？ | 1 | 1.0 | 1.0 | 1.0 | 1.0 |
| 系统用什么方式保持用户登录状态？ | 1 | 1.0 | 1.0 | 1.0 | 1.0 |
| 反馈处理完成和日报发布后会触发哪些通知？ | 1, 2 | 1.0 | 1.0 | 1.0 | 1.0 |

## 主要发现

### 1. 状态流问题存在明确排序弱项

问题“任务执行失败后如何重试，最终可能进入哪里？”的正确 evidence 是 `7.5 任务状态`，排名第 5：

| Rank | Section | Final | Term | Vector |
| ---: | --- | ---: | ---: | ---: |
| 1 | `5.13 任务调度与运行稳定性` | 0.37368811 | 0.20701754 | 0.7625861 |
| 2 | `7.6 通知状态` | 0.36663414 | 0.18671679 | 0.7864413 |
| 3 | `5.10 通知与提醒` | 0.3519697 | 0.18057644 | 0.7518873 |
| 4 | `10.7 看板、日志与稳定性` | 0.34263452 | 0.17393484 | 0.7362671 |
| 5 | `7.5 任务状态` | 0.33822361 | 0.17243108 | 0.72507286 |

第 1 条包含“任务失败重试”和“死信任务”，第 2 条具有几乎同构的“发送失败 -> 等待重试 -> 死信队列”流程，因此它们并非完全无关。但只有第 5 条给出了问题要求的完整任务状态序列。当前 term 和 vector 两部分都没有把完整状态流提升到前面，说明问题不只是最终权重组合。

### 2. Top-1 正确，但部分 Top-8 尾部偏宽

Ragas Context Precision 最低的三个 case 为：

- 内部人员角色：`0.64285714`
- 内部管理端页面：`0.64285714`
- 日报状态流：`0.7`

三者的正确 chunk 都排名第 1；扣分主要来自后续候选中混入相邻主题，例如其他角色能力、普通用户页面、其他对象状态和日报发布流程。这不会影响本次 Top-1 命中，但会增加下游模型的上下文噪声和 token 消耗。

### 3. 多 chunk 问题召回完整

“重复或相似文章依据”的两个标注 chunk 排名 1、3；“反馈处理与日报发布通知”的两个标注 chunk 排名 1、2。两个 case 的 Recall@8 和 Ragas Context Recall 均为 1.0，说明当前检索可以在同一文档内聚合分散 evidence。

## 后续建议

1. 为任务状态流增加同类回归问题，检查 `question_tks`、状态序列词覆盖与 rerank coverage；不要仅针对一个 case 手工调权重。
2. 在保持 `top_k=8` 的前提下先解决目标 chunk 的排序。当前若直接收紧到 Top-4，会让困难 case 从完整召回退化为漏召回。
3. 扩展到多文档、多 revision、无答案问题、中英文混合 query、explicit filters、时间/实体过滤和多轮指代 case。
4. 对 Ragas judge 做多次重复运行或引入固定对照 judge，量化模型判断的方差。
5. 增加检索阶段耗时采样。本次 22 分钟主要由真实 Ragas judge 请求及其重试占用，不能作为在线检索延迟。

## 可复现命令

评估使用独立的 judge endpoint 和 API key。当前配置层已将 judge model
迁移到 `config/rag.yaml`；复现本次运行时，将
`evaluation_profile.model` 设为报告记录的
`deepseek-ai/DeepSeek-V4-Flash`。报告不会保存 API key。

```bash
set -a
source ./.env
set +a
export RAG_EVAL_BASE_URL="$RAG_CHAT_BASE_URL"
export RAG_EVAL_API_KEY="$RAG_CHAT_API_KEY"
export RAG_EVAL_TIMEOUT_SECONDS=180
export RAG_EVAL_CONCURRENCY=2

uv run rag eval run \
  evaluation/datasets/ai-news-requirements-real-v1.jsonl \
  --verify-index \
  --ragas \
  --output evaluation/reports/ai-news-requirements-real-v1.json
```
