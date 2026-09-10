import React, { useEffect, useRef, useState } from "react";
import type { SourceOperation } from "../src/sources.ts";
export interface Attachment {
  id: string;
  filename: string;
  key: string;
}
export function SourceImports({
  projectId,
  attachment,
  onAttachment,
  target,
  onActivated,
}: {
  target?: { documentId: string; expectedPrior: string };
  onActivated?: () => void;
  projectId: string;
  attachment: Attachment | undefined;
  onAttachment: (attachment: Attachment | undefined) => void;
}) {
  const activated = useRef(onActivated);
  activated.current = onActivated;
  const notified = useRef(false);
  const [operations, setOperations] = useState<SourceOperation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onAttachment(undefined);
    notified.current = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/imports${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("无法读取导入状态");
        const data = (await response.json()) as {
          operations: SourceOperation[];
        };
        if (!controller.signal.aborted) {
          setOperations(data.operations);
          if (
            target &&
            !notified.current &&
            data.operations.some(
              (item) =>
                item.documentId === target.documentId &&
                item.versionId !== target.expectedPrior &&
                item.source === "searchable",
            )
          ) {
            notified.current = true;
            activated.current?.();
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "状态读取失败");
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void refresh(), 500);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [projectId, target?.documentId, target?.expectedPrior]);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (projectId) form.set("projectId", projectId);
      const response = await fetch("/api/attachments", {
        method: "POST",
        body: form,
      });
      if (!response.ok)
        throw new Error("上传失败：仅支持不超过 1 MiB 的 .md 文件");
      const result = (await response.json()) as {
        id: string;
        filename: string;
      };
      onAttachment({ ...result, key: crypto.randomUUID() });
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }
  async function importNow() {
    if (!attachment) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attachmentId: attachment.id,
          key: attachment.key,
          ...(projectId ? { projectId } : {}),
          ...target,
        }),
      });
      if (response.status === 409)
        throw new Error("文档已变更，请重新打开当前版本后再提交。");
      if (!response.ok)
        throw new Error("导入未确认，请重试；同一请求不会重复导入。");
      const result = (await response.json()) as SourceOperation;
      setOperations((previous) => [
        result,
        ...previous.filter((o) => o.id !== result.id),
      ]);
      onAttachment(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Markdown 来源">
      <h2>{target ? "更新此文档" : "导入 Markdown"}</h2>
      <p>
        {target
          ? "选择新 Markdown 并提交。准备期间继续使用旧版本，准备失败不会替换原文。"
          : "选择文件后，可以直接导入，或在问题中说明“请把附件导入知识库”。图片仅保留链接和说明。"}
      </p>
      <label htmlFor="markdown-file">Markdown 文件</label>
      <input
        id="markdown-file"
        type="file"
        accept=".md,text/markdown"
        disabled={busy}
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {attachment && (
        <p>
          已附加：{attachment.filename}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void importNow()}
          >
            {target ? "提交新版本" : "直接导入"}
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul aria-label="导入记录">
        {operations
          .filter(
            (operation) =>
              !target || operation.documentId === target.documentId,
          )
          .map((operation) => (
            <li key={operation.id} data-testid={`import-${operation.id}`}>
              <span>
                {operation.source === "processing"
                  ? "正在准备"
                  : operation.source === "searchable"
                    ? "来源可检索"
                    : operation.source === "superseded"
                      ? "历史版本"
                      : "导入失败"}
              </span>
              {operation.reason && <span> · {operation.reason}</span>}
              {["searchable", "superseded"].includes(operation.source) && (
                <>
                  {" "}
                  · <a href={`/sources/${operation.versionId}`}>查看原文</a>
                </>
              )}
              {operation.source === "searchable" && (
                <span> · Wiki 与图谱待刷新</span>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}
