import {
  DEFAULT_IMAGE_IMPORT_AUTO_APPEND,
  DEFAULT_IMAGE_IMPORT_MODE,
  DEFAULT_IMAGE_IMPORT_ORDER,
  DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES,
  DEFAULT_WATERMARK,
  LS_THEME_PREF_KEY,
  SOFT_WARN_OUTPUT_PAGE_COUNT,
} from "../../config.js";
import {
  normalizeWatermarkImageFit,
  normalizeWatermarkMode,
  normalizeWatermarkPosition,
  normalizeWatermarkSizeMode,
  normalizeWatermarkTarget,
} from "../../state/store-helpers.js";
import { parsePageRanges } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  clampWatermarkOrigin,
  getRotatedBoundsForRect,
  getWatermarkMargin,
  getWatermarkPlacement,
  rotatePoint,
} from "../../utils/watermark-geometry.js";
import { generateId } from "../../utils/ids.js";
import { clamp } from "../../utils/math.js";

export function normalizeThemePreference(theme) {
  if (theme === "dark" || theme === "light" || theme === "system") {
    return theme;
  }
  return "system";
}

export function normalizeResolvedTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

export function resolveTheme(themePreference) {
  const pref = normalizeThemePreference(themePreference);
  return pref === "system" ? getSystemTheme() : pref;
}

export function getSystemTheme() {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function readThemePreference() {
  try {
    const stored = localStorage.getItem(LS_THEME_PREF_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Ignore storage access failures.
  }
  return "system";
}

export function writeThemePreference(themePreference) {
  try {
    localStorage.setItem(LS_THEME_PREF_KEY, normalizeThemePreference(themePreference));
  } catch {
    // Ignore storage access failures.
  }
}

export function applyTheme(themePreference) {
  const nextPreference = normalizeThemePreference(themePreference);
  const effectiveTheme = normalizeResolvedTheme(resolveTheme(nextPreference));
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  document.documentElement.setAttribute("data-theme-pref", nextPreference);
  return {
    themePreference: nextPreference,
    effectiveTheme,
  };
}

export function cycleThemePreference(currentPreference) {
  const normalized = normalizeThemePreference(currentPreference);
  if (normalized === "system") {
    return "light";
  }
  if (normalized === "light") {
    return "dark";
  }
  return "system";
}

export function getThemeButtonLabel(themePreference, effectiveTheme) {
  const pref = normalizeThemePreference(themePreference);
  const resolved = normalizeResolvedTheme(effectiveTheme);
  if (pref === "system") {
    return `Theme: System (${resolved === "dark" ? "Dark" : "Light"})`;
  }
  return `Theme: ${pref === "dark" ? "Dark" : "Light"}`;
}

export function updateThemeButtonLabel(appRoot) {
  const button = appRoot?.querySelector?.('[data-ui-action="toggle-theme"]');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const labelEl = button.querySelector(".btn-label");
  const pref = normalizeThemePreference(
    readThemePreference() || document.documentElement.getAttribute("data-theme-pref") || "system",
  );
  const effectiveTheme = normalizeResolvedTheme(
    document.documentElement.getAttribute("data-theme") || getSystemTheme(),
  );
  const label = getThemeButtonLabel(pref, effectiveTheme);
  if (labelEl) {
    labelEl.textContent = label;
    return;
  }
  button.textContent = label;
}

export function toFileArray(fileListLike) {
  if (!fileListLike) {
    return [];
  }
  return Array.from(fileListLike).filter((file) => file instanceof File);
}

export function getFileDisplayName(state, fileId) {
  const files = Array.isArray(state?.files) ? state.files : [];
  const match = files.find((file) => file?.id === fileId);
  return match?.name || match?.originalName || "this file";
}

export { clamp };

export function getSelectedFile(state) {
  const files = Array.isArray(state?.files) ? state.files : [];
  const selectedFileId = state?.ui?.selectedFileId;
  return files.find((file) => file?.id === selectedFileId) ?? null;
}

export function getFileById(state, fileId) {
  const files = Array.isArray(state?.files) ? state.files : [];
  return files.find((file) => file?.id === fileId) ?? null;
}

export function getMaxPageIndex(file) {
  if (Number.isFinite(file?.pageCount) && file.pageCount > 0) {
    return file.pageCount - 1;
  }
  return 0;
}

export function getThumbWidth(canvas) {
  const tile = canvas.closest(".thumb-tile");
  const isInline = tile instanceof HTMLElement && tile.classList.contains("thumb-tile-inline");
  const rawWidth = tile instanceof HTMLElement
    ? isInline
      ? tile.clientWidth - 12
      : tile.clientWidth - 16
    : 220;
  const minWidth = isInline ? 64 : 120;
  return clamp(Number.isFinite(rawWidth) ? Math.floor(rawWidth) : 220, minWidth, 220);
}

export function getTimelineThumbWidth(canvas) {
  const host = canvas.closest(".timeline-thumb");
  const rawWidth = host instanceof HTMLElement ? host.clientWidth : 84;
  return clamp(Number.isFinite(rawWidth) ? Math.floor(rawWidth) : 84, 64, 140);
}

export function sampleCanvasDarkPixelCount(canvas) {
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  const sampleCols = 4;
  const sampleRows = 4;
  let darkPixels = 0;
  let sampledPixels = 0;

  for (let row = 0; row < sampleRows; row += 1) {
    for (let col = 0; col < sampleCols; col += 1) {
      const x = Math.min(canvas.width - 1, Math.floor((col / (sampleCols - 1)) * (canvas.width - 1)));
      const y = Math.min(canvas.height - 1, Math.floor((row / (sampleRows - 1)) * (canvas.height - 1)));
      try {
        const data = ctx.getImageData(x, y, 1, 1).data;
        sampledPixels += 1;
        const r = data[0];
        const g = data[1];
        const b = data[2];
        const a = data[3];
        if (a > 8 && (r < 245 || g < 245 || b < 245)) {
          darkPixels += 1;
        }
      } catch {
        return null;
      }
    }
  }

  return { darkPixels, sampledPixels };
}

export function parseNonNegativeInt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function normalizeOutputSelection(indices, planLength) {
  if (!Array.isArray(indices)) {
    return [];
  }

  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < planLength),
    ),
  ).sort((a, b) => a - b);
}

