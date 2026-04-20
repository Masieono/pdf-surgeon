import { importPdfBytes } from "./import-pdf-bytes.js";

export async function importPdfFile(file, ctx = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Invalid file input");
  }
  const bytes = await file.arrayBuffer();
  return importPdfBytes({
    bytes,
    name: file.name,
    sourceType: "pdf",
    badges: [],
    ctx,
  });
}

export default importPdfFile;
