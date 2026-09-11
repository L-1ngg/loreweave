# Contextual knowledge requests

Issue #14 extends the local scripted conversation. Source and Wiki selections,
project scope, pending source choices and operation keys live in durable run
snapshots. A restart reads those records; it does not replay old tool calls.

A source page links to a conversation with that source selected; a Wiki page
links with its displayed version. The authenticated API accepts `sourceVersion`,
`pageId` and `pageVersion`. Selections must belong to the requested project scope.
An omitted project inherits the conversation scope; explicit `projectId: null`
clears it. Changing scope discards old selections and pending attachments.

The development provider recognizes these affirmative fixtures:

- `请把附件导入知识库` / `请把附件作为新文档导入`: always a new source,
  even if a filename already exists.
- `请用附件更新「manual.md」` / `请更新这个文档`: resolve the named or
  selected document; duplicate filenames yield numbered, project-labelled choices.
- `选择第2个`: resume the pending attachment/target choice across reload/restart.
  Current document versions are rechecked before accepting the update.
- `请纠正「日志保留」：测试环境保留 14 天。` / `请纠正这个主题：…`:
  add an attributed source note to the named or selected topic.
- `请记住整理偏好：…` / `请保留旧步骤结构`: retain maintenance guidance;
  guidance is not original evidence.
- `请恢复这个主题的上一版：原因` / `请恢复这个主题的所选历史版本：原因`:
  queue a new Wiki version through the existing history/revalidation pipeline.

These forms exercise application policy and do not constitute a general language
understanding model. Model tool arguments cannot expand the current user's write
intent; source passages and attached text never grant tool authority. Ambiguous
or unavailable selections return clarification. A changed source may require a
fresh selection. Imports, corrections and restores use a per-run durable operation
key persisted before dispatch. Reading a run checks accepted keys independently of
its SDK result history, including effect-before-result failure. Unsettled or
unreconciled execution remains subject to existing conversation writer fencing.

Run `bun run test:intents` against a disposable PostgreSQL database and
`bun run test:browser -- tests/browser/intents.spec.ts`. Tests use public HTTP,
module commands and the session persistence boundary: duplicate/new/update intent,
project isolation, numbered clarification after restart, Wiki guidance/restoration,
and a committed effect with a lost result. Browser coverage includes cross-project duplicate choices, reload during
clarification, and a test-only child server that exits after the source transaction
commits but before saving its result. The browser reconnects to the restarted
process and retains the recovered operation receipt through SSE replay, without
a second mutation. Cancellation/deadline during durable intent persistence and
Wiki publication changes after selection are regression-tested. Real-model intent
quality remains unmeasured.
