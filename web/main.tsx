import { WikiBrowser } from "./wiki.tsx";
import { IdentityPanel } from "./identities.tsx";
import { SourceImports, type Attachment } from "./imports.tsx";
import { Markdown, markdownContext } from "./markdown.tsx";
import type { SourceVersion } from "../src/sources.ts";
import { AccessShell } from "./access.tsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunEvent, RunSnapshot } from "../src/host.ts";
import type { Evidence } from "../src/development/sources.ts";
import "./style.css";

const labels: Record<RunSnapshot["status"], string> = {
  queued: "等待执行",
  executing: "正在查阅原文",
  finalizing: "正在生成并审核答案",
  refreshing: "来源已更新，正在重新取证",
  answered: "回答完成",
  partial: "部分回答，仍有证据缺口",
  failed: "未能完成有依据的回答",
  timed_out: "时间预算已用完",
  canceled: "已取消",
};
function App({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const [attachment, setAttachment] = useState<Attachment>();
  const [run, setRun] = useState<RunSnapshot>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const stream = useRef<EventSource | null>(null);
  const conversationId = useRef(
    new URLSearchParams(window.location.search).get("conversation"),
  );
  const [history, setHistory] = useState<RunSnapshot[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId.current));
  function attach(accepted: RunSnapshot) {
    stream.current?.close();
    setRun(accepted);
    if (accepted.settledAt) return;
    const events = new EventSource(`/api/runs/${accepted.id}/events`);
    stream.current = events;
    for (const type of ["state", "progress", "result", "settled"])
      events.addEventListener(type, (message) => {
        const event = JSON.parse(
          (message as MessageEvent<string>).data,
        ) as RunEvent;
        setRun(event.run);
        if (event.type === "settled") events.close();
      });
    events.onerror = () =>
      setError("连接暂时中断，正在尝试恢复；查询仍由服务器处理。");
    events.onopen = () => setError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    if (conversationId.current) {
      void fetch(
        `/api/conversations/${encodeURIComponent(conversationId.current)}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok)
            throw new Error("无法恢复会话，请检查链接或稍后重试。");
          const data = (await response.json()) as { runs: RunSnapshot[] };
          if (controller.signal.aborted) return;
          setHistory(data.runs);
          const latest = data.runs.at(-1);
          if (latest) attach(latest);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(String(error.message));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      stream.current?.close();
    };
  }, []);
  const active = loading || submitting || (run && !run.settledAt);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    stream.current?.close();
    setRun(undefined);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ...(attachment ? { attachmentIds: [attachment.id] } : {}),
          ...(projectId ? { projectId } : {}),
          ...(conversationId.current
            ? { conversationId: conversationId.current }
            : {}),
        }),
      });
      if (!response.ok) throw new Error("暂时无法接受查询，请稍后重试。");
      const accepted = (await response.json()) as RunSnapshot;
      setAttachment(undefined);
      conversationId.current = accepted.conversationId;
      const url = new URL(window.location.href);
      url.searchParams.set("conversation", accepted.conversationId);
      window.history.replaceState(null, "", url);
      setHistory((previous) => [
        ...previous.filter((item) => item.id !== accepted.id),
        accepted,
      ]);
      attach(accepted);
    } catch (error) {
      setError(error instanceof Error ? error.message : "查询失败");
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!run) return;
    try {
      const response = await fetch(`/api/runs/${run.id}/cancel`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("取消请求失败，请重试。");
      setRun((await response.json()) as RunSnapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "取消失败");
    }
  }
  return (
    <main>
      <header>
        <span className="eyebrow">LOREWEAVE</span>
        <h1>让答案回到原文</h1>
        <a href="/wiki">浏览知识主题</a>
        <p>查阅知识、理解关联，并沿着引用核对每一个结论。</p>
      </header>
      <aside>
        <strong>本地开发验证</strong>
        <p>
          当前检索已导入的
          Markdown，并使用受控向量与摘录式模型响应验证流程。导入资料后即可查询；此模式不代表真实模型质量。
        </p>
      </aside>
      <SourceImports
        projectId={projectId}
        attachment={attachment}
        onAttachment={setAttachment}
      />
      <form onSubmit={submit}>
        <label htmlFor="question">问题</label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="项目日志保留多久？"
          required
          maxLength={8000}
        />
        <div className="actions">
          <button disabled={Boolean(active) || !question.trim()}>提问</button>
          {active && run && (
            <button type="button" className="secondary" onClick={cancel}>
              取消
            </button>
          )}
        </div>
      </form>
      {loading && <p>正在恢复会话</p>}
      {history.length > 1 && (
        <nav aria-label="会话历史">
          {history
            .filter((item) => item.id !== run?.id)
            .map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  void fetch(`/api/runs/${item.id}`)
                    .then(async (response) => {
                      if (!response.ok) throw new Error("无法读取历史记录");
                      attach((await response.json()) as RunSnapshot);
                    })
                    .catch((error) => setError(String(error.message)));
                }}
              >
                查看第 {index + 1} 轮
              </button>
            ))}
        </nav>
      )}
      {error && <p role="alert">{error}</p>}
      {run && (
        <section className="result">
          <p role="status">
            {labels[run.status]}
            {!run.settledAt && ["canceled", "timed_out"].includes(run.status)
              ? "，正在结束执行"
              : ""}
          </p>
          {run.answer && (
            <>
              <p data-testid="answer">{run.answer.text}</p>
              <ul>
                {run.answer.citations.map((source) => (
                  <li
                    key={`${source.id}:${source.version}:${source.passageId ?? ""}`}
                  >
                    <a
                      href={`/sources/${source.version}${source.passageId ? `#${source.passageId}` : ""}`}
                    >
                      {source.title} · {source.version}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {run.diagnostics && (
            <details>
              <summary>开发诊断</summary>
              <pre>
                {JSON.stringify(
                  { counts: run.counts, ...run.diagnostics },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          {run.status === "failed" && (
            <p>
              {run.reason?.endsWith("_interrupted") ||
              run.reason === "history_requires_reconciliation"
                ? "此前执行已中断或历史结果不完整，需完成对账后继续；系统不会自动重跑。"
                : run.reason === "provider_unavailable" ||
                    run.reason === "retrieval_unavailable"
                  ? "检索或模型服务暂不可用，本次没有发布答案。"
                  : run.reason === "source_changed"
                    ? "来源在回答期间发生变化，本次没有发布过时答案。"
                    : "本次没有得到通过审核的答案，请重试或补充资料。"}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
function SourcePage({
  version,
  canImport,
  canCorrect,
}: {
  version: string;
  canImport: boolean;
  canCorrect: boolean;
}) {
  const [attachment, setAttachment] = useState<Attachment>();
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState<
    Evidence &
      Partial<
        Pick<
          SourceVersion,
          "passages" | "state" | "projectId" | "currentVersionId"
        >
      >
  >();
  const [error, setError] = useState(false);
  const context = useMemo(
    () => markdownContext(source?.text ?? ""),
    [source?.text],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sources/${encodeURIComponent(version)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setSource((await response.json()) as Evidence);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [version, revision]);
  return (
    <main>
      <a href="/">← 返回提问</a>
      {source ? (
        <>
          <h1>{source.title}</h1>
          <p>原文版本：{source.version}</p>
          {source.passages ? (
            <>
              <p>
                {source.state === "superseded"
                  ? "历史版本，当前检索使用后续版本"
                  : "当前生效来源"}
              </p>
              {source.state === "superseded" && source.currentVersionId && (
                <p>
                  <a href={`/sources/${source.currentVersionId}`}>
                    查看当前版本
                  </a>
                </p>
              )}
              {canImport && source.state === "active" && (
                <SourceImports
                  projectId={source.projectId ?? ""}
                  attachment={attachment}
                  onAttachment={setAttachment}
                  target={{
                    documentId: source.id,
                    expectedPrior: source.version,
                  }}
                  onActivated={() => setRevision((value) => value + 1)}
                />
              )}
              <a href={`/api/sources/${source.version}/original`}>
                下载原始 Markdown
              </a>
              <IdentityPanel
                key={`${source.version}:${source.state}`}
                version={source.version}
                passages={source.passages}
                canCorrect={canCorrect && source.state === "active"}
              />
              <article>
                {source.passages.map((passage) => (
                  <section key={passage.id} id={passage.id}>
                    <a href={`#${passage.id}`}>段落 {passage.ordinal + 1}</a>
                    <Markdown text={passage.text} context={context} />
                  </section>
                ))}
              </article>
              <details>
                <summary>查看完整原文</summary>
                <pre data-testid="original-markdown">{source.text}</pre>
              </details>
            </>
          ) : (
            <article>{source.text}</article>
          )}
        </>
      ) : (
        <p>{error ? "没有找到该原文版本" : "正在读取原文"}</p>
      )}
    </main>
  );
}
const wikiMatch = window.location.pathname.match(/^\/wiki(?:\/([^/]+))?$/);
const version = window.location.pathname.match(/^\/sources\/([^/]+)$/)?.[1];
createRoot(document.getElementById("root")!).render(
  <AccessShell>
    {({ actor, projectId }) =>
      wikiMatch ? (
        <WikiBrowser
          projectId={projectId}
          {...(wikiMatch[1] ? { id: wikiMatch[1] } : {})}
        />
      ) : version ? (
        <SourcePage
          version={version}
          canImport={actor.grants.includes("import")}
          canCorrect={actor.grants.includes("correct")}
        />
      ) : (
        <App projectId={projectId} />
      )
    }
  </AccessShell>,
);