export function isSamePageRef(a, b) {
  if (!a || !b) {
    return false;
  }
  return (
    a.fileId === b.fileId &&
    a.pageIndex === b.pageIndex &&
    (a.rotation ?? 0) === (b.rotation ?? 0) &&
    Boolean(a.locked) === Boolean(b.locked)
  );
}

export function isSameDocPlanOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!isSamePageRef(a[index], b[index])) {
      return false;
    }
  }
  return true;
}

export function normalizeSourcePageSelection(indices, pageCount) {
  if (!Array.isArray(indices)) {
    return [];
  }

  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount),
    ),
  ).sort((a, b) => a - b);
}

export function getUnlockedOutputIndices(state, indices) {
  const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
  const safeIndices = normalizeOutputSelection(indices, docPlan.length);
  return safeIndices.filter((index) => docPlan[index]?.locked !== true);
}

export function isOutputIndexLocked(state, index) {
  const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
  if (!Number.isInteger(index) || index < 0 || index >= docPlan.length) {
    return false;
  }
  return docPlan[index]?.locked === true;
}

export function normalizeOutputFindMode(mode) {
  return mode === "source_page" ? "source_page" : "output_position";
}

export { normalizeWatermarkImageFit, normalizeWatermarkMode, normalizeWatermarkPosition, normalizeWatermarkSizeMode, normalizeWatermarkTarget };

export function defaultRotationForWatermarkPosition(position) {
  return position === "diagonal_center" ? 45 : 0;
}

export function normalizeWatermarkFontSizePct(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return clamp(numeric, 4, 40);
  }
  return DEFAULT_WATERMARK.fontSizePct;
}

export function sanitizeWatermarkImageDataUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^data:image\/(png|jpeg|jpg);base64,/i.test(trimmed) ? trimmed : "";
}

export function safeParseWatermarkRange(rangeInput, maxPages) {
  if (!Number.isInteger(maxPages) || maxPages < 0) {
    return null;
  }
  if (typeof rangeInput !== "string" || rangeInput.trim() === "") {
    return new Set();
  }

  try {
    return new Set(parsePageRanges(rangeInput, maxPages));
  } catch {
    return null;
  }
}

