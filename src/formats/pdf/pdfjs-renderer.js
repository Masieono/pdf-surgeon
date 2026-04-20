import { THUMB_CACHE_MAX_ITEMS } from "../../config.js";
import { idbDeleteThumbsByFile, idbGetThumb, idbPutThumb } from "../../state/idb.js";
import { getPdfDoc } from "./pdfjs-docs.js";

const canvasRenderRecords = new WeakMap();
const thumbCache = new Map();
const persistentThumbReadPromises = new Map();
const persistentThumbWritePromises = new Map();

function toCanvasSize(value) {
  return Math.max(1, Math.ceil(Number(value) || 0));
}

function ensureCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new Error("A canvas element is required");
  }
}

function setCanvasSize(canvas, width, height) {
  canvas.width = toCanvasSize(width);
  canvas.height = toCanvasSize(height);
}

function createTempCanvas(width, height) {
  const tempCanvas = document.createElement("canvas");
  setCanvasSize(tempCanvas, width, height);
  return tempCanvas;
}

function normalizeThumbCacheWidth(value) {
  const width = toCanvasSize(value);
  if (width <= 96) {
    return 96;
  }
  if (width <= 128) {
    return 128;
  }
  if (width <= 160) {
    return 160;
  }
  if (width <= 220) {
    return 220;
  }
  return width;
}

function getThumbCacheKey(fileId, pageIndex, thumbWidthPx, rotation) {
  return `${fileId}:${pageIndex}:${thumbWidthPx}:${rotation || 0}`;
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode cached thumbnail"));
    img.src = dataUrl;
  });
}

async function loadEntryImage(entry) {
  if (!entry || typeof entry.dataUrl !== "string" || !entry.dataUrl) {
    throw new Error("Invalid data URL thumbnail cache entry");
  }
  if (entry.image instanceof HTMLImageElement) {
    return entry.image;
  }
  if (!entry.imagePromise) {
    entry.imagePromise = loadDataUrlImage(entry.dataUrl)
      .then((image) => {
        entry.image = image;
        return image;
      })
      .catch((error) => {
        entry.imagePromise = null;
        throw error;
      });
  }
  return entry.imagePromise;
}

function drawToTargetCanvas(targetCanvas, source, width, height) {
  setCanvasSize(targetCanvas, width, height);
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire 2D context");
  }
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.drawImage(source, 0, 0, targetCanvas.width, targetCanvas.height);
  ctx.restore();
}

function drawLoadingPlaceholder(canvas, width, height) {
  setCanvasSize(canvas, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const rootElement = typeof document !== "undefined" ? document.documentElement : null;
  const theme = rootElement?.getAttribute("data-theme") || "";
  const isDark = theme === "dark";

  // Static skeleton pass (no animation) to avoid extra CPU churn.
  const base = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const highlight = isDark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.72)";
  const pageBg = isDark ? "#1b1d23" : "#ffffff";

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = pageBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, base);
  gradient.addColorStop(0.5, highlight);
  gradient.addColorStop(1, base);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const lineCount = Math.max(3, Math.min(9, Math.floor(canvas.height / 28)));
  const lineInset = Math.max(8, Math.round(canvas.width * 0.08));
  const lineHeight = Math.max(4, Math.round(canvas.height / 42));
  const lineGap = Math.max(6, Math.round(lineHeight * 1.45));
  let lineY = Math.max(10, Math.round(canvas.height * 0.12));
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  for (let i = 0; i < lineCount; i += 1) {
    const widthFactor = i % 3 === 2 ? 0.7 : 0.88;
    const lineWidth = Math.max(24, Math.round((canvas.width - lineInset * 2) * widthFactor));
    ctx.fillRect(lineInset, lineY, lineWidth, lineHeight);
    lineY += lineHeight + lineGap;
    if (lineY + lineHeight > canvas.height - 8) {
      break;
    }
  }
  ctx.restore();
}

function touchThumbCache(key, value) {
  if (thumbCache.has(key)) {
    thumbCache.delete(key);
  }
  thumbCache.set(key, value);

  while (thumbCache.size > THUMB_CACHE_MAX_ITEMS) {
    const oldestKey = thumbCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    thumbCache.delete(oldestKey);
  }
}

function getThumbFromCache(key) {
  const cached = thumbCache.get(key);
  if (!cached) {
    return null;
  }
  thumbCache.delete(key);
  thumbCache.set(key, cached);
  return cached;
}

async function getThumbFromPersistentCache(cacheKey) {
  if (persistentThumbReadPromises.has(cacheKey)) {
    return persistentThumbReadPromises.get(cacheKey);
  }

  const readPromise = (async () => {
    try {
      const record = await idbGetThumb(cacheKey);
      if (!record || typeof record.dataUrl !== "string" || !record.dataUrl) {
        return null;
      }
      const width = toCanvasSize(record.width);
      const height = toCanvasSize(record.height);
      return {
        dataUrl: record.dataUrl,
        width,
        height,
      };
    } catch {
      return null;
    } finally {
      persistentThumbReadPromises.delete(cacheKey);
    }
  })();

  persistentThumbReadPromises.set(cacheKey, readPromise);
  return readPromise;
}

