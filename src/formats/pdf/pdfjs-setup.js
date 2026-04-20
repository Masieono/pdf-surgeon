let pdfjsLibPromise = null;
let resolvedWorkerPath = null;

async function probeAssetPath(path) {
  try {
    const headResponse = await fetch(path, { method: "HEAD" });
    if (headResponse.ok) {
      return true;
    }
  } catch {
    // Continue to GET fallback.
  }

  try {
    const getResponse = await fetch(path, { method: "GET" });
    if (getResponse.body && typeof getResponse.body.cancel === "function") {
      void getResponse.body.cancel().catch(() => {});
    }
    return getResponse.ok;
  } catch {
    return false;
  }
}

export async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      if (globalThis.pdfjsLib && typeof globalThis.pdfjsLib.getDocument === "function") {
        return globalThis.pdfjsLib;
      }

      const moduleUrl = new URL("../../../vendor/pdfjs/pdf.mjs", import.meta.url).toString();
      const moduleAssetPath = "./vendor/pdfjs/pdf.mjs";

      if (await probeAssetPath(moduleAssetPath)) {
        try {
          const mod = await import(moduleUrl);
          const lib = mod.pdfjsLib ?? mod.default ?? mod;

          if (!lib || typeof lib.getDocument !== "function") {
            throw new Error("Loaded module does not expose a valid PDF.js API");
          }

          globalThis.pdfjsLib = lib;
          return lib;
        } catch (error) {
          pdfjsLibPromise = null;
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`PDF.js was not found in /vendor/pdfjs. (${detail})`);
        }
      }

      pdfjsLibPromise = null;
      throw new Error("PDF.js was not found in /vendor/pdfjs. (Expected pdf.mjs)");
    })();
  }

  return pdfjsLibPromise;
}

export async function ensurePdfJsWorkerConfigured() {
  if (resolvedWorkerPath) {
    return resolvedWorkerPath;
  }

  const lib = await getPdfjsLib();
  if (!lib.GlobalWorkerOptions) {
    throw new Error("pdfjsLib.GlobalWorkerOptions is unavailable");
  }

  const workerPath = "./vendor/pdfjs/pdf.worker.mjs";
  if (await probeAssetPath(workerPath)) {
    lib.GlobalWorkerOptions.workerSrc = workerPath;
    resolvedWorkerPath = workerPath;
    return resolvedWorkerPath;
  }

  throw new Error("PDF.js worker was not found in /vendor/pdfjs (expected pdf.worker.mjs)");
}
