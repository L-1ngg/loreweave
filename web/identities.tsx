import React, { useEffect, useState } from "react";
import type { IdentityBinding } from "../src/identity.ts";
import type { SourceVersion } from "../src/sources.ts";
type MentionPage = {
  items: Array<{
    id: string;
    text: string;
    outcome: string;
    revision: number;
    valid: boolean;
  }>;
  nextCursor?: string;
};
export function IdentityPanel({
  version,
  passages,
  canCorrect,
}: {
  version: string;
  passages: SourceVersion["passages"];
  canCorrect: boolean;
}) {
  const [mentions, setMentions] = useState<MentionPage>({ items: [] }),
    [selected, setSelected] = useState<IdentityBinding>(),
    [label, setLabel] = useState(""),
    [passageId, setPassageId] = useState(passages[0]?.id ?? ""),
    [occurrence, setOccurrence] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(after = "", signal?: AbortSignal) {
    const response = await fetch(
      `/api/sources/${version}/identities${after ? `?after=${after}` : ""}`,
      { ...(signal ? { signal } : {}) },
    );
    if (!response.ok) throw new Error("无法读取身份信息");
    const data = (await response.json()) as MentionPage;
    if (!signal?.aborted)
      setMentions((previous) => ({
        ...data,
        items: after ? [...previous.items, ...data.items] : data.items,
      }));
  }
  useEffect(() => {
    const controller = new AbortController();
    void load("", controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("无法读取身份信息");
    });
    return () => controller.abort();
  }, [version]);
  async function inspect(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/identities/${id}`);
      if (!response.ok) throw new Error("无法读取身份依据");
      setSelected((await response.json()) as IdentityBinding);
    } catch (error) {
      setError(error instanceof Error ? error.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/sources/${version}/identities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, passageId, occurrence: occurrence - 1 }),
      });
      if (!response.ok)
        throw new Error("无法记录，请确认名称出现在所选原文段落且版本仍有效。");
      setSelected((await response.json()) as IdentityBinding);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "记录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="原文中的对象">
      <h2>原文中的对象</h2>
      <p>同名不会自动合并。身份关联需要明确的原文依据。</p>
      {canCorrect && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void record();
          }}
        >
          <label>
            对象名称
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
              maxLength={160}
            />
          </label>
          <label>
            所在段落
            <select
              value={passageId}
              onChange={(event) => setPassageId(event.target.value)}
            >
              {passages.map((passage) => (
                <option key={passage.id} value={passage.id}>
                  {passage.ordinal + 1}：{passage.text.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          <label>
            第几处出现
            <input
              type="number"
              min={1}
              value={occurrence}
              onChange={(event) => setOccurrence(Number(event.target.value))}
            />
          </label>
          <button disabled={busy || !passageId}>记录原文提及</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <ul>
        {mentions.items.map((mention) => (
          <li key={mention.id}>
            <button disabled={busy} onClick={() => void inspect(mention.id)}>
              {mention.text}：查看身份依据
            </button>
            {!mention.valid && " · 当前依据失效"}
          </li>
        ))}
      </ul>
      {mentions.nextCursor && (
        <button
          disabled={busy}
          onClick={() =>
            void load(mentions.nextCursor).catch(() =>
              setError("无法读取下一页"),
            )
          }
        >
          更多对象
        </button>
      )}
      {selected && (
        <section aria-label="身份解释">
          <h3>{selected.mention.text}</h3>
          <p>
            {!selected.valid
              ? "身份关联已失效，等待重验证"
              : selected.outcome === "distinct"
                ? "独立提及（未确认与其他对象相同）"
                : "已由原文确认的身份关联"}{" "}
            · 修订 {selected.revision}
          </p>
          {selected.proofs.map((proof) => (
            <div key={proof.id}>
              <p>
                {proof.kind === "mention"
                  ? "保留此处原文提及，不依据名称合并。"
                  : proof.explanation}
                {!proof.valid && "（此条依据已失效）"}
              </p>
              {proof.sources.map((source, index) => (
                <p key={`${source.version}:${source.passageId}`}>
                  <a href={`/sources/${source.version}#${source.passageId}`}>
                    依据原文 {index + 1}
                  </a>
                </p>
              ))}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