function persistThumbToIndexedDb({
  cacheKey,
  fileId,
  pageIndex,
  rotation,
  thumbWidthPx,
  width,
  height,
  dataUrl,
}) {
  if (!cacheKey || typeof dataUrl !== "string" || !dataUrl) {
    return;
  }
  if (persistentThumbWritePromises.has(cacheKey)) {
    return;
  }

  const writePromise = (async () => {
    try {
      await idbPutThumb({
        cacheKey,
        fileId,
        pageIndex,
        rotation,
        thumbWidthPx,
        width,
        height,
        dataUrl,
      });
    } catch {
      // Ignore cache write failures.
    } finally {
      persistentThumbWritePromises.delete(cacheKey);
    }
  })();

  persistentThumbWritePromises.set(cacheKey, writePromise);
}

function isRenderCancelledError(error) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (("name" in error && error.name === "RenderingCancelledException") ||
      ("message" in error && String(error.message || "").includes("cancelled")))
  );
}

function beginCanvasRender(canvas) {
  const previous = canvasRenderRecords.get(canvas);
  if (previous?.task && typeof previous.task.cancel === "function") {
    try {
      previous.task.cancel();
    } catch {
      // Ignore cancellation errors.
    }
  }

  const record = {
    token: Symbol("render"),
    task: null,
  };

  canvasRenderRecords.set(canvas, record);
  return record;
}

function isLatestRender(canvas, record) {
  return canvasRenderRecords.get(canvas) === record;
}

function attachRenderTask(canvas, record, renderTask) {
  if (!isLatestRender(canvas, record)) {
    if (renderTask && typeof renderTask.cancel === "function") {
      try {
        renderTask.cancel();
      } catch {
        // Ignore cancellation errors.
      }
    }
    return false;
  }

  record.task = renderTask;
  return true;
}

function clearRenderTask(canvas, record) {
  if (!isLatestRender(canvas, record)) {
    return;
  }
  record.task = null;
}

async function runRenderTask({ renderTask, canvas, record }) {
  if (!attachRenderTask(canvas, record, renderTask)) {
    return false;
  }

  try {
    await renderTask.promise;
  } catch (error) {
    if (!isRenderCancelledError(error)) {
      throw error;
    }
    return false;
  } finally {
    clearRenderTask(canvas, record);
  }

  return isLatestRender(canvas, record);
}

function finishCanvasRender(canvas, record) {
  if (!isLatestRender(canvas, record)) {
    return;
  }
  record.task = null;
}

export async function renderThumbnailToCanvas({
  fileId,
  pageIndex,
  thumbWidthPx,
  rotation = 0,
  canvas,
}) {
  ensureCanvas(canvas);
  const record = beginCanvasRender(canvas);
  const normalizedThumbWidth = normalizeThumbCacheWidth(thumbWidthPx);
  const cacheKey = getThumbCacheKey(fileId, pageIndex, normalizedThumbWidth, rotation);
  const cached = getThumbFromCache(cacheKey);

  if (cached) {
    const img = await loadEntryImage(cached);
    if (!isLatestRender(canvas, record)) {
      return false;
    }
    drawToTargetCanvas(canvas, img, cached.width, cached.height);
    finishCanvasRender(canvas, record);
    return true;
  }

  const persistentCached = await getThumbFromPersistentCache(cacheKey);
  if (persistentCached) {
    touchThumbCache(cacheKey, persistentCached);
    if (isLatestRender(canvas, record)) {
      drawLoadingPlaceholder(canvas, persistentCached.width, persistentCached.height);
    }
    const img = await loadEntryImage(persistentCached);
    if (!isLatestRender(canvas, record)) {
      return false;
    }
    drawToTargetCanvas(canvas, img, persistentCached.width, persistentCached.height);
    finishCanvasRender(canvas, record);
    return true;
  }

  const doc = await getPdfDoc(fileId);
  const page = await doc.getPage(pageIndex + 1);

  try {
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const safeThumbWidth = normalizedThumbWidth;
    const scale = safeThumbWidth / baseViewport.width;
    const viewport = page.getViewport({ scale, rotation });
    const width = toCanvasSize(viewport.width);
    const height = toCanvasSize(viewport.height);
    if (isLatestRender(canvas, record)) {
      drawLoadingPlaceholder(canvas, width, height);
    }

    const tempCanvas = createTempCanvas(width, height);
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to acquire 2D context");
    }

    const renderTask = page.render({ canvasContext: ctx, viewport });
    const renderCompleted = await runRenderTask({ renderTask, canvas, record });
    if (!renderCompleted) {
      return false;
    }

    const dataUrl = tempCanvas.toDataURL("image/jpeg", 0.8);
    touchThumbCache(cacheKey, { dataUrl, width, height });
    persistThumbToIndexedDb({
      cacheKey,
      fileId,
      pageIndex,
      rotation,
      thumbWidthPx: normalizedThumbWidth,
      width,
      height,
      dataUrl,
    });
    drawToTargetCanvas(canvas, tempCanvas, width, height);
    finishCanvasRender(canvas, record);
    return true;
  } finally {
    if (typeof page.cleanup === "function") {
      page.cleanup();
    }
  }
}

export function clearThumbCacheForFile(fileId, options = {}) {
  const includePersistent = options?.includePersistent !== false;
  const prefix = typeof fileId === "string" && fileId ? `${fileId}:` : "";
  if (!prefix) {
    return;
  }
  for (const [cacheKey] of thumbCache.entries()) {
    if (!cacheKey.startsWith(prefix)) {
      continue;
    }
    thumbCache.delete(cacheKey);
  }
  if (includePersistent) {
    void idbDeleteThumbsByFile(fileId);
  }
}