export function normalizeWatermarkState(rawWatermark, outputPageCount = 0) {
  const safe = rawWatermark && typeof rawWatermark === "object" ? rawWatermark : {};
  const mode = normalizeWatermarkMode(safe.mode);
  const text = typeof safe.text === "string" ? safe.text.trim() : "";
  const rangeInput = typeof safe.rangeInput === "string" ? safe.rangeInput.trim() : "";
  const imageDataUrl = sanitizeWatermarkImageDataUrl(safe.imageDataUrl);
  const imageName = typeof safe.imageName === "string" ? safe.imageName.trim().slice(0, 180) : "";
  const position = normalizeWatermarkPosition(safe.position ?? DEFAULT_WATERMARK.position);
  const target = normalizeWatermarkTarget(safe.target);
  const rotationRaw = Number(safe.rotationDeg);
  const sizeMode = normalizeWatermarkSizeMode(safe.sizeMode);
  const imageFit = normalizeWatermarkImageFit(safe.imageFit);
  const opacityRaw = Number(safe.opacity);
  const fontSizeRaw = Number(safe.fontSizePct);
  const rangeSet = target === "range_output_pages" ? safeParseWatermarkRange(rangeInput, outputPageCount) : null;
  const enabled = mode === "image" ? imageDataUrl.length > 0 : text.length > 0;

  return {
    enabled,
    mode,
    text,
    target,
    rangeInput,
    rangeSet,
    position,
    opacity: Number.isFinite(opacityRaw) ? clamp(opacityRaw, 0.05, 1) : DEFAULT_WATERMARK.opacity,
    rotationDeg: Number.isFinite(rotationRaw)
      ? clamp(rotationRaw, -180, 180)
      : defaultRotationForWatermarkPosition(position),
    sizeMode,
    fontSizePct: normalizeWatermarkFontSizePct(fontSizeRaw),
    imageDataUrl,
    imageName,
    imageFit,
  };
}

export function shouldApplyWatermarkToOutputIndex(
  watermark,
  outputIndex,
  selectedOutputIndices,
  outputPageCount,
) {
  if (!watermark || !watermark.enabled || !Number.isInteger(outputIndex) || outputIndex < 0) {
    return false;
  }

  if (watermark.target === "all_output_pages") {
    return true;
  }
  if (watermark.target === "odd_output_pages") {
    return (outputIndex + 1) % 2 === 1;
  }
  if (watermark.target === "even_output_pages") {
    return (outputIndex + 1) % 2 === 0;
  }
  if (watermark.target === "selected_output_pages") {
    return selectedOutputIndices.includes(outputIndex);
  }
  if (watermark.target === "range_output_pages") {
    const parsed = watermark.rangeSet instanceof Set
      ? watermark.rangeSet
      : safeParseWatermarkRange(watermark.rangeInput, outputPageCount);
    if (!(parsed instanceof Set)) {
      return false;
    }
    return parsed.has(outputIndex);
  }
  return false;
}

export { clampWatermarkOrigin, getRotatedBoundsForRect, getWatermarkPlacement, rotatePoint };

export function getCanvasTextBoxMetrics(ctx, text, fontSizePx) {
  ctx.save();
  ctx.font = `600 ${fontSizePx}px sans-serif`;
  const metrics = ctx.measureText(text);
  ctx.restore();

  const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(metrics.actualBoundingBoxRight)
    ? metrics.actualBoundingBoxRight
    : Math.max(0.0001, metrics.width);
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : Math.max(0.0001, fontSizePx * 0.8);
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : Math.max(0.0001, fontSizePx * 0.2);

  return {
    minX: -left,
    maxX: right,
    minY: -descent,
    maxY: ascent,
  };
}

export function getMaxFitFontSizePxForCanvas({ ctx, text, rotationDeg, pageWidth, pageHeight }) {
  const margin = getWatermarkMargin(pageWidth, pageHeight);
  const textBoxAt1 = getCanvasTextBoxMetrics(ctx, text, 1);
  const boundsAt1 = getRotatedBoundsForRect({ ...textBoxAt1, rotationDeg });
  const spanX = Math.max(0.0001, boundsAt1.maxX - boundsAt1.minX);
  const spanY = Math.max(0.0001, boundsAt1.maxY - boundsAt1.minY);
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  return clamp(scale, 8, Math.max(pageWidth, pageHeight) * 0.8);
}

