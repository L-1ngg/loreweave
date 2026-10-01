import { PDFDocument } from "pdf-lib";
import { hashData } from "../src/server/library";
const source = "tests/fixtures/pdf/no-toc.pdf";
const original = new Uint8Array(await Bun.file(source).arrayBuffer());
const doc = await PDFDocument.load(original, { updateMetadata: false });
doc.removePage(20);
const bytes = await doc.save({ useObjectStreams: false });
await Bun.write("tests/fixtures/pdf/boundary-20.pdf", bytes);
await Bun.write(
  "tests/fixtures/pdf/boundary-manifest.json",
  JSON.stringify(
    {
      revision: "2026-10-01-boundary-v1",
      file: "boundary-20.pdf",
      sha256: hashData(bytes),
      pages: 20,
      origin: {
        file: source,
        sha256: hashData(original),
        transformation:
          "pdf-lib 1.17.1 removePage(20), retain first 20 physical pages; updateMetadata:false",
      },
      license: "Project-generated acceptance original",
    },
    null,
    2,
  ) + "\n",
);
