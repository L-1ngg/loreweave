import React, { useEffect, useState } from "react";
import type { MaintenanceService } from "../src/maintenance.ts";
type Operation = Awaited<ReturnType<MaintenanceService["inspect"]>>;
const states: Record<string, string> = {
  queued: "等待处理",
  running: "正在处理",
  retry_wait: "等待条件恢复",
  succeeded: "已完成",
  failed: "需要处理",
  outcome_unknown: "结果待核对",
  superseded: "已被新版本取代",
};
export function OperationPage({
  id,
  canReconcile,
}: {
  id: string;
  canReconcile: boolean;
}) {
  const [operation, setOperation] = useState<Operation>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const response = await fetch(`/api/operations/${id}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("无法读取处理记录");
        const result = (await response.json()) as Operation;
        if (!controller.signal.aborted) {
          setOperation(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "读取失败");
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void read(), 1000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, revision]);
  return (
    <main>
      <a href="/">返回提问</a>
      <h1>知识变更处理记录</h1>
      <p>
        来源、Wiki 和图谱独立处理。提问超时或连接中断不代表已受理的变更失败。
      </p>
      {error && <p role="alert">{error}</p>}
      {!operation ? (
        <p>正在读取</p>
      ) : (
        <>
          <ul>
            {operation.jobs.map((job) => (
              <li key={job.id}>
                {job.kind.startsWith("source.")
                  ? "来源"
                  : job.kind.startsWith("wiki.")
                    ? "Wiki"
                    : job.kind.startsWith("graph.")
                      ? "图谱"
                      : "身份关联"}
                ：{states[job.state] ?? job.state}
                {job.state === "failed" && (
                  <p>请检查来源内容或提交修复说明；当前有效原文仍可查阅。</p>
                )}
                {job.receipt && <span> · 已核对提交记录</span>}
                <details>
                  <summary>诊断记录</summary>
                  <pre>{JSON.stringify(job, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          {canReconcile &&
            operation.jobs.some((job) => job.state === "outcome_unknown") && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void fetch(`/api/operations/${id}/reconcile`, {
                    method: "POST",
                  })
                    .then(async (response) => {
                      if (!response.ok)
                        throw new Error("核对未完成，请稍后重试");
                      setRevision((value) => value + 1);
                    })
                    .catch((error) => setError(String(error.message)))
                    .finally(() => setBusy(false));
                }}
              >
                核对已提交结果
              </button>
            )}
        </>
      )}
    </main>
  );
}