export function getImageScaleForCanvas({ imageWidth, imageHeight, rotationDeg, pageWidth, pageHeight, fitMode }) {
  const margin = getWatermarkMargin(pageWidth, pageHeight);
  const boundsAt1 = getRotatedBoundsForRect({
    minX: 0,
    maxX: imageWidth,
    minY: 0,
    maxY: imageHeight,
    rotationDeg,
  });
  const spanX = Math.max(0.0001, boundsAt1.maxX - boundsAt1.minX);
  const spanY = Math.max(0.0001, boundsAt1.maxY - boundsAt1.minY);
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);
  const containScale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const coverScale = Math.max(availableWidth / spanX, availableHeight / spanY);
  const scale = fitMode === "cover" ? coverScale : containScale;
  return clamp(scale, 0.01, 1000);
}

export function drawWatermarkTextOnCanvas(canvas, watermark, { drawBackground = false } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  if (
    !watermark ||
    watermark.mode !== "text" ||
    typeof watermark.text !== "string" ||
    watermark.text.trim() === ""
  ) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const safeOpacity = Number.isFinite(watermark.opacity)
    ? clamp(watermark.opacity, 0.05, 1)
    : DEFAULT_WATERMARK.opacity;
  const safeRotation = Number.isFinite(watermark.rotationDeg)
    ? clamp(watermark.rotationDeg, -180, 180)
    : defaultRotationForWatermarkPosition(watermark.position);
  const safeSizeMode = normalizeWatermarkSizeMode(watermark.sizeMode);
  const safeFontSizePct = normalizeWatermarkFontSizePct(watermark.fontSizePct);
  const safePosition = normalizeWatermarkPosition(watermark.position);
  const text = watermark.text.trim();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (drawBackground) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  const minEdge = Math.max(1, Math.min(canvas.width, canvas.height));
  const manualFontSize = clamp(minEdge * (safeFontSizePct / 100), 8, 64);
  const fontSize =
    safeSizeMode === "max_fit"
      ? getMaxFitFontSizePxForCanvas({
          ctx,
          text,
          rotationDeg: safeRotation,
          pageWidth: canvas.width,
          pageHeight: canvas.height,
        })
      : manualFontSize;

  const drawText = text;
  const textBox = getCanvasTextBoxMetrics(ctx, drawText, fontSize);
  ctx.font = `600 ${fontSize}px sans-serif`;
  const { x, y } = getWatermarkPlacement({
    pageWidth: canvas.width,
    pageHeight: canvas.height,
    box: textBox,
    position: safePosition,
    rotationDeg: safeRotation,
  });
  const canvasX = x;
  const canvasY = canvas.height - y;

  ctx.translate(canvasX, canvasY);
  ctx.rotate((-safeRotation * Math.PI) / 180);
  ctx.globalAlpha = safeOpacity;
  ctx.fillStyle = "rgba(76, 76, 76, 1)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(drawText, 0, 0);
  ctx.restore();
}

const watermarkImageLoadCache = new Map();

