# Real-provider 比较独立 agent 评分

独立审查全部 96 个 case/profile：93 个 timed_out、3 个 partial，completed 为零。无答案的 93 条全部给 0 分和四项 false，包括缺失题；超时不能算正确拒答。

| Profile | 文本质量全项满分 | completed 交付通过 |
|---|---:|---:|
| source | 0/24 | 0/24 |
| wiki | 1/24 | 0/24 |
| graph | 2/24 | 0/24 |
| combined | 0/24 | 0/24 |

3 条可审查文本均符合冻结 rubric：wiki/manual-compact 明确关闭自动压缩仍可手动执行、同时关闭 overflow/length 自动恢复；graph/clear 明确仅清屏不动 Core 历史；graph/revenue-missing 对指定月财务数据合理说明缺失且不编造。三项质量分均为 3，gaps=true。但运行状态仍 partial；revenue-missing 原 outcome=fail 仍须保留，不因独立文本审定而宣称交付完成。

已逐一解析前两题的 3 条引用，确认对应实际 originals 的版本和 passage 内容，并判断原文直接支持回答主张；第三题依据缺失题规则无引用也可合格。另核对 real originals 的20篇正文与冻结 corpus 全部一致。没有使用自动 certificate、supported 状态或引用数代替质量判断。

这次比较主要暴露指定 deadline 下的可用性不足，不能根据 1/24 与 2/24 就声称 Wiki/graph 在真实质量上优于 source。运行配置/endpoint 可访问，派生内容是否 reviewed-ready，以及请求是否在时限内完成，是三个不同事实；本评分只审定实际回答及来源，不从 profile 名称推定某路派生内容确实命中或已审查就绪。运行的可用性、路由 readiness 和计时证据应与本评分联合阅读。

题集是用户授权以独立 agent 取代该 issue 人工审定的小规模开发快照，不是人工评分或跨领域质量结论；不覆盖复杂缺失与未解决冲突。此次真实 provider 的93次无文本超时也无法归因为具体检索或生成质量错误。原始状态与所有失败均保留。

`agent-grades.json` 是 runner 格式，`independent-review.json` 保存分数、原文引用、解释和交付状态。两者绑定 `SHA256(JSON.stringify(parsed report)) = 5f0ae23e82b7953c82b1633d0a7f4a135c6a24e1732b2ce20281b2edb12491a9`。
