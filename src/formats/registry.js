import { importPdfFile } from "./pdf/import-pdf.js";
import { getImageCaptureTimestampFromBytes, importImageFile, importImageFilesAsPdf } from "./image/import-image.js";

function getFileName(file) {
  return typeof file?.name === "string" ? file.name.toLowerCase() : "";
}

function getFileType(file) {
  return typeof file?.type === "string" ? file.type.toLowerCase() : "";
}

function detectUnsupportedReason(file) {
  const name = getFileName(file);
  const type = getFileType(file);

  if (name.endsWith(".heic") || name.endsWith(".heif") || type === "image/heic" || type === "image/heif") {
    return "HEIC/HEIF is not supported in-browser for deterministic conversion. Convert to PDF/JPG/PNG first.";
  }
  if (name.endsWith(".tif") || name.endsWith(".tiff") || type === "image/tiff") {
    return "TIFF is not supported in this browser-only pipeline. Convert to PDF/JPG/PNG first.";
  }
  return null;
}

function safeShowToast(showToast, payload) {
  if (typeof showToast !== "function") {
    return;
  }
  try {
    showToast(payload);
  } catch {
    // Ignore toast failures.
  }
}

function normalizeImageImportOrder(order) {
  if (order === "filename_asc" || order === "filename_desc" || order === "capture_time_asc") {
    return order;
  }
  return "as_selected";
}

function normalizeImageImportMode(mode) {
  return mode === "combine" ? "combine" : "separate";
}

function shouldSkipDuplicateImages(value) {
  return value === true;
}

function shouldAutoAppendImportedImages(value) {
  return value === true;
}