export function loadWatermarkImage(dataUrl) {
  if (watermarkImageLoadCache.has(dataUrl)) {
    return watermarkImageLoadCache.get(dataUrl);
  }

  const promise = new Promise((resolve, reject) => {
    if (typeof Image !== "function") {
      reject(new Error("Image watermark preview requires browser image support"));
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Invalid watermark image"));
    image.src = dataUrl;
  }).catch((error) => {
    watermarkImageLoadCache.delete(dataUrl);
    throw error;
  });

  watermarkImageLoadCache.set(dataUrl, promise);
  return promise;
}

async function drawWatermarkImageOnCanvas(canvas, watermark, { drawBackground = false } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  if (!watermark || watermark.mode !== "image" || typeof watermark.imageDataUrl !== "string") {
    return;
  }

  const imageDataUrl = sanitizeWatermarkImageDataUrl(watermark.imageDataUrl);
  if (!imageDataUrl) {
    return;
  }

  const image = await loadWatermarkImage(imageDataUrl);
  const imageWidth = Number(image.naturalWidth || image.width);
  const imageHeight = Number(image.naturalHeight || image.height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Invalid watermark image dimensions");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const safeOpacity = Number.isFinite(watermark.opacity)
    ? clamp(watermark.opacity, 0.05, 1)
    : DEFAULT_WATERMARK.opacity;
  const safeRotation = Number.isFinite(watermark.rotationDeg)
    ? clamp(watermark.rotationDeg, -180, 180)
    : defaultRotationForWatermarkPosition(watermark.position);
  const safePosition = normalizeWatermarkPosition(watermark.position);
  const safeImageFit = normalizeWatermarkImageFit(watermark.imageFit);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (drawBackground) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  const scale = getImageScaleForCanvas({
    imageWidth,
    imageHeight,
    rotationDeg: safeRotation,
    pageWidth: canvas.width,
    pageHeight: canvas.height,
    fitMode: safeImageFit,
  });
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const box = {
    minX: 0,
    maxX: drawWidth,
    minY: 0,
    maxY: drawHeight,
  };
  const { x, y } = getWatermarkPlacement({
    pageWidth: canvas.width,
    pageHeight: canvas.height,
    box,
    position: safePosition,
    rotationDeg: safeRotation,
  });

  ctx.translate(x, canvas.height - y);
  ctx.rotate((-safeRotation * Math.PI) / 180);
  ctx.globalAlpha = safeOpacity;
  ctx.drawImage(image, 0, -drawHeight, drawWidth, drawHeight);
  ctx.restore();
}

export async function drawWatermarkOnCanvas(canvas, watermark, options = {}) {
  if (!watermark || !watermark.enabled) {
    return;
  }
  if (watermark.mode === "image") {
    await drawWatermarkImageOnCanvas(canvas, watermark, options);
    return;
  }
  drawWatermarkTextOnCanvas(canvas, watermark, options);
}

export function parsePositivePageToken(raw, token) {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid page token "${token}"`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid page number "${raw}"`);
  }
  return parsed;
}

export function parseLookupPageRanges(input, maxPages) {
  if (!Number.isInteger(maxPages) || maxPages < 0) {
    throw new Error("Invalid page range scope");
  }

  const compact = String(input ?? "").replace(/\s+/g, "").trim();
  if (!compact) {
    return { indices: [], overflowMaxPage: null };
  }

  if (maxPages === 0) {
    return { indices: [], overflowMaxPage: null };
  }

  const output = new Set();
  let overflowMaxPage = null;
  const tokens = compact.split(",");

  for (const token of tokens) {
    if (!token) {
      throw new Error("Invalid page range token: empty segment");
    }

    if (token.includes("-")) {
      const match = token.match(/^(\d+)?-(\d+)?$/);
      if (!match) {
        throw new Error(`Invalid page range token "${token}"`);
      }

      const startRaw = match[1];
      const endRaw = match[2];
      if (!startRaw && !endRaw) {
        throw new Error(`Invalid page range token "${token}"`);
      }

      const startPage = startRaw ? parsePositivePageToken(startRaw, token) : 1;
      const endPage = endRaw ? parsePositivePageToken(endRaw, token) : maxPages;
      if (startPage > endPage) {
        throw new Error(`Invalid page range "${token}": start is greater than end`);
      }

      if (endPage > maxPages) {
        overflowMaxPage = overflowMaxPage == null ? endPage : Math.max(overflowMaxPage, endPage);
      }

      if (startPage > maxPages) {
        continue;
      }

      const safeEnd = Math.min(endPage, maxPages);
      for (let page = startPage; page <= safeEnd; page += 1) {
        output.add(page - 1);
      }
      continue;
    }

    const page = parsePositivePageToken(token, token);
    if (page > maxPages) {
      overflowMaxPage = overflowMaxPage == null ? page : Math.max(overflowMaxPage, page);
      continue;
    }
    output.add(page - 1);
  }

  return {
    indices: Array.from(output).sort((a, b) => a - b),
    overflowMaxPage,
  };
}

export function getMaxSourcePageNumber(docPlan) {
  const safePlan = Array.isArray(docPlan) ? docPlan : [];
  let maxPage = 0;
  for (const pageRef of safePlan) {
    const pageIndex = Number.parseInt(String(pageRef?.pageIndex ?? ""), 10);
    if (Number.isInteger(pageIndex) && pageIndex >= 0) {
      maxPage = Math.max(maxPage, pageIndex + 1);
    }
  }
  return maxPage;
}

export function getTextQuery(state) {
  return typeof state?.ui?.textQuery === "string" ? state.ui.textQuery : "";
}

