import { idbGetFile } from "../../state/idb.js";
import { ensurePdfJsWorkerConfigured, getPdfjsLib } from "./pdfjs-setup.js";

const MAX_DOC_CACHE_SIZE = 3;
const docCache = new Map();

function now() {
  return Date.now();
}

function normalizeBytes(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  throw new Error("Invalid stored PDF bytes");
}

function getLeastRecentlyUsedFileId(excludeFileId) {
  let candidateId = null;
  let oldestTs = Number.POSITIVE_INFINITY;

  for (const [fileId, entry] of docCache.entries()) {
    if (fileId === excludeFileId) {
      continue;
    }
    if (entry.lastUsed < oldestTs) {
      oldestTs = entry.lastUsed;
      candidateId = fileId;
    }
  }

  return candidateId;
}

async function destroyEntry(entry) {
  if (!entry) {
    return;
  }

  if (entry.loadingTask && typeof entry.loadingTask.destroy === "function") {
    await Promise.resolve(entry.loadingTask.destroy());
  }

  if (entry.doc && typeof entry.doc.destroy === "function") {
    await Promise.resolve(entry.doc.destroy());
  }
}

async function evictIfNeeded(excludeFileId) {
  if (docCache.size < MAX_DOC_CACHE_SIZE) {
    return;
  }

  const lruId = getLeastRecentlyUsedFileId(excludeFileId);
  if (!lruId) {
    return;
  }

  await releasePdfDoc(lruId);
}

export async function getPdfBytes(fileId) {
  const record = await idbGetFile(fileId);
  if (!record || !record.bytes) {
    throw new Error(`Missing file bytes for ${fileId}`);
  }

  return normalizeBytes(record.bytes);
}

export async function getPdfDoc(fileId) {
  const existing = docCache.get(fileId);
  if (existing?.doc) {
    existing.lastUsed = now();
    return existing.doc;
  }

  if (existing?.loadPromise) {
    existing.lastUsed = now();
    return existing.loadPromise;
  }

  await evictIfNeeded(fileId);

  const entry = {
    doc: null,
    loadingTask: null,
    loadPromise: null,
    lastUsed: now(),
  };
  docCache.set(fileId, entry);

  entry.loadPromise = (async () => {
    await ensurePdfJsWorkerConfigured();
    const lib = await getPdfjsLib();
    const bytes = await getPdfBytes(fileId);
    const loadingTask = lib.getDocument({ data: bytes });

    entry.loadingTask = loadingTask;

    try {
      const doc = await loadingTask.promise;
      entry.doc = doc;
      entry.loadingTask = null;
      entry.lastUsed = now();
      return doc;
    } catch (error) {
      await destroyEntry(entry);
      docCache.delete(fileId);
      throw error;
    }
  })();

  try {
    return await entry.loadPromise;
  } finally {
    entry.loadPromise = null;
  }
}

export async function releasePdfDoc(fileId) {
  const entry = docCache.get(fileId);
  if (!entry) {
    return;
  }

  docCache.delete(fileId);
  await destroyEntry(entry);
}