function toHexString(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = "";
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

async function computeImageFingerprint(file, bytes) {
  if (
    globalThis.crypto &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === "function"
  ) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${toHexString(digest)}`;
  }

  const safeName = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  const safeType = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  const safeSize = Number.isFinite(file?.size) ? file.size : 0;
  const safeLastModified = Number.isFinite(file?.lastModified) ? file.lastModified : 0;
  return `fallback:${safeName}|${safeType}|${safeSize}|${safeLastModified}`;
}

async function dedupeImageFiles(files, bytesCache) {
  const safeFiles = Array.isArray(files) ? files : [];
  if (safeFiles.length <= 1) {
    return {
      files: safeFiles,
      skippedCount: 0,
    };
  }

  const fingerprintSet = new Set();
  const keptFiles = [];
  let skippedCount = 0;

  for (const file of safeFiles) {
    const bytes = await getFileBytes(file, bytesCache);
    const fingerprint = await computeImageFingerprint(file, bytes);
    if (fingerprintSet.has(fingerprint)) {
      skippedCount += 1;
      continue;
    }
    fingerprintSet.add(fingerprint);
    keptFiles.push(file);
  }

  return {
    files: keptFiles,
    skippedCount,
  };
}

async function getFileBytes(file, bytesCache) {
  if (!(file instanceof File)) {
    throw new Error("Invalid file");
  }
  if (bytesCache instanceof WeakMap && bytesCache.has(file)) {
    return bytesCache.get(file);
  }
  const bytes = await file.arrayBuffer();
  if (bytesCache instanceof WeakMap) {
    bytesCache.set(file, bytes);
  }
  return bytes;
}

async function sortImageFilesByOrder(files, order, bytesCache) {
  const safeFiles = Array.isArray(files) ? [...files] : [];
  const mode = normalizeImageImportOrder(order);
  if (mode === "as_selected" || safeFiles.length <= 1) {
    return safeFiles;
  }

  safeFiles.sort((a, b) => {
    const aName = typeof a?.name === "string" ? a.name : "";
    const bName = typeof b?.name === "string" ? b.name : "";
    const diff = aName.localeCompare(bName, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return mode === "filename_desc" ? -diff : diff;
  });
  if (mode !== "capture_time_asc") {
    return safeFiles;
  }

  const entries = await Promise.all(
    safeFiles.map(async (file) => {
      const bytes = await getFileBytes(file, bytesCache);
      const fallbackTimestamp = Number.isFinite(file?.lastModified) ? file.lastModified : null;
      const capturedAt = getImageCaptureTimestampFromBytes({
        bytes,
        mimeType: file?.type,
        fileName: file?.name,
        fallbackTimestamp,
      });
      return {
        file,
        capturedAt: Number.isFinite(capturedAt) ? capturedAt : Number.POSITIVE_INFINITY,
      };
    }),
  );

  entries.sort((a, b) => {
    if (a.capturedAt !== b.capturedAt) {
      return a.capturedAt - b.capturedAt;
    }
    const aName = typeof a.file?.name === "string" ? a.file.name : "";
    const bName = typeof b.file?.name === "string" ? b.file.name : "";
    return aName.localeCompare(bName, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return entries.map((entry) => entry.file);
}

export function detectFormat(file) {
  const name = getFileName(file);
  if (name.endsWith(".pdf")) {
    return "pdf";
  }
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")) {
    return "image";
  }

  const type = getFileType(file);
  if (type === "application/pdf") {
    return "pdf";
  }
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp") {
    return "image";
  }

  return null;
}

export function getImporter(format) {
  if (format === "pdf") {
    return importPdfFile;
  }
  if (format === "image") {
    return importImageFile;
  }

  throw new Error("Unsupported file type.");
}

export async function importFiles(files, ctx) {
  const inputFiles = Array.isArray(files) ? files : [];
  const baseCtx = ctx && typeof ctx === "object" ? ctx : {};
  const unsupported = [];
  const combineImages = normalizeImageImportMode(baseCtx.imageImportMode) === "combine";
  const imageImportOrder = normalizeImageImportOrder(baseCtx.imageImportOrder);
  const skipDuplicateImages = shouldSkipDuplicateImages(baseCtx.skipDuplicateImages);
  const autoAppendImportedImages = shouldAutoAppendImportedImages(baseCtx.autoAppendImportedImages);
  let pendingImageBatch = [];

  const flushPendingImages = async () => {
    if (pendingImageBatch.length === 0) {
      return;
    }
    const bytesCache = new WeakMap();
    const sortedImageFiles = await sortImageFilesByOrder(pendingImageBatch, imageImportOrder, bytesCache);
    pendingImageBatch = [];
    const deduped = skipDuplicateImages
      ? await dedupeImageFiles(sortedImageFiles, bytesCache)
      : { files: sortedImageFiles, skippedCount: 0 };
    const imageFiles = deduped.files;

    if (deduped.skippedCount > 0) {
      safeShowToast(baseCtx.showToast, {
        type: "warning",
        title: "Skipped duplicate images",
        message: `${deduped.skippedCount} duplicate image${deduped.skippedCount === 1 ? "" : "s"} skipped.`,
        timeoutMs: 3200,
      });
    }
    if (imageFiles.length === 0) {
      return;
    }

    if (combineImages && imageFiles.length > 1) {
      await importImageFilesAsPdf(imageFiles, {
        ...baseCtx,
        autoAppendImportedImages,
      });
      return;
    }

    for (const imageFile of imageFiles) {
      await importImageFile(imageFile, {
        ...baseCtx,
        autoAppendImportedImages,
      });
    }
  };

  for (const file of inputFiles) {
    const format = detectFormat(file);
    if (!format) {
      const fileName = typeof file?.name === "string" && file.name ? file.name : "Unknown file";
      unsupported.push({
        name: fileName,
        reason: detectUnsupportedReason(file),
      });
      continue;
    }

    if (format === "image") {
      pendingImageBatch.push(file);
      continue;
    }

    await flushPendingImages();
    const importer = getImporter(format);
    await importer(file, baseCtx);
  }

  await flushPendingImages();

  if (unsupported.length > 0) {
    const unsupportedNames = unsupported.map((item) => item.name);
    const previewList = unsupportedNames.slice(0, 3).join(", ");
    const suffix =
      unsupportedNames.length > 3 ? `, +${unsupportedNames.length - 3} more` : "";
    const firstReason = unsupported.find((item) => typeof item.reason === "string" && item.reason)?.reason ?? null;
    safeShowToast(baseCtx.showToast, {
      type: "warning",
      title: "Unsupported files",
      message: firstReason
        ? `Ignored: ${previewList}${suffix}. ${firstReason}`
        : `Ignored unsupported files: ${previewList}${suffix}. Supported: PDF, PNG, JPG, JPEG, WEBP.`,
      timeoutMs: 4200,
    });
  }
}