export function getTextMatchCounts(state) {
  if (!state?.ui?.textMatchCounts || typeof state.ui.textMatchCounts !== "object") {
    return {};
  }
  return state.ui.textMatchCounts;
}

export function getDetectedTextFilesMap(state) {
  if (!state?.ui?.textSearchDetectedFiles || typeof state.ui.textSearchDetectedFiles !== "object") {
    return {};
  }
  return state.ui.textSearchDetectedFiles;
}

export function isExpectedTextSearchError(message) {
  const text = String(message ?? "").toLowerCase();
  return (
    text.includes("enter text to search") ||
    text.includes("import at least one file") ||
    text.includes("no text-searchable pdf sources available") ||
    text.includes("another job is already running")
  );
}

export const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
export const MAX_FILE_NAME_LENGTH = 180;
export const DEFAULT_OUTPUT_FILE_NAME = "output.pdf";
export const DEFAULT_WATERMARK_TEXT = "CONFIDENTIAL";
export const MAX_WATERMARK_IMAGE_BYTES = 2 * 1024 * 1024;

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read image watermark"));
    };
    reader.onerror = () => reject(new Error("Failed to read image watermark"));
    reader.readAsDataURL(file);
  });
}

export async function convertImageFileToPngDataUrl(file) {
  if (!(file instanceof File)) {
    throw new Error("Select an image file.");
  }
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type || "")) {
    throw new Error("Watermark image must be PNG, JPG, or WEBP.");
  }
  if (file.size <= 0) {
    throw new Error("Watermark image file is empty.");
  }
  if (file.size > MAX_WATERMARK_IMAGE_BYTES) {
    throw new Error("Watermark image is too large (max 2 MB).");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadWatermarkImage(sourceDataUrl);
  const width = Math.max(1, Math.floor(Number(image.naturalWidth || image.width || 1)));
  const height = Math.max(1, Math.floor(Number(image.naturalHeight || image.height || 1)));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to prepare watermark image.");
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const pngDataUrl = canvas.toDataURL("image/png");
  const sanitized = sanitizeWatermarkImageDataUrl(pngDataUrl);
  if (!sanitized) {
    throw new Error("Failed to encode watermark image.");
  }
  return sanitized;
}

export function sanitizePdfFileName(rawInput, fallback = DEFAULT_OUTPUT_FILE_NAME) {
  const raw = typeof rawInput === "string" ? rawInput : "";
  const trimmed = raw.trim();
  let next = trimmed || fallback;
  next = next.replace(INVALID_FILE_NAME_CHARS, "");
  next = next.replace(/\s+/g, " ").trim();
  next = next.replace(/[. ]+$/g, "");
  if (!next) {
    next = fallback;
  }

  if (!/\.pdf$/i.test(next)) {
    next = `${next}.pdf`;
  }

  if (next.length > MAX_FILE_NAME_LENGTH) {
    const base = next.replace(/\.pdf$/i, "");
    const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - 4);
    next = `${base.slice(0, maxBaseLength)}.pdf`;
  }

  return {
    fileName: next,
    changed: next !== trimmed,
  };
}

export function stripPdfExtension(fileName) {
  return String(fileName ?? "").replace(/\.pdf$/i, "");
}

export function buildDownloadNamePlan(state) {
  const rawName = state?.ui?.exportFileName;
  const sanitized = sanitizePdfFileName(rawName, DEFAULT_OUTPUT_FILE_NAME);
  const base = stripPdfExtension(sanitized.fileName) || "output";

  return {
    exportName: sanitized.fileName,
    extractName: `${base}-extracted.pdf`,
    splitName(index, onePerPage) {
      const suffix = onePerPage
        ? `page-${padNumber(index + 1, 3)}`
        : `split-${padNumber(index + 1, 2)}`;
      return `${base}-${suffix}.pdf`;
    },
    inputAdjusted: sanitized.changed,
    adjustedInputName: sanitized.fileName,
  };
}

export function focusTimelineIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const row = document.querySelector(`.timeline-item[data-plan-index="${index}"]`);
      if (!(row instanceof HTMLElement)) {
        return;
      }

      row.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
  });
}

export function clearTimelineDropPosition(timelineItem) {
  if (!(timelineItem instanceof HTMLElement)) {
    return;
  }
  timelineItem.classList.remove("drop-before", "drop-after");
}

export function isTimelineFilmstripItem(timelineItem) {
  return Boolean(timelineItem?.closest?.(".timeline-list-filmstrip"));
}

