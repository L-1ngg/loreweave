import { useMemo, useRef, useState, useEffect } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  useChat,
  fetchServerSentEvents,
  type ConnectConnectionAdapter,
  type UIMessage,
} from "@tanstack/ai-react";
import MarkdownIt from "markdown-it";
import {
  Plus,
  Send,
  Square,
  MessageSquare,
  X,
  Files,
  Pencil,
  Trash2,
  Save,
  RotateCcw,
} from "lucide-react";
import {
  getConversations,
  newConversation,
  getConversation,
  askQuestion,
  getRun,
  stopQuestion,
  renameChat,
  removeChat,
} from "../functions/knowledge";
import { getLibrary } from "../functions/documents";
import { answerSchema, type Scope } from "../contracts/knowledge";
import { PdfViewer } from "./pdf-viewer";
import { Empty, errorMessage, IconButton } from "./ui";

type Snapshot = Awaited<ReturnType<typeof getConversation>>;
type Reference = Snapshot["references"][number];
function outcomeLabel(status: string, outcome?: string) {
  if (status === "completed")
    return (
      {
        answer: "已完成",
        clarification: "需要澄清",
        evidence_gap: "证据不足",
        incomplete: "阅读未完成",
      } as Record<string, string>
    )[outcome ?? "incomplete"];
  return (
    (
      {
        queued: "等待生成",
        running: "正在阅读与生成",
        stopping: "正在停止",
        stopped: "已停止",
        interrupted: "已中断",
        failed: "生成失败",
      } as Record<string, string>
    )[status] ?? status
  );
}
export function ConversationView({ selectedId }: { selectedId?: string }) {
  const qc = useQueryClient(),
    navigate = useNavigate();
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: () => getConversations(),
    refetchInterval: 2000,
  });
  const detail = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => getConversation({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });
  const [error, setError] = useState("");
  return (
    <main className="working-view conversations-view">
      <div className="section-heading">
        <h1>对话</h1>
        <button
          onClick={async () => {
            try {
              const c = await newConversation();
              await qc.invalidateQueries({ queryKey: ["conversations"] });
              await navigate({ to: "/conversation", search: { id: c.id } });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <Plus size={17} />
          新对话
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="conversation-columns">
        <aside className="conversation-list">
          {list.data?.map((c) => (
            <Link
              key={c.id}
              to="/conversation"
              search={{ id: c.id }}
              className={`conversation-row ${c.id === selectedId ? "selected" : ""}`}
            >
              <MessageSquare size={17} />
              <span>{c.name}</span>
              {c.activeRun && <small>生成中</small>}
            </Link>
          ))}
        </aside>
        {detail.data ? (
          <ChatSession key={detail.data.id} snapshot={detail.data} />
        ) : detail.error ? (
          <p className="error">{errorMessage(detail.error)}</p>
        ) : (
          <Empty icon={MessageSquare}>创建或选择一个对话</Empty>
        )}
      </div>
    </main>
  );
}
function ChatSession({ snapshot }: { snapshot: Snapshot }) {
  const qc = useQueryClient(),
    navigate = useNavigate();
  const [scope, setScope] = useState<Scope>(snapshot.scope),
    [runId, setRunId] = useState<string | null>(
      snapshot.activeRun ?? snapshot.latestRun,
    ),
    [reference, setReference] = useState<Reference | null>(null),
    [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false),
    [deleting, setDeleting] = useState(false);
  const nameForm = useForm({
    defaultValues: { name: snapshot.name },
    onSubmit: async ({ value }) => {
      try {
        await renameChat({ data: { id: snapshot.id, name: value.name } });
        setRenaming(false);
        await qc.invalidateQueries({ queryKey: ["conversation", snapshot.id] });
        await qc.invalidateQueries({ queryKey: ["conversations"] });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const submission = useRef(crypto.randomUUID());
  const join = (id: string, signal?: AbortSignal) =>
    fetchServerSentEvents(`/api/runs/${id}/events`).joinRun(id, signal);
  const connection = useMemo<ConnectConnectionAdapter>(
    () => ({
      async *connect(local, _data, signal) {
        const user = local.findLast((m) => m.role === "user");
        const question =
          user && "parts" in user
            ? user.parts
                .filter((p) => p.type === "text")
                .map((p) => p.content)
                .join("")
            : user && "content" in user
              ? String(user.content)
              : "";
        const accepted = await askQuestion({
          data: {
            conversationId: snapshot.id,
            submissionId: submission.current,
            messageId: user?.id,
            question,
            scope: scopeRef.current,
          },
        });
        submission.current = crypto.randomUUID();
        setRunId(accepted.runId);
        yield* join(accepted.runId, signal);
      },
      joinRun: join,
      async hydrate(id) {
        const saved = await getConversation({ data: { id } });
        setRunId(saved.activeRun ?? saved.latestRun);
        return {
          messages: JSON.parse(saved.transcript),
          activeRun: saved.activeRun ? { runId: saved.activeRun } : null,
          interrupts: null,
        };
      },
    }),
    [snapshot.id],
  );
  const initial = useMemo<UIMessage[]>(
    () => JSON.parse(snapshot.transcript),
    [snapshot.id],
  );
  const chat = useChat({
    threadId: snapshot.id,
    connection,
    persistence: true,
    initialMessages: initial,
    outputSchema: answerSchema,
    onFinish: () => {
      void qc.invalidateQueries({ queryKey: ["conversation", snapshot.id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["run", runId] });
    },
  });
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun({ data: { id: runId! } }),
    enabled: !!runId,
    refetchInterval: (q) =>
      q.state.data &&
      !["queued", "running", "stopping"].includes(q.state.data.status)
        ? false
        : 500,
  });
  const library = useInfiniteQuery({
    queryKey: ["scope-library"],
    queryFn: ({ pageParam }) =>
      getLibrary({ data: { limit: 20, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const active = run.data
    ? ["queued", "running", "stopping"].includes(run.data.status)
    : !!runId || chat.isLoading;
  const refs = [...snapshot.references, ...(run.data?.references ?? [])];
  let messageRun: string | null = null;
  const presented = chat.messages.map((message) => {
    if (message.role === "user") {
      messageRun =
        snapshot.runs.find((r) => r.questionMessageId === message.id)?.id ??
        runId;
    }
    return { message, references: refs.filter((r) => r.runId === messageRun) };
  });
  const form = useForm({
    defaultValues: { question: "" },
    onSubmit: async ({ value }) => {
      if (!value.question.trim() || active) return;
      setError("");
      try {
        await chat.sendMessage(value.question);
        form.reset();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const key = `loreweave-scroll:${snapshot.id}`;
    const el = scroll.current;
    if (!el) return;
    const saved = sessionStorage.getItem(key);
    el.scrollTop = saved === null ? el.scrollHeight : Number(saved) || 0;
    follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
    const save = () => {
      sessionStorage.setItem(key, String(el.scrollTop));
      follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80;
    };
    el.addEventListener("scroll", save);
    return () => {
      save();
      el.removeEventListener("scroll", save);
    };
  }, [snapshot.id]);
  useEffect(() => {
    if (!follow.current) return;
    const frame = requestAnimationFrame(() => {
      if (scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [chat.messages]);
  const open = (ref: Reference) => {
    if (matchMedia("(min-width: 1000px)").matches) setReference(ref);
    else
      void navigate({
        to: "/original/$versionId",
        params: { versionId: ref.versionId },
        search: { page: ref.page, returnTo: `/conversation?id=${snapshot.id}` },
        resetScroll: false,
      });
  };
  return (
    <section className={`chat-session ${reference ? "with-original" : ""}`}>
      <div className="chat-main">
        <div className="section-heading chat-heading">
          {renaming ? (
            <form
              method="post"
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void nameForm.handleSubmit();
              }}
            >
              <nameForm.Field name="name">
                {(f) => (
                  <input
                    aria-label="对话名称"
                    value={f.state.value}
                    maxLength={100}
                    required
                    onChange={(e) => f.handleChange(e.target.value)}
                  />
                )}
              </nameForm.Field>
              <IconButton icon={Save} label="保存对话名称" type="submit" />
              <IconButton
                icon={X}
                label="取消重命名"
                onClick={() => setRenaming(false)}
              />
            </form>
          ) : (
            <h2>{snapshot.name}</h2>
          )}
          <div className="toolbar">
            <IconButton
              icon={Pencil}
              label="重命名对话"
              onClick={() => setRenaming(true)}
            />
            <IconButton
              icon={Trash2}
              label="删除对话"
              onClick={() => setDeleting(true)}
            />
          </div>
        </div>
        {deleting && (
          <div
            role="dialog"
            aria-label="删除对话"
            className="inline-confirmation"
          >
            <p>删除“{snapshot.name}”及其对话记录？</p>
            {active && <p className="error">请先 Stop 并等待停止后删除。</p>}
            <div className="toolbar">
              <button
                disabled={active}
                className="danger"
                onClick={async () => {
                  try {
                    await removeChat({ data: { id: snapshot.id } });
                    qc.removeQueries({
                      queryKey: ["conversation", snapshot.id],
                    });
                    await qc.invalidateQueries({ queryKey: ["conversations"] });
                    await navigate({ to: "/conversation", search: {} });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                确认删除
              </button>
              <button onClick={() => setDeleting(false)}>取消</button>
            </div>
          </div>
        )}
        <details className="scope-picker">
          <summary>
            <Files size={16} />
            {scope.mode === "library"
              ? "当前文档库"
              : `已选择 ${scope.documentIds.length} 份文档`}
          </summary>
          <label>
            <input
              type="radio"
              name="scope-mode"
              checked={scope.mode === "library"}
              onChange={() => setScope({ mode: "library" })}
              disabled={active}
            />
            当前文档库
          </label>
          {library.data?.pages
            .flatMap((p) => p.items)
            .filter((d) => d.ready)
            .map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={
                    scope.mode === "selected" &&
                    scope.documentIds.includes(d.id)
                  }
                  disabled={active}
                  onChange={(e) => {
                    const ids =
                      scope.mode === "selected" ? scope.documentIds : [];
                    setScope({
                      mode: "selected",
                      documentIds: e.target.checked
                        ? [...ids, d.id]
                        : ids.filter((id) => id !== d.id),
                    });
                  }}
                />
                {d.name}
              </label>
            ))}
          {library.hasNextPage && (
            <button
              onClick={() => {
                void library.fetchNextPage();
              }}
            >
              加载更多文档
            </button>
          )}
        </details>
        <div className="transcript" ref={scroll}>
          {presented.map(({ message, references }) => (
            <article
              key={message.id}
              data-message-id={message.id}
              className={`message ${message.role}`}
            >
              <small>{message.role === "user" ? "你" : "LoreWeave"}</small>
              {message.role === "user" &&
                snapshot.runs
                  .filter((r) => r.questionMessageId === message.id)
                  .map((r) => (
                    <small
                      key={r.id}
                      className="history-outcome"
                      data-run-id={r.id}
                    >
                      {outcomeLabel(r.status, r.result?.outcome)}
                      {r.reason && ` · ${r.reason}`}
                    </small>
                  ))}
              {message.parts.map((part, i) => {
                if (part.type === "text")
                  return (
                    <Markdown
                      key={i}
                      text={part.content}
                      references={references}
                      onOpen={open}
                    />
                  );
                if (part.type === "structured-output")
                  return (
                    <Markdown
                      key={i}
                      text={part.data?.text ?? part.partial?.text ?? ""}
                      references={references}
                      onOpen={open}
                    />
                  );
                if (part.type === "tool-call")
                  return (
                    <details key={i} className="reading-activity">
                      <summary>
                        {part.name === "get_page_content"
                          ? "读取原文"
                          : part.name === "get_document_structure"
                            ? "查看章节"
                            : part.name === "browse_documents"
                              ? "发现文档"
                              : "查看文档"}
                      </summary>
                      <pre>{JSON.stringify(part.arguments)}</pre>
                    </details>
                  );
                return null;
              })}
            </article>
          ))}
        </div>
        {run.data && (
          <p className="run-outcome" role="status">
            {outcomeLabel(run.data.status, run.data.result?.outcome)}
            {run.data.reason && ` · ${run.data.reason}`}
          </p>
        )}
        {(snapshot.referenceIssues.length > 0 ||
          (run.data?.referenceIssues.length ?? 0) > 0) && (
          <p className="error" role="alert">
            部分引用的原文不可用
          </p>
        )}
        {(error || chat.error) && (
          <p role="alert" className="error">
            {error || errorMessage(chat.error)}
          </p>
        )}
        {!active &&
          run.data &&
          ["failed", "interrupted"].includes(run.data.status) && (
            <button
              className="resend-question"
              onClick={() => {
                setError("");
                void chat
                  .sendMessage(run.data!.question)
                  .catch((e) => setError(errorMessage(e)));
              }}
            >
              <RotateCcw size={16} />
              重新发送
            </button>
          )}
        <form
          method="post"
          className="question-form"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="question">
            {(f) => (
              <textarea
                aria-label="问题"
                placeholder="询问文档中的内容"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
                disabled={active}
              />
            )}
          </form.Field>
          {active ? (
            <button
              type="button"
              onClick={async () => {
                if (runId) {
                  try {
                    await stopQuestion({ data: { id: runId } });
                    await qc.invalidateQueries({ queryKey: ["run", runId] });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }
              }}
            >
              <Square size={16} />
              Stop
            </button>
          ) : (
            <button type="submit" className="primary">
              <Send size={17} />
              发送
            </button>
          )}
        </form>
      </div>
      {reference && (
        <aside className="adjacent-original">
          <div className="section-heading">
            <h3>
              {reference.documentName} · p{reference.page}
            </h3>
            <IconButton
              icon={X}
              label="关闭原文"
              onClick={() => setReference(null)}
            />
          </div>
          <PdfViewer
            versionId={reference.versionId}
            page={reference.page}
            onPage={(page) => setReference({ ...reference, page })}
          />
        </aside>
      )}
    </section>
  );
}
function Markdown({
  text,
  references,
  onOpen,
}: {
  text: string;
  references: Reference[];
  onOpen: (ref: Reference) => void;
}) {
  const md = useMemo(() => {
    const parser = new MarkdownIt({ html: false, linkify: false });
    const validate = parser.validateLink.bind(parser);
    parser.validateLink = (url) => url.startsWith("cite:") || validate(url);
    parser.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
      const href = String(tokens[idx].attrGet("href") ?? "");
      if (href.startsWith("cite:")) {
        const id = href.slice(5);
        const ref = references.find((r) => r.id === id);
        tokens[idx].attrSet(
          "href",
          ref ? `/original/${ref.versionId}?page=${ref.page}` : "#",
        );
        if (ref) tokens[idx].attrSet("data-citation", id);
        else {
          tokens[idx].attrSet("aria-disabled", "true");
          tokens[idx].attrSet("title", "引用不可用");
        }
      } else {
        tokens[idx].attrSet("rel", "noreferrer noopener");
        tokens[idx].attrSet("target", "_blank");
      }
      return self.renderToken(tokens, idx, options);
    };
    return parser;
  }, [references]);
  return (
    <div
      className="markdown-content"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        const id = a.getAttribute("data-citation");
        if (id) {
          e.preventDefault();
          const ref = references.find((r) => r.id === id);
          if (ref) onOpen(ref);
        } else if (a.getAttribute("aria-disabled")) e.preventDefault();
      }}
      dangerouslySetInnerHTML={{ __html: md.render(text) }}
    />
  );
}
