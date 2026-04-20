import { getPdfDoc } from "./pdfjs-docs.js";

const textIndexCache = new Map();
const TEXT_CACHE_MAX = 10;

function setTextIndexCache(fileId, index) {
  if (textIndexCache.size >= TEXT_CACHE_MAX) {
    const oldestKey = textIndexCache.keys().next().value;
    textIndexCache.delete(oldestKey);
  }
  textIndexCache.set(fileId, index);
}

export function normalizeSearchQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePageText(rawText) {
  return String(rawText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function extractPageText(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  try {
    const textContent = await page.getTextContent();
    const parts = Array.isArray(textContent?.items) ? textContent.items : [];
    const rawText = parts
      .map((item) => (typeof item?.str === "string" ? item.str : ""))
      .join(" ");
    return normalizePageText(rawText);
  } finally {
    if (typeof page.cleanup === "function") {
      page.cleanup();
    }
  }
}

export async function getPdfTextIndex(
  fileId,
  { force = false, onProgress, isCancelled } = {},
) {
  if (typeof fileId !== "string" || fileId.trim() === "") {
    throw new Error("fileId is required for text indexing");
  }

  if (!force && textIndexCache.has(fileId)) {
    return textIndexCache.get(fileId);
  }

  const doc = await getPdfDoc(fileId);
  const total = Number.isFinite(doc?.numPages) ? Math.max(0, doc.numPages) : 0;
  const pageTexts = new Array(total);

  for (let pageOffset = 0; pageOffset < total; pageOffset += 1) {
    if (typeof isCancelled === "function" && isCancelled()) {
      throw new Error("Text indexing cancelled");
    }

    const pageNumber = pageOffset + 1;
    const text = await extractPageText(doc, pageNumber);
    pageTexts[pageOffset] = text;

    if (typeof onProgress === "function") {
      onProgress({
        done: pageNumber,
        total,
        message: `Indexed page ${pageNumber} of ${total}`,
      });
    }
  }

  const hasSearchableText = pageTexts.some((text) => typeof text === "string" && text.length > 0);
  const index = {
    fileId,
    pageCount: total,
    pageTexts,
    hasSearchableText,
    updatedAt: Date.now(),
  };

  setTextIndexCache(fileId, index);
  return index;
}

function countOccurrencesInText(text, normalizedQuery) {
  if (!normalizedQuery || !text) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (start <= text.length - normalizedQuery.length) {
    const foundAt = text.indexOf(normalizedQuery, start);
    if (foundAt === -1) {
      break;
    }
    count += 1;
    start = foundAt + normalizedQuery.length;
  }
  return count;
}

export function findTextMatchStats(textIndex, query) {
  if (!textIndex || !Array.isArray(textIndex.pageTexts)) {
    return {
      pageIndices: [],
      pageCount: 0,
      totalMatches: 0,
    };
  }

  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return {
      pageIndices: [],
      pageCount: 0,
      totalMatches: 0,
    };
  }

  const pageIndices = [];
  let totalMatches = 0;

  for (let pageIndex = 0; pageIndex < textIndex.pageTexts.length; pageIndex += 1) {
    const pageText = textIndex.pageTexts[pageIndex];
    if (typeof pageText !== "string" || pageText.length === 0) {
      continue;
    }

    const matchCount = countOccurrencesInText(pageText, normalizedQuery);
    if (matchCount > 0) {
      pageIndices.push(pageIndex);
      totalMatches += matchCount;
    }
  }

  return {
    pageIndices,
    pageCount: pageIndices.length,
    totalMatches,
  };
}

export function clearPdfTextIndex(fileId) {
  if (typeof fileId !== "string") {
    return;
  }
  textIndexCache.delete(fileId);
}
