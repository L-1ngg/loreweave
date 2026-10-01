import { z } from "zod";
export const indexMode = z.enum(["flash", "standard"]);
export type IndexMode = z.infer<typeof indexMode>;
export type WorkStatus =
  "queued" | "processing" | "ready" | "failed" | "unsupported" | "interrupted";
export const pageInput = z
  .object({ versionId: z.string().uuid(), page: z.number().int().min(1) })
  .strict();
export const libraryInput = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    filter: z.string().max(200).optional(),
  })
  .strict();
export type PdfItem = {
  text: string;
  font: string;
  height: number;
  width: number;
  x: number;
  y: number;
  transform: number[];
  hasEOL: boolean;
};
export type PdfLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  margin: boolean;
};
export type PdfPage = {
  number: number;
  label: string | null;
  text: string;
  navigationText: string;
  width: number;
  height: number;
  rotation: number;
  columns: number;
  items: PdfItem[];
  lines: PdfLine[];
};
export type PdfOutline = {
  title: string;
  page: number | null;
  depth: number;
  verified: boolean;
};
export type Extraction = {
  extractorRevision: string;
  pageCount: number;
  pages: PdfPage[];
  outlines: PdfOutline[];
  title: string | null;
  diagnostics: string[];
};
export type TreeNode = {
  id: string;
  title: string;
  start: number;
  end: number;
  depth: number;
  parentId: string | null;
  summary?: string;
  mergedTitles: string[];
  origin: "layout" | "outline" | "model" | "coverage";
  anchor?: string;
};