export function setTimelineDropPosition(timelineItem, clientX, clientY) {
  if (!(timelineItem instanceof HTMLElement)) {
    return;
  }

  clearTimelineDropPosition(timelineItem);
  const rect = timelineItem.getBoundingClientRect();
  if (isTimelineFilmstripItem(timelineItem)) {
    const midpointX = rect.left + rect.width / 2;
    if (clientX >= midpointX) {
      timelineItem.classList.add("drop-after");
    } else {
      timelineItem.classList.add("drop-before");
    }
    return;
  }

  const midpointY = rect.top + rect.height / 2;
  if (clientY >= midpointY) {
    timelineItem.classList.add("drop-after");
  } else {
    timelineItem.classList.add("drop-before");
  }
}

export function setTimelineDropPositionByEdge(timelineItem, edge) {
  if (!(timelineItem instanceof HTMLElement)) {
    return;
  }
  clearTimelineDropPosition(timelineItem);
  if (edge === "after") {
    timelineItem.classList.add("drop-after");
    return;
  }
  timelineItem.classList.add("drop-before");
}

export function getEdgeTimelineDropTarget(clientX, clientY) {
  const rows = Array.from(document.querySelectorAll(".timeline-item[data-plan-index]")).filter(
    (node) => node instanceof HTMLElement,
  );
  if (rows.length === 0) {
    return null;
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();

  if (isTimelineFilmstripItem(first)) {
    if (clientX <= firstRect.left) {
      return { item: first, edge: "before" };
    }

    if (clientX >= lastRect.right) {
      return { item: last, edge: "after" };
    }

    return null;
  }

  if (clientY <= firstRect.top) {
    return { item: first, edge: "before" };
  }

  if (clientY >= lastRect.bottom) {
    return { item: last, edge: "after" };
  }

  return null;
}

export function createJobId() {
  return generateId("job");
}

export function toArrayBuffer(bytesLike) {
  if (bytesLike instanceof ArrayBuffer) {
    return bytesLike;
  }
  if (ArrayBuffer.isView(bytesLike)) {
    return bytesLike.buffer.slice(
      bytesLike.byteOffset,
      bytesLike.byteOffset + bytesLike.byteLength,
    );
  }
  throw new Error("Expected ArrayBuffer-compatible bytes");
}

async function createBlankPdfPageBytes() {
  const lib = globalThis.PDFLib;
  const PDFDocument = lib?.PDFDocument;
  if (!PDFDocument || typeof PDFDocument.create !== "function") {
    throw new Error("PDFLib is unavailable");
  }

  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const saved = await doc.save();
  return toArrayBuffer(saved);
}

export function buildBlankPageName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `blank-page-${stamp}.pdf`;
}

export function toErrorMessage(error, fallback = "Unknown error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const message = String(error ?? "").trim();
  return message || fallback;
}

export function warnIfLargeOutputPlan(pageCount) {
  if (!Number.isFinite(pageCount) || pageCount < SOFT_WARN_OUTPUT_PAGE_COUNT) {
    return;
  }

  showToast({
    type: "warning",
    title: "Large output plan",
    message: `${pageCount} pages selected for output. Export may take a while.`,
    timeoutMs: 4200,
  });
}

