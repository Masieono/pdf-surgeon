import { idbDeleteFile, idbPutFile as defaultIdbPutFile } from "../../state/idb.js";
import { SOFT_WARN_IMPORT_PAGE_COUNT, SOFT_WARN_IMPORT_SIZE_MB } from "../../config.js";
import { generateId } from "../../utils/ids.js";
import { getPdfPageCountFromBytes } from "./pdfjs-count.js";

function toErrorMessage(errorLike) {
  if (errorLike instanceof Error) {
    return errorLike.message || errorLike.toString();
  }
  return String(errorLike ?? "Unknown error");
}

function safeShowToast(showToast, payload) {
  if (typeof showToast !== "function") {
    return;
  }

  try {
    showToast(payload);
  } catch {
    // Ignore toast rendering failures.
  }
}

function normalizeSourceType(sourceType) {
  if (sourceType === "pdf" || sourceType === "image") {
    return sourceType;
  }
  return "pdf";
}

function normalizeBadges(badges) {
  if (!Array.isArray(badges)) {
    return [];
  }
  return badges.filter((badge) => typeof badge === "string" && badge.trim() !== "");
}

function toMegabytes(byteLength) {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return 0;
  }
  return byteLength / (1024 * 1024);
}

export async function importPdfBytes({ bytes, name, sourceType, badges, ctx = {} }) {
  if (!(bytes instanceof ArrayBuffer)) {
    throw new Error("bytes must be an ArrayBuffer");
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("name is required");
  }
  if (typeof ctx.dispatch !== "function") {
    throw new Error("dispatch is required");
  }

  const putFile = typeof ctx.idbPutFile === "function" ? ctx.idbPutFile : defaultIdbPutFile;
  const deleteFile = typeof ctx.idbDeleteFile === "function" ? ctx.idbDeleteFile : idbDeleteFile;
  const fileId = generateId("file");
  const safeName = name.trim();
  const safeSourceType = normalizeSourceType(sourceType);
  const safeBadges = normalizeBadges(badges);
  const importSizeMb = toMegabytes(bytes.byteLength);

  let idbStored = false;
  let recordAdded = false;

  try {
    if (importSizeMb >= SOFT_WARN_IMPORT_SIZE_MB) {
      safeShowToast(ctx.showToast, {
        type: "warning",
        title: "Large file",
        message: `${safeName} is ${importSizeMb.toFixed(1)} MB. Import and previews may be slower.`,
        timeoutMs: 4200,
      });
    }

    await putFile(fileId, {
      bytes,
      mime: "application/pdf",
      originalName: safeName,
    });
    idbStored = true;

    const pageCount = await getPdfPageCountFromBytes(bytes);
    if (pageCount >= SOFT_WARN_IMPORT_PAGE_COUNT) {
      safeShowToast(ctx.showToast, {
        type: "warning",
        title: "Large document",
        message: `${safeName} has ${pageCount} pages. Performance may degrade on very large plans.`,
        timeoutMs: 4200,
      });
    }

    const record = {
      id: fileId,
      name: safeName,
      sourceType: safeSourceType,
      storedAs: "pdf",
      pageCount,
      sizeBytes: bytes.byteLength,
      createdAt: Date.now(),
      originalName: safeName,
      originalExt: "pdf",
      badges: safeBadges,
    };

    ctx.dispatch({
      type: "FILES_ADD_RECORDS",
      payload: { records: [record] },
    });
    recordAdded = true;

    safeShowToast(ctx.showToast, {
      type: "success",
      title: "Imported",
      message: `${safeName} (${pageCount} pages)`,
    });

    return record;
  } catch (error) {
    if (idbStored) {
      try {
        await deleteFile(fileId);
      } catch {
        // Ignore cleanup failures and continue error propagation.
      }
    }

    if (recordAdded) {
      try {
        ctx.dispatch({
          type: "FILES_REMOVE",
          payload: { fileId },
        });
      } catch {
        // Ignore rollback failures and continue error propagation.
      }
    }

    safeShowToast(ctx.showToast, {
      type: "error",
      title: "Import failed",
      message: `${safeName}: ${toErrorMessage(error)}`,
    });

    throw error;
  }
}
