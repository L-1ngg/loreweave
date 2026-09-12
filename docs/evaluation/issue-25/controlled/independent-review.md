# Controlled 比较独立 agent 评分

已审查 24 题 × 4 profiles 的全部 96 条结果。每题的答案文本及完整引用数组在四个 profile 间逐项相同，因此可共享该题语义判断；仍对每条结果的全部 64 次引用解析对应 originals 版本与 passage，并核对原文和回答归属。没有采用 certificate 的 supported 判决作为分数。

所有运行状态为 partial。独立文本质量仅 8/96 达到全部满分：四个 profile 的 `revenue-missing` 和 `sla-missing-paraphrase`。这两题合理拒绝在材料不足时编造答案；它们原有 fail/partial 交付状态仍需保留，不能把文本质量分解释成 completed。其余没有完整回答冻结要点，交付通过为 0/96。

引用支持分为 3 不表示答案正确或完整：本受控模型主要输出带出处的原文片段，它们能支持“该文记载”的归属，但大量内容与问题无关，例如 permission 题只抄文档 frontmatter，dangerous 题抄请求类型表。已将此类正确性和完整性判低；无回答题虽坦承本次未检索到依据，也不能证明冻结语料无答案。

`reference` 回答正确说明不再编译 grok、改仓库 golden，但欠缺不能声称等于 grok 运行时 cell 的限制。`core-evolution-paraphrase` 仅引用旧 ExecutionCore 背景，未处理 ADR-015 替代。冲突处理均未充分通过。

布尔评分只有各自 0–3 分为 3 时才为 true；gaps 另检查是否恰当承认无答案/不确定性或解决历史冲突。`agent-grades.json` 为 runner 接入格式；`independent-review.json` 保存逐条分数、解释、原文引用和原始运行状态，均绑定同一个 report SHA256。

这是 `scripted-extractive-v1` 的受控软件行为证据。四路答案相同不证明四路真实模型质量相同，也不构成启用派生路由的收益证据。