export function surfaceRuntimeError(dispatch, title, message, timeoutMs = 3600) {
  if (typeof dispatch === "function") {
    dispatch({
      type: "RUNTIME_ERROR_SET",
      payload: { error: message },
    });
  }

  showToast({
    type: "error",
    title,
    message,
    timeoutMs,
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function downloadPdfBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

export function padNumber(value, width) {
  return String(value).padStart(width, "0");
}

let activeJobCanceler = null;

export function setActiveJobCanceler(canceler) {
  activeJobCanceler = typeof canceler === "function" ? canceler : null;
}

export function clearActiveJobCanceler() {
  activeJobCanceler = null;
}

export function cancelActiveJob() {
  if (typeof activeJobCanceler !== "function") {
    return;
  }
  try {
    activeJobCanceler();
  } catch {
    // Ignore cancellation callback errors.
  }
}

export function isImageCandidateFile(file) {
  if (!file || typeof file !== "object") {
    return false;
  }
  if (typeof File !== "undefined" && !(file instanceof File)) {
    return false;
  }
  const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp") {
    return true;
  }
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
}

export function normalizeImageImportModeSetting(value) {
  return value === "combine" ? "combine" : DEFAULT_IMAGE_IMPORT_MODE;
}

export function normalizeImageImportOrderSetting(value) {
  if (
    value === "filename_asc" ||
    value === "filename_desc" ||
    value === "capture_time_asc"
  ) {
    return value;
  }
  return DEFAULT_IMAGE_IMPORT_ORDER;
}

export function normalizeImageImportSkipDuplicatesSetting(value) {
  return value === true ? true : DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES;
}

export function normalizeImageImportAutoAppendSetting(value) {
  return value === true ? true : DEFAULT_IMAGE_IMPORT_AUTO_APPEND;
}

export function promptImageImportOptions(imageCount, defaults = {}) {
  const defaultMode = normalizeImageImportModeSetting(defaults.mode);
  const defaultOrder = normalizeImageImportOrderSetting(defaults.order);
  const defaultSkipDuplicates = normalizeImageImportSkipDuplicatesSetting(defaults.skipDuplicates);
  const defaultAutoAppend = normalizeImageImportAutoAppendSetting(defaults.autoAppendToOutput);
  return new Promise((resolve) => {
    showModal({
      title: "Image import options",
      bodyHtml: `
        <p>You selected ${imageCount} images. Choose how to import them.</p>
        <div class="field-inline">
          <label for="image-import-mode">Mode</label>
          <select id="image-import-mode" class="select">
            <option value="separate" ${defaultMode === "separate" ? "selected" : ""}>Import each image as its own PDF</option>
            <option value="combine" ${defaultMode === "combine" ? "selected" : ""}>Combine images into one multi-page PDF</option>
          </select>
        </div>
        <div class="field-inline">
          <label for="image-import-order">Ordering</label>
          <select id="image-import-order" class="select">
            <option value="as_selected" ${defaultOrder === "as_selected" ? "selected" : ""}>As selected</option>
            <option value="filename_asc" ${defaultOrder === "filename_asc" ? "selected" : ""}>Filename (A-Z)</option>
            <option value="filename_desc" ${defaultOrder === "filename_desc" ? "selected" : ""}>Filename (Z-A)</option>
            <option value="capture_time_asc" ${defaultOrder === "capture_time_asc" ? "selected" : ""}>Capture time (EXIF)</option>
          </select>
        </div>
        <div class="field-inline">
          <label for="image-import-skip-duplicates">Skip duplicate images</label>
          <input
            id="image-import-skip-duplicates"
            type="checkbox"
            ${defaultSkipDuplicates ? "checked" : ""}
          />
        </div>
        <div class="field-inline">
          <label for="image-import-auto-append">Auto-append images to output</label>
          <input
            id="image-import-auto-append"
            type="checkbox"
            ${defaultAutoAppend ? "checked" : ""}
          />
        </div>
      `,
      primaryText: "Import",
      secondaryText: "Cancel",
      onPrimary: () => {
        const modeEl = document.getElementById("image-import-mode");
        const orderEl = document.getElementById("image-import-order");
        const skipDuplicatesEl = document.getElementById("image-import-skip-duplicates");
        const autoAppendEl = document.getElementById("image-import-auto-append");
        if (
          !(modeEl instanceof HTMLSelectElement) ||
          !(orderEl instanceof HTMLSelectElement) ||
          !(skipDuplicatesEl instanceof HTMLInputElement) ||
          !(autoAppendEl instanceof HTMLInputElement)
        ) {
          resolve({
            mode: DEFAULT_IMAGE_IMPORT_MODE,
            order: DEFAULT_IMAGE_IMPORT_ORDER,
            skipDuplicates: DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES,
            autoAppendToOutput: DEFAULT_IMAGE_IMPORT_AUTO_APPEND,
          });
          return true;
        }
        resolve({
          mode: normalizeImageImportModeSetting(modeEl.value),
          order: normalizeImageImportOrderSetting(orderEl.value),
          skipDuplicates: normalizeImageImportSkipDuplicatesSetting(skipDuplicatesEl.checked),
          autoAppendToOutput: normalizeImageImportAutoAppendSetting(autoAppendEl.checked),
        });
        return true;
      },
      onSecondary: () => {
        resolve(null);
        return true;
      },
    });
  });
}
