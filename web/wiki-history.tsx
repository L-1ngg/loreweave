import React, { useEffect, useState } from "react";
import type { WikiPage } from "../src/wiki-types.ts";

type HistoryItem = {
  version: string;
  title: string;
  createdAt: string;
  reason: string | null;
  current: boolean;
  editSetId: string | null;
};
export function WikiHistoryPanel({ page }: { page: WikiPage }) {
  const [items, setItems] = useState<HistoryItem[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/wiki/${page.id}/history`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取历史记录");
        setItems((await response.json()).items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [page.id, page.version]);
  return (
    <section>
      <h2>页面历史</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.version}>
            <a href={`/wiki/${page.id}?version=${item.version}`}>
              {new Date(item.createdAt).toLocaleString()} ·{" "}
              {item.current ? "当前版本" : "历史版本"}
            </a>
            {item.reason && <p>{item.reason}</p>}
          </li>
        ))}
      </ul>
      {items.some((item) => !item.current) && (
        <WikiChangeForm
          title="恢复历史内容"
          label="恢复理由"
          build={(key, reason, selected) => ({
            url: `/api/wiki/${page.id}/restore`,
            body: {
              key,
              reason,
              versionId: selected,
              expectedVersion: items.find((item) => item.current)?.version,
            },
          })}
          choices={items
            .filter((item) => !item.current)
            .map((item) => ({
              id: item.version,
              title: `${new Date(item.createdAt).toLocaleString()} · ${item.title}`,
            }))}
        />
      )}
      {page.editSetId && (
        <WikiChangeForm
          title="撤回这组调整"
          label="撤回理由"
          build={(key, reason) => ({
            url: `/api/wiki-edit-sets/${page.editSetId}/restore`,
            body: { key, reason },
          })}
        />
      )}
      {page.lifecycle === "active" && page.fresh && (
        <WikiChangeForm
          title="按独立主题拆分"
          label="拆分说明"
          build={(key, reason) => ({
            url: "/api/wiki-restructures",
            body: {
              key,
              reason,
              kind: "split",
              pages: [{ pageId: page.id, version: page.version }],
            },
          })}
        />
      )}
    </section>
  );
}
export function WikiChangeForm({
  title,
  label,
  choices,
  build,
}: {
  title: string;
  label: string;
  choices?: Array<{ id: string; title: string }>;
  build: (
    key: string,
    reason: string,
    selected: string,
  ) => { url: string; body: unknown };
}) {
  const [reason, setReason] = useState(""),
    [selected, setSelected] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details>
      <summary>{title}</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const request = build(
              key,
              reason,
              selected || choices?.[0]?.id || "",
            );
            const response = await fetch(request.url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request.body),
            });
            if (!response.ok)
              throw new Error("请求未确认。可重试相同请求，或查看维护记录。");
            const result = await response.json();
            if (result.status === "clarification") {
              setError(
                result.reason === "different_applicability"
                  ? "这些页面的适用范围不同，请重新选择。"
                  : "相关页面已有变化，请查看当前页面和历史后重新选择要恢复的范围。",
              );
              return;
            }
            window.location.assign(`/wiki-operations/${result.operationId}`);
          } catch (error) {
            setError(error instanceof Error ? error.message : "无法提交请求");
          } finally {
            setBusy(false);
          }
        }}
      >
        {choices && (
          <label>
            历史版本
            <select
              value={selected || choices[0]?.id || ""}
              onChange={(event) => {
                setSelected(event.target.value);
                setKey(crypto.randomUUID());
              }}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {label}
          <textarea
            required
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setKey(crypto.randomUUID());
            }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {title}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
