# Issue #25 题集独立审定

本轮用户明确允许 subagent 审定题集并评分。本记录属于 **independent-agent review**，不是人工审定；审定者为 `issue-25-independent-agent`，时间见 `reviewed-questions.json`。审定时未读取新比较运行结果，题目与评分规则在运行前冻结。

## 输入与产物

- 输入：`../forge-preflight/questions.json`、`reference-evidence.json`、`originals.json`、`corpus.json`。原题实际为 20 题，原文件保留。
- 冻结事实边界：`corpus.json` 的 20 篇 Forge 文档快照；已检查所有 source text 与 `originals.json` 一致。不声称快照代表当前上游生产状态。
- 输出：`reviewed-questions.json`，24 题，18 ordinary / 6 complex；15 sufficient / 3 missing / 6 conflicting。每题包含拆分评分要点、预期信息缺口、逐字原文和文件名，无旧数据库 UUID 依赖。
- 4 个有两个题目的释义组为 `clear`、`sla-missing`、`core-evolution`、`context-evolution`；其余为单题组。汇总时须标明相关样本，不能把释义题当独立事实覆盖。

## 审定结论

原有简单题的事实要点可由冻结原文支持。将旧的单关键词 reference（如 `20`）替换为表达完整主张的原文行，并为跨文档题补齐旧决策与新决策证据。缺失问题没有正向证据，故 references 为空，不能拿 README 任意段落充当不存在的 SLA 或财务数据证据。扫描全语料并核对其文档范围，未发现商业 SLA 赔偿、指定月付费客户或营收依据；答案应承认未知，不能说数值为零。

复杂题明确标为 conflicting，实际测试的是**可根据明示替代关系解决的历史冲突**。没有人为编造尚未解决的矛盾，也不把新版规则与旧版规则拼成同时生效。范围包括 ADR-009/015 的源码所有权、ADR-012/014 的原文找回、ADR-010/013/014 的保存取消、ADR-005/006/007/016 的视觉与 Markdown。

`context-evolution` 原问题把 ADR-012 概括为严格预算方案不够准确：该文是累积讨论记录，正文已记载部分硬准入方向被取消。因此改写为比较当前是否实行这些机制；rubric 不要求错误复述 ADR-012 全篇曾统一规定严格 B/M。

## 评分边界

JSON 内冻结 correctness、completeness、citationSupport 的 0–3 分定义，并逐题拆分 requiredPoints。正确性检查回答是否与原文及替代关系一致；完整性检查必要点覆盖；引用支持检查**回答实际引用的原始证据**能否支撑主张。缺失题若仅作合理的不确定性说明，可在无引用时获得满分支持度；附带额外事实则仍须证据。

自动 `supported`、certificate、引用数量或逐字匹配仅属诊断，不作为独立事实判断。evidence recall 对缺失题为 null，不把无参考题当 0% 或 100%。原文引用单元数不是事实重要性的权重；复杂问题的覆盖需另看 requiredPoints。

质量分、延迟、费用和可用性必须分开。失败、超时、拒答以及部分回答仍纳入完整比较，不只选成功回答评分。若运行未提供可审查答案和原文引用，则不得给独立审定通过。受控 provider 运行不代表真实 provider 质量。

## 验证与局限

已解析输出 JSON，并逐条断言每个非空 reference quote 为对应冻结 source text 的精确子串；20 篇 corpus 与 originals 的正文全部一致。人工评分已由用户对本 issue 的授权替换为独立 agent 评分，不能反向修改既有记录中的人审状态。题集是小规模、有主题相关性的开发比较集，复杂题全部是已解决的历史冲突，不覆盖未解决冲突、复杂无答案、多领域或生产流量分布；不据此作普适准确率或统计显著性承诺。
