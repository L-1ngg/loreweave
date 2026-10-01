import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
} from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { getPage, getSourceMetadata } from "../functions/documents";
import { IconButton, errorMessage } from "./ui";

export function PdfViewer({
  versionId,
  page = 1,
  onPage,
}: {
  versionId: string;
  page?: number;
  onPage?: (page: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [loadedPdf, setLoadedPdf] = useState<{
      versionId: string;
      count: number;
    } | null>(null),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [width, setWidth] = useState(600),
    [mode, setMode] = useState<"pdf" | "text">("pdf");
  const { data: source } = useQuery({
    queryKey: ["source", versionId],
    queryFn: () => getSourceMetadata({ data: { versionId } }),
  });
  const { data: text, error: textError } = useQuery({
    queryKey: ["page", versionId, page],
    queryFn: () => getPage({ data: { versionId, page } }),
    enabled: mode === "text",
  });
  const count =
    source?.pageCount ??
    (loadedPdf?.versionId === versionId ? loadedPdf.count : 0);
  const visibleError =
    mode === "pdf" ? error : textError ? errorMessage(textError) : "";
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(180, entries[0].contentRect.width - 24)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (mode !== "pdf") return;
    let live = true;
    let dispose: (() => void) | undefined;
    setError("");
    void (async () => {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      if (!live) return;
      const task = pdfjs.getDocument({
        url: `/api/document-versions/${versionId}/original`,
        withCredentials: true,
      });
      dispose = () => {
        void task.destroy();
      };
      try {
        const pdf = await task.promise;
        if (!live) return;
        setLoadedPdf({ versionId, count: pdf.numPages });
        if (page > pdf.numPages) throw new Error("page_out_of_bounds");
        const source = await pdf.getPage(page);
        const base = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({
          scale: (Math.min(width, 1000) / base.width) * zoom,
        });
        const target = canvas.current;
        if (!target || !live) return;
        const ratio = window.devicePixelRatio || 1;
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        await source.render({
          canvas: target,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        }).promise;
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    })().catch((e) => {
      if (live) setError(errorMessage(e));
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [versionId, page, width, zoom, mode]);
  return (
    <div className="pdf-tool">
      <div className="pdf-toolbar">
        <IconButton
          icon={ChevronLeft}
          label="上一页"
          disabled={page <= 1}
          onClick={() => onPage?.(page - 1)}
        />
        <label className="page-stepper">
          <input
            aria-label="物理页码"
            type="number"
            min={1}
            max={count || undefined}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && (!count || n <= count))
                onPage?.(n);
            }}
          />
          <span>/ {count || "..."}</span>
        </label>
        <IconButton
          icon={ChevronRight}
          label="下一页"
          disabled={!count || page >= count}
          onClick={() => onPage?.(page + 1)}
        />
        <div className="pdf-modes" role="group" aria-label="原文视图">
          <button
            type="button"
            aria-pressed={mode === "pdf"}
            onClick={() => setMode("pdf")}
          >
            PDF
          </button>
          <button
            type="button"
            aria-pressed={mode === "text"}
            onClick={() => setMode("text")}
          >
            文本
          </button>
        </div>
        <IconButton
          icon={ZoomOut}
          label="缩小"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        />
        <IconButton
          icon={ZoomIn}
          label="放大"
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
        />
        <a
          className="icon-button download-link"
          aria-label="下载原文"
          title="下载原文"
          href={`/api/document-versions/${versionId}/original`}
          download
        >
          <Download size={18} />
        </a>
      </div>
      <div className="pdf-surface" ref={container}>
        {visibleError ? (
          <p role="alert" className="error">
            {visibleError}
          </p>
        ) : mode === "pdf" ? (
          <canvas aria-label={`PDF 物理页 ${page}`} ref={canvas} />
        ) : (
          <article className="original-text">
            <small className="muted">
              物理页 {page}
              {text?.page.label && ` · 印刷页码 ${text.page.label}`}
            </small>
            <pre>{text?.page.text ?? "..."}</pre>
          </article>
        )}
      </div>
    </div>
  );
}
