import React, { useEffect, useState } from "react";
import type { WikiPage } from "../src/wiki-types.ts";
import { Markdown } from "./markdown.tsx";
interface Catalogue {
  items: Array<{ id: string; version: string; title: string; fresh: boolean }>;
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
    [after, setAfter] = useState("");
  useEffect(() => {
    setAfter("");
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
            <p>
              {page.fresh
                ? "当前有效"
                : "此版本仅供查阅，当前回答不使用其中的旧内容"}
            </p>
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
                <a href={`/wiki/${item.id}`}>{item.title}</a> ·{" "}
                {item.fresh ? "当前有效" : "等待更新或需要处理"}
              </li>
            ))}
          </ul>
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
