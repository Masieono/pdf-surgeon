import { ensurePdfJsWorkerConfigured, getPdfjsLib } from "./pdfjs-setup.js";

export async function getPdfPageCountFromBytes(bytes) {
  await ensurePdfJsWorkerConfigured();
  const lib = await getPdfjsLib();
  const loadingTask = lib.getDocument({ data: bytes });

  let doc = null;
  try {
    doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    return pageCount;
  } finally {
    if (doc && typeof doc.destroy === "function") {
      await doc.destroy();
    }
  }
}
