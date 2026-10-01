import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Upload,
  Files,
  Search,
  ChevronDown,
  FileText,
  ExternalLink,
  X,
  RotateCcw,
} from "lucide-react";
import {
  getLibrary,
  getDocument,
  retryOperation,
  retireSource,
} from "../functions/documents";
import type { IndexMode, WorkStatus } from "../contracts/documents";
import { Empty, IconButton, errorMessage } from "./ui";

export const statusNames: Record<WorkStatus, string> = {
  queued: "等待处理",
  processing: "处理中",
  ready: "可问答",
  failed: "失败",
  unsupported: "不支持",
  interrupted: "已中断",
};
export function LibraryView({ selectedId }: { selectedId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [submission, setSubmission] = useState(() => crypto.randomUUID());
  const list = useInfiniteQuery({
    queryKey: ["library", filter],
    queryFn: ({ pageParam }) =>
      getLibrary({
        data: { limit: 20, cursor: pageParam, filter: filter || undefined },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 2000,
  });
  const detail = useQuery({
    queryKey: ["document", selectedId],
    queryFn: () => getDocument({ data: { id: selectedId! } }),
    enabled: !!selectedId,
    refetchInterval: 2000,
  });
  const form = useForm({
    defaultValues: { mode: "flash" as IndexMode },
    onSubmit: async ({ value }) => {
      if (!file) return;
      setError("");
      const data = new FormData();
      data.set("file", file);
      data.set("mode", value.mode);
      data.set("submissionId", submission);
      try {
        const response = await fetch("/api/documents", {
          method: "POST",
          body: data,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setFile(null);
        setSubmission(crypto.randomUUID());
        await qc.invalidateQueries({ queryKey: ["library"] });
        await navigate({ to: "/documents", search: { id: result.documentId } });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <main className="working-view library-view">
      <div className="section-heading">
        <h1>文档库</h1>
        <span className="muted">
          {items.length}
          {list.hasNextPage ? "+" : ""} 份文档
        </span>
      </div>
      <form
        method="post"
        className="import-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <label className="file-picker">
          <Upload size={17} />
          <span>{file?.name ?? "选择 PDF"}</span>
          <input
            aria-label="PDF 文件"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setSubmission(crypto.randomUUID());
              e.target.value = "";
            }}
          />
        </label>
        <form.Field name="mode">
          {(f) => (
            <fieldset className="segmented">
              <legend className="sr-only">索引模式</legend>
              {(["flash", "standard"] as const).map((mode) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="index-mode"
                    value={mode}
                    checked={f.state.value === mode}
                    onChange={() => f.handleChange(mode)}
                  />
                  <span>{mode === "flash" ? "Flash" : "Standard"}</span>
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => (
            <button className="primary" disabled={!file || busy} type="submit">
              <Upload size={16} />
              导入
            </button>
          )}
        </form.Subscribe>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="library-columns">
        <section className="document-list">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="搜索文档"
              placeholder="搜索文档"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {list.error && <p className="error">{errorMessage(list.error)}</p>}
          {!items.length && !list.isLoading ? (
            <Empty icon={Files}>暂无文档</Empty>
          ) : (
            items.map((doc) => (
              <Link
                className={`document-row ${selectedId === doc.id ? "selected" : ""}`}
                to="/documents"
                search={{ id: doc.id }}
                key={doc.id}
              >
                <FileText size={22} />
                <div className="document-row-content">
                  <strong>{doc.name}</strong>
                  <p>
                    {doc.description ||
                      (doc.pageCount ? `${doc.pageCount} 页` : "PDF")}
                  </p>
                  <span
                    className={`status ${doc.status === "failed" || doc.status === "unsupported" ? "status-error" : ""}`}
                  >
                    {doc.ready && doc.status !== "ready"
                      ? `可问答 · ${statusNames[doc.status]}`
                      : statusNames[doc.status]}
                  </span>
                  <small className="muted">
                    {doc.mode === "flash" ? "Flash" : "Standard"}
                  </small>
                </div>
              </Link>
            ))
          )}
          {list.hasNextPage && (
            <button
              onClick={() => {
                void list.fetchNextPage();
              }}
              disabled={list.isFetchingNextPage}
            >
              <ChevronDown size={16} />
              加载更多
            </button>
          )}
        </section>
        <section className="document-inspection">
          {detail.data ? (
            <DocumentInspection key={detail.data.id} value={detail.data} />
          ) : detail.error ? (
            <p className="error">{errorMessage(detail.error)}</p>
          ) : (
            <Empty icon={FileText}>未选择文档</Empty>
          )}
        </section>
      </div>
    </main>
  );
}
function DocumentInspection({
  value,
}: {
  value: Awaited<ReturnType<typeof getDocument>>;
}) {
  const versionId = value.versionId ?? value.versions[0]?.id;
  const qc = useQueryClient();
  const [retiring, setRetiring] = useState(false),
    [retireError, setRetireError] = useState("");
  const [retryMode, setRetryMode] = useState<IndexMode>(
    value.operation.attempts[0]?.mode ?? "flash",
  );
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retrySubmission, setRetrySubmission] = useState(() =>
    crypto.randomUUID(),
  );
  return (
    <>
      <div className="section-heading">
        <h2>{value.name}</h2>
        <Link
          to="/documents"
          search={{}}
          className="icon-button"
          aria-label="关闭文档详情"
          title="关闭文档详情"
        >
          <X size={18} />
        </Link>
      </div>
      <p className="muted">
        {statusNames[value.operation.status]} · {value.operation.stage}
      </p>
      {value.retired ? (
        <p className="notice">已移出当前库 · 历史原文与引用保留</p>
      ) : (
        <button className="danger" onClick={() => setRetiring(true)}>
          移出当前库
        </button>
      )}
      {retiring && (
        <div
          className="inline-confirmation"
          role="dialog"
          aria-label="移出当前库"
        >
          <p>
            将“{value.name}”移出当前库？之后不能用于新问题，历史原文与引用保留。
          </p>
          <div className="toolbar">
            <button
              className="danger"
              onClick={async () => {
                try {
                  await retireSource({ data: { id: value.id } });
                  setRetiring(false);
                  await qc.invalidateQueries({
                    queryKey: ["document", value.id],
                  });
                  await qc.invalidateQueries({ queryKey: ["library"] });
                  await qc.invalidateQueries({ queryKey: ["scope-library"] });
                } catch (e) {
                  setRetireError(errorMessage(e));
                }
              }}
            >
              确认移出
            </button>
            <button onClick={() => setRetiring(false)}>取消</button>
          </div>
        </div>
      )}
      {retireError && (
        <p className="error" role="alert">
          {retireError}
        </p>
      )}
      {!value.retired && <UpdateFile value={value} />}
      {value.operation.reason && (
        <p className="error" role="alert">
          {value.operation.reason}
        </p>
      )}
      {!value.retired &&
        ["failed", "interrupted"].includes(value.operation.status) && (
          <form
            method="post"
            className="retry-bar"
            onSubmit={async (e) => {
              e.preventDefault();
              setRetrying(true);
              setRetryError("");
              try {
                await retryOperation({
                  data: {
                    operationId: value.operation.id,
                    submissionId: retrySubmission,
                    mode: retryMode,
                  },
                });
                setRetrySubmission(crypto.randomUUID());
                await qc.invalidateQueries({
                  queryKey: ["document", value.id],
                });
                await qc.invalidateQueries({ queryKey: ["library"] });
              } catch (e) {
                setRetryError(errorMessage(e));
              } finally {
                setRetrying(false);
              }
            }}
          >
            <select
              aria-label="重试索引模式"
              value={retryMode}
              onChange={(e) => {
                setRetryMode(e.target.value as IndexMode);
                setRetrySubmission(crypto.randomUUID());
              }}
            >
              <option value="flash">Flash</option>
              <option value="standard">Standard</option>
            </select>
            <button type="submit" disabled={retrying}>
              <RotateCcw size={16} />
              重试
            </button>
          </form>
        )}
      {retryError && (
        <p role="alert" className="error">
          {retryError}
        </p>
      )}
      <details className="attempt-history">
        <summary>处理记录</summary>
        {value.operation.attempts.map((a) => (
          <div key={a.id}>
            <strong>
              {a.mode === "flash" ? "Flash" : "Standard"} ·{" "}
              {statusNames[a.status]}
            </strong>
            <p>
              {a.stage}
              {a.reason ? ` · ${a.reason}` : ""}
            </p>
            <small>
              {a.usage.modelCalls} calls · {a.usage.inputTokens}/
              {a.usage.outputTokens} tokens
            </small>
          </div>
        ))}
      </details>
      {versionId && (
        <Link
          className="open-original"
          to="/original/$versionId"
          params={{ versionId }}
          search={{ page: 1, returnTo: `/documents?id=${value.id}` }}
        >
          <ExternalLink size={16} />
          打开原文
        </Link>
      )}
      <h3 className="tree-heading">章节</h3>
      {value.versions.length > 1 && (
        <details className="attempt-history">
          <summary>历史原文版本</summary>
          {value.versions.map((v) => (
            <p key={v.id}>
              <Link
                to="/original/$versionId"
                params={{ versionId: v.id }}
                search={{ page: 1, returnTo: `/documents?id=${value.id}` }}
              >
                {v.filename} · {new Date(v.createdAt).toLocaleString()}{" "}
                {v.id === value.versionId ? "· 当前可问答" : ""}
              </Link>
            </p>
          ))}
        </details>
      )}
      {!value.tree.length ? (
        <p className="muted">尚未生成</p>
      ) : (
        <ol className="chapter-tree">
          {value.tree.map((node) => (
            <li
              key={node.id}
              style={{ paddingLeft: `${Math.min(node.depth, 8) * 14}px` }}
            >
              <Link
                to="/original/$versionId"
                params={{ versionId: versionId! }}
                search={{
                  page: node.start,
                  returnTo: `/documents?id=${value.id}`,
                }}
              >
                <span>{node.title}</span>
                <small>
                  {node.start}–{node.end}
                </small>
              </Link>
              {node.summary && <p>{node.summary}</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
function UpdateFile({
  value,
}: {
  value: Awaited<ReturnType<typeof getDocument>>;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [submission, setSubmission] = useState(() => crypto.randomUUID());
  const form = useForm({
    defaultValues: { mode: "flash" as IndexMode },
    onSubmit: async ({ value: input }) => {
      if (!file) return;
      setError("");
      const data = new FormData();
      data.set("file", file);
      data.set("mode", input.mode);
      data.set("submissionId", submission);
      data.set("expectedRevision", String(value.revision));
      try {
        const response = await fetch(`/api/documents/${value.id}/updates`, {
          method: "POST",
          body: data,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setFile(null);
        setSubmission(crypto.randomUUID());
        await qc.invalidateQueries({ queryKey: ["document", value.id] });
        await qc.invalidateQueries({ queryKey: ["library"] });
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });
  return (
    <form
      method="post"
      className="update-file"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <label className="file-picker">
        <Upload size={16} />
        <span>{file?.name ?? "更新文件"}</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label="更新 PDF 文件"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setSubmission(crypto.randomUUID());
            e.target.value = "";
          }}
        />
      </label>
      {file && (
        <>
          <form.Field name="mode">
            {(f) => (
              <select
                aria-label="更新索引模式"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value as IndexMode)}
              >
                <option value="flash">Flash</option>
                <option value="standard">Standard</option>
              </select>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(busy) => (
              <button type="submit" disabled={busy}>
                提交更新
              </button>
            )}
          </form.Subscribe>
          <p className="muted">完成索引后启用新文件，期间仍可阅读当前版本。</p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
