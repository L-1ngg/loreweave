import { WikiHistoryPanel, WikiChangeForm } from "./wiki-history.tsx";
import React, { useEffect, useState } from "react";
import type { WikiPage } from "../src/wiki-types.ts";
import { Markdown } from "./markdown.tsx";
interface Catalogue {
  items: Array<{
    id: string;
    version: string;
    title: string;
    fresh: boolean;
    lifecycle: string;
  }>;
  next?: string;
}
export function WikiBrowser({
  projectId,
  id,
}: {
  projectId: string;
  id?: string;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue>({ items: [] }),
    [page, setPage] = useState<WikiPage>(),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [after, setAfter] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setAfter("");
    setSelected([]);
    setCatalogue({ items: [] });
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (after) query.set("after", after);
    const version = new URLSearchParams(window.location.search).get("version");
    const url = id
      ? `/api/wiki/${encodeURIComponent(id)}${version ? `?version=${encodeURIComponent(version)}` : ""}`
      : `/api/wiki?${query}`;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("暂时无法读取知识主题。");
        const data = await response.json();
        if (id) setPage(data);
        else setCatalogue(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error.message));
      });
    return () => controller.abort();
  }, [id, projectId, revision, after]);
  return (
    <main>
      <a href="/">← 返回提问</a>
      <p>
        <a href="/wiki">浏览知识主题</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {id ? (
        page ? (
          <>
            <h1>{page.title}</h1>
            <a
              href={`/?pageId=${page.id}&pageVersion=${page.version}&project=${page.projectId ?? ""}`}
            >
              围绕此主题提问或整理
            </a>
            {page.lifecycle === "retired" && page.retirement && (
              <p role="status">
                此主题已退休：当前来源不再提供支持（
                {new Date(page.retirement.at).toLocaleString()}
                ）。历史内容和链接继续保留。
              </p>
            )}
            <p>
              {page.fresh
                ? "当前有效"
                : "此版本仅供查阅，当前回答不使用其中的旧内容"}
            </p>
            {page.successors && page.successors.length > 0 && (
              <section>
                <h2>
                  {page.lifecycle === "redirect"
                    ? "此主题已合并"
                    : "此主题已拆分"}
                </h2>
                <p>原入口与历史内容继续保留。当前内容请查看：</p>
                <ul>
                  {page.successors.map((successor) => (
                    <li key={successor.pageId}>
                      <a href={`/wiki/${successor.pageId}`}>
                        {successor.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <article>
              <Markdown text={page.text} />
            </article>
            <h2>依据原文</h2>
            <ul>
              {page.sources.map((ref, index) => (
                <li key={`${ref.version}:${ref.passageId}:${ref.start}`}>
                  <a href={`/sources/${ref.version}#${ref.passageId}`}>
                    原文 {index + 1}：{ref.title}
                  </a>
                </li>
              ))}
            </ul>
            <WikiHistoryPanel page={page} />
            {page.descriptor.identities.length > 0 && (
              <p>本主题保留了对象身份的原文依据，可在来源页面查看。</p>
            )}
          </>
        ) : (
          <p>正在读取知识主题</p>
        )
      ) : (
        <>
          <h1>知识主题</h1>
          <button onClick={() => setRevision((value) => value + 1)}>
            刷新主题
          </button>
          <ul>
            {catalogue.items.map((item) => (
              <li key={item.id}>
                {item.lifecycle === "active" && item.fresh && (
                  <input
                    type="checkbox"
                    aria-label={`选择主题：${item.title}`}
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id),
                      )
                    }
                  />
                )}
                <a href={`/wiki/${item.id}`}>{item.title}</a> ·{" "}
                {item.lifecycle === "redirect"
                  ? "已合并，保留入口"
                  : item.lifecycle === "split_entry"
                    ? "已拆分，查看后继主题"
                    : item.lifecycle === "retired"
                      ? "已退休，保留历史"
                      : item.fresh
                        ? "当前有效"
                        : "等待更新或需要处理"}
              </li>
            ))}
          </ul>
          {selected.length >= 2 && selected.length <= 3 && (
            <WikiChangeForm
              key={selected.join(":")}
              title="合并所选主题"
              label="合并说明"
              build={(key, reason) => ({
                url: "/api/wiki-restructures",
                body: {
                  key,
                  reason,
                  kind: "merge",
                  pages: catalogue.items
                    .filter((item) => selected.includes(item.id))
                    .map((item) => ({
                      pageId: item.id,
                      version: item.version,
                    })),
                },
              })}
            />
          )}
          {!catalogue.items.length && (
            <p>
              还没有已发布的知识主题。来源准备好后，系统会提取并审核可用主题。
            </p>
          )}
          {after && <button onClick={() => setAfter("")}>返回首页</button>}
          {catalogue.next && (
            <button onClick={() => setAfter(catalogue.next!)}>下一页</button>
          )}
        </>
      )}
    </main>
  );
}

export function WikiMaintenance({ id }: { id: string }) {
  const [record, setRecord] = useState<{
      status: string;
      pages: Array<{ pageId: string; disposition: string }>;
      jobs: Array<{ id: string; state: string; reason?: string }>;
    }>(),
    [error, setError] = useState(""),
    [repair, setRepair] = useState({ key: crypto.randomUUID(), guidance: "" }),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/wiki-operations/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取维护记录");
        setRecord(await response.json());
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  return (
    <main>
      <a href="/wiki">← 返回知识主题</a>
      <h1>知识维护记录</h1>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {record?.status === "ready"
          ? "处理完成"
          : record?.status === "failed"
            ? "需要处理"
            : "等待处理"}
        。原文可用性单独记录。
      </p>
      <button onClick={() => setRevision((value) => value + 1)}>
        刷新进度
      </button>
      <ul>
        {record?.pages.map((page) => (
          <li key={page.pageId}>
            <a href={`/wiki/${page.pageId}`}>查看主题</a>：
            {page.disposition === "retired"
              ? "已退休"
              : page.disposition === "coalesced"
                ? "已合并重复工作"
                : "已发布"}
          </li>
        ))}
      </ul>
      <ul>
        {record?.jobs
          .filter((job) => job.reason)
          .map((job) => (
            <li key={job.id}>{job.reason}</li>
          ))}
      </ul>
      {record?.status === "failed" && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const response = await fetch(
                `/api/wiki-operations/${id}/repair`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(repair),
                },
              );
              if (!response.ok)
                throw new Error("修复未确认，请重试相同请求或检查维护记录。");
              const result = await response.json();
              window.location.assign(`/wiki-operations/${result.operationId}`);
            } catch (error) {
              setError(error instanceof Error ? error.message : "无法提交修复");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            修复说明
            <textarea
              required
              maxLength={300}
              value={repair.guidance}
              onChange={(event) =>
                setRepair({
                  key: crypto.randomUUID(),
                  guidance: event.target.value,
                })
              }
            />
          </label>
          <button disabled={busy} type="submit">
            提交修复
          </button>
        </form>
      )}
    </main>
  );
}
