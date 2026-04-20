import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_EXPORT_FILE_NAME,
  DEFAULT_IMAGE_IMPORT_AUTO_APPEND,
  DEFAULT_IMAGE_IMPORT_MODE,
  DEFAULT_IMAGE_IMPORT_ORDER,
  DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES,
  DEFAULT_OUTPUT_FIND_MODE,
  DEFAULT_WATERMARK,
} from "../config.js";
import { clamp } from "../utils/math.js";

export function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function mergeUiPatch(currentUi, patch) {
  if (!isPlainObject(patch)) {
    return currentUi;
  }

  const nextUi = { ...currentUi };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(currentUi[key])) {
      nextUi[key] = { ...currentUi[key], ...value };
      continue;
    }
    nextUi[key] = value;
  }
  return nextUi;
}

export function buildPageRefsForFile(file) {
  const pageCount = Number.isFinite(file?.pageCount) && file.pageCount > 0 ? file.pageCount : 0;
  if (pageCount === 0 || typeof file?.id !== "string") {
    return [];
  }

  return Array.from({ length: pageCount }, (_, pageIndex) => ({
    fileId: file.id,
    pageIndex,
    rotation: 0,
    locked: false,
  }));
}

export { clamp };
export function clampIndex(value, min, max) {
  return clamp(value, min, max);
}

export function normalizeQuarterTurnRotation(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  const turns = Math.round(numeric / 90);
  const normalizedTurns = ((turns % 4) + 4) % 4;
  return normalizedTurns * 90;
}

export function normalizeDocPlanIndices(indices, length) {
  const source = Array.isArray(indices) ? indices : [];
  return Array.from(
    new Set(source.filter((index) => Number.isInteger(index) && index >= 0 && index < length)),
  );
}

export function remapIndexAfterMove(index, fromIndex, toIndex) {
  if (!Number.isInteger(index)) {
    return null;
  }

  if (index === fromIndex) {
    return toIndex;
  }

  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
    return index - 1;
  }

  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) {
    return index + 1;
  }

  return index;
}

export function remapSelectionAfterMove(indices, fromIndex, toIndex, length) {
  const normalized = normalizeDocPlanIndices(indices, length);
  const mapped = normalized
    .map((index) => remapIndexAfterMove(index, fromIndex, toIndex))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length);
  return Array.from(new Set(mapped)).sort((a, b) => a - b);
}

export function remapLastSelectedAfterMove(lastIndex, fromIndex, toIndex, length) {
  if (!Number.isInteger(lastIndex) || lastIndex < 0 || lastIndex >= length) {
    return null;
  }
  const mapped = remapIndexAfterMove(lastIndex, fromIndex, toIndex);
  return Number.isInteger(mapped) && mapped >= 0 && mapped < length ? mapped : null;
}

export function countRemovedBefore(sortedRemovedIndices, index) {
  let count = 0;
  for (const removedIndex of sortedRemovedIndices) {
    if (removedIndex >= index) {
      break;
    }
    count += 1;
  }
  return count;
}

export function remapSelectionAfterRemovals(indices, removedIndices, originalLength, nextLength) {
  const removedAsc = [...removedIndices].sort((a, b) => a - b);
  const removedSet = new Set(removedAsc);
  const normalized = normalizeDocPlanIndices(indices, originalLength);

  const mapped = [];
  for (const index of normalized) {
    if (removedSet.has(index)) {
      continue;
    }
    const shift = countRemovedBefore(removedAsc, index);
    const nextIndex = index - shift;
    if (nextIndex >= 0 && nextIndex < nextLength) {
      mapped.push(nextIndex);
    }
  }

  return Array.from(new Set(mapped)).sort((a, b) => a - b);
}

export function remapLastSelectedAfterRemovals(lastIndex, removedIndices, originalLength, nextLength) {
  if (!Number.isInteger(lastIndex) || lastIndex < 0 || lastIndex >= originalLength) {
    return null;
  }

  const removedAsc = [...removedIndices].sort((a, b) => a - b);
  if (removedAsc.includes(lastIndex)) {
    return null;
  }

  const shift = countRemovedBefore(removedAsc, lastIndex);
  const nextIndex = lastIndex - shift;
  return nextIndex >= 0 && nextIndex < nextLength ? nextIndex : null;
}

export function toInteger(value, fallback = 0) {
  if (Number.isInteger(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isInteger(parsed)) {
    return parsed;
  }
  return fallback;
}

export function getAvailableFileIdSet(files) {
  const ids = new Set();
  if (!Array.isArray(files)) {
    return ids;
  }

  for (const file of files) {
    if (typeof file?.id === "string" && file.id) {
      ids.add(file.id);
    }
  }

  return ids;
}

export function normalizeOutputFindMode(value) {
  return value === "source_page" ? "source_page" : DEFAULT_OUTPUT_FIND_MODE;
}

export function normalizeImageImportMode(value) {
  return value === "combine" ? "combine" : DEFAULT_IMAGE_IMPORT_MODE;
}

export function normalizeImageImportOrder(value) {
  if (
    value === "filename_asc" ||
    value === "filename_desc" ||
    value === "capture_time_asc"
  ) {
    return value;
  }
  return DEFAULT_IMAGE_IMPORT_ORDER;
}

export function normalizeImageImportSkipDuplicates(value) {
  return value === true ? true : DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES;
}

export function normalizeImageImportAutoAppend(value) {
  return value === true ? true : DEFAULT_IMAGE_IMPORT_AUTO_APPEND;
}

export function sanitizeImageImportDefaults(value) {
  const safe = isPlainObject(value) ? value : {};
  return {
    mode: normalizeImageImportMode(safe.mode),
    order: normalizeImageImportOrder(safe.order),
    skipDuplicates: normalizeImageImportSkipDuplicates(safe.skipDuplicates),
    autoAppendToOutput: normalizeImageImportAutoAppend(safe.autoAppendToOutput),
  };
}

export function normalizeExportFileNameInput(value) {
  if (typeof value === "string") {
    return value;
  }
  return DEFAULT_EXPORT_FILE_NAME;
}

export function normalizeWatermarkMode(value) {
  return value === "image" ? "image" : "text";
}

export function normalizeWatermarkTarget(value) {
  if (value === "selected_output_pages") {
    return "selected_output_pages";
  }
  if (value === "odd_output_pages") {
    return "odd_output_pages";
  }
  if (value === "even_output_pages") {
    return "even_output_pages";
  }
  if (value === "range_output_pages") {
    return "range_output_pages";
  }
  return "all_output_pages";
}

export function normalizeWatermarkPosition(value) {
  if (value === "center" || value === "bottom_right") {
    return value;
  }
  return "diagonal_center";
}

export function normalizeWatermarkSizeMode(value) {
  return value === "manual" ? "manual" : "max_fit";
}

export function normalizeWatermarkImageFit(value) {
  return value === "cover" ? "cover" : "contain";
}

export function sanitizeWatermarkDataUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^data:image\/(png|jpeg|jpg);base64,/i.test(trimmed) ? trimmed : "";
}

export function sanitizeWatermarkUi(value) {
  const safe = isPlainObject(value) ? value : {};
  const mode = normalizeWatermarkMode(safe.mode);
  const target = normalizeWatermarkTarget(safe.target);
  const position = normalizeWatermarkPosition(safe.position ?? DEFAULT_WATERMARK.position);
  const opacityRaw = Number(safe.opacity);
  const rotationRaw = Number(safe.rotationDeg);
  const fontSizeRaw = Number(safe.fontSizePct);
  const text = typeof safe.text === "string" ? safe.text.trim() : "";
  const rangeInput = typeof safe.rangeInput === "string" ? safe.rangeInput.trim() : "";
  const imageDataUrl = sanitizeWatermarkDataUrl(safe.imageDataUrl);
  const imageName = typeof safe.imageName === "string" ? safe.imageName.trim().slice(0, 180) : "";

  return {
    enabled: mode === "image" ? imageDataUrl.length > 0 : text.length > 0,
    mode,
    text,
    target,
    rangeInput,
    position,
    opacity: Number.isFinite(opacityRaw) ? clampIndex(opacityRaw, 0.05, 1) : DEFAULT_WATERMARK.opacity,
    rotationDeg: Number.isFinite(rotationRaw)
      ? clampIndex(rotationRaw, -180, 180)
      : position === "diagonal_center"
        ? 45
        : 0,
    sizeMode: normalizeWatermarkSizeMode(safe.sizeMode),
    fontSizePct: Number.isFinite(fontSizeRaw) ? clampIndex(fontSizeRaw, 4, 40) : DEFAULT_WATERMARK.fontSizePct,
    imageDataUrl,
    imageName,
    imageFit: normalizeWatermarkImageFit(safe.imageFit),
  };
}

export function normalizeHeaderFooterPosition(value, fallback = "bottom_center") {
  switch (value) {
    case "top_left":
    case "top_center":
    case "top_right":
    case "bottom_left":
    case "bottom_center":
    case "bottom_right":
      return value;
    default:
      return fallback;
  }
}

export function normalizeHeaderFooterTarget(value) {
  if (value === "selected_output_pages") {
    return "selected_output_pages";
  }
  if (value === "range_output_pages") {
    return "range_output_pages";
  }
  return "all_output_pages";
}

export function sanitizeHeaderFooterUi(value) {
  const safe = isPlainObject(value) ? value : {};
  const headerText = typeof safe.headerText === "string" ? safe.headerText.trim() : "";
  const footerText = typeof safe.footerText === "string" ? safe.footerText.trim() : "";
  const pageNumbersEnabled = safe.pageNumbersEnabled === true;
  const pageNumberFormatRaw =
    typeof safe.pageNumberFormat === "string" ? safe.pageNumberFormat.trim() : "";
  const pageNumberFormat = pageNumberFormatRaw || DEFAULT_HEADER_FOOTER.pageNumberFormat;
  const target = normalizeHeaderFooterTarget(safe.target);
  const rangeInput = typeof safe.rangeInput === "string" ? safe.rangeInput.trim() : "";
  const opacityRaw = Number(safe.opacity);
  const fontSizePtRaw = Number(safe.fontSizePt);
  const marginPtRaw = Number(safe.marginPt);
  const enabled = headerText.length > 0 || footerText.length > 0 || pageNumbersEnabled;

  return {
    enabled,
    headerText,
    footerText,
    headerPosition: normalizeHeaderFooterPosition(
      safe.headerPosition,
      DEFAULT_HEADER_FOOTER.headerPosition,
    ),
    footerPosition: normalizeHeaderFooterPosition(
      safe.footerPosition,
      DEFAULT_HEADER_FOOTER.footerPosition,
    ),
    pageNumbersEnabled,
    pageNumberFormat,
    pageNumberPosition: normalizeHeaderFooterPosition(
      safe.pageNumberPosition,
      DEFAULT_HEADER_FOOTER.pageNumberPosition,
    ),
    target,
    rangeInput,
    opacity: Number.isFinite(opacityRaw) ? clampIndex(opacityRaw, 0.05, 1) : DEFAULT_HEADER_FOOTER.opacity,
    fontSizePt: Number.isFinite(fontSizePtRaw)
      ? clampIndex(fontSizePtRaw, 6, 48)
      : DEFAULT_HEADER_FOOTER.fontSizePt,
    marginPt: Number.isFinite(marginPtRaw) ? clampIndex(marginPtRaw, 8, 72) : DEFAULT_HEADER_FOOTER.marginPt,
  };
}

export function sanitizeTextMatchMap(value, availableFileIds) {
  if (!isPlainObject(value)) {
    return {};
  }

  const next = {};
  for (const [fileId, rawCount] of Object.entries(value)) {
    if (!availableFileIds.has(fileId)) {
      continue;
    }

    const parsed = Number.parseInt(String(rawCount ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      continue;
    }

    next[fileId] = parsed;
  }
  return next;
}

export function sanitizeDetectedTextMap(value, availableFileIds) {
  if (!isPlainObject(value)) {
    return {};
  }

  const next = {};
  for (const [fileId, rawValue] of Object.entries(value)) {
    if (!availableFileIds.has(fileId)) {
      continue;
    }
    next[fileId] = Boolean(rawValue);
  }
  return next;
}

export function sanitizeUiForSnapshot(ui, files, docPlan) {
  const safeUi = isPlainObject(ui) ? ui : {};
  const baseUi = { ...safeUi };
  const safeFiles = Array.isArray(files) ? files : [];
  const safeDocPlan = Array.isArray(docPlan) ? docPlan : [];
  const availableFileIds = getAvailableFileIdSet(safeFiles);

  const selectedFileId =
    typeof safeUi.selectedFileId === "string" && availableFileIds.has(safeUi.selectedFileId)
      ? safeUi.selectedFileId
      : null;

  const selectedFile = selectedFileId
    ? safeFiles.find((file) => file?.id === selectedFileId) ?? null
    : null;

  const maxSourcePageIndex =
    Number.isFinite(selectedFile?.pageCount) && selectedFile.pageCount > 0
      ? selectedFile.pageCount - 1
      : 0;

  const selectedSourcePageIndex = selectedFile
    ? clampIndex(toInteger(safeUi.selectedSourcePageIndex, 0), 0, maxSourcePageIndex)
    : 0;
  const selectedSourcePageIndices = selectedFile
    ? normalizeDocPlanIndices(safeUi.selectedSourcePageIndices, maxSourcePageIndex + 1)
    : [];
  const rawLastSelectedSourcePageIndex = toInteger(safeUi.lastSelectedSourcePageIndex, -1);
  const lastSelectedSourcePageIndex =
    selectedFile && rawLastSelectedSourcePageIndex >= 0 && rawLastSelectedSourcePageIndex <= maxSourcePageIndex
      ? rawLastSelectedSourcePageIndex
      : null;

  const selectedOutputPageIndices = normalizeDocPlanIndices(
    safeUi.selectedOutputPageIndices,
    safeDocPlan.length,
  );

  const rawLastSelected = toInteger(safeUi.lastSelectedOutputIndex, -1);
  const lastSelectedOutputIndex =
    rawLastSelected >= 0 && rawLastSelected < safeDocPlan.length ? rawLastSelected : null;

  const outputCursorIndex = clampIndex(toInteger(safeUi.outputCursorIndex, 0), 0, safeDocPlan.length);
  const outputFindMode = normalizeOutputFindMode(safeUi.outputFindMode);
  const imageImportDefaults = sanitizeImageImportDefaults(safeUi.imageImportDefaults);
  const exportFileName = normalizeExportFileNameInput(safeUi.exportFileName);
  const textQuery = typeof safeUi.textQuery === "string" ? safeUi.textQuery : "";
  const textMatchQuery = typeof safeUi.textMatchQuery === "string" ? safeUi.textMatchQuery : "";
  const textMatchCounts = sanitizeTextMatchMap(safeUi.textMatchCounts, availableFileIds);
  const textMatchOccurrences = sanitizeTextMatchMap(safeUi.textMatchOccurrences, availableFileIds);
  const textSearchDetectedFiles = sanitizeDetectedTextMap(safeUi.textSearchDetectedFiles, availableFileIds);
  const watermark = sanitizeWatermarkUi(safeUi.watermark);
  const headerFooter = sanitizeHeaderFooterUi(safeUi.headerFooter);

  return {
    ...baseUi,
    selectedFileId,
    selectedSourcePageIndex,
    selectedSourcePageIndices,
    lastSelectedSourcePageIndex,
    selectedOutputPageIndices,
    lastSelectedOutputIndex,
    outputCursorIndex,
    outputFindMode,
    imageImportDefaults,
    exportFileName,
    textQuery,
    textMatchQuery,
    textMatchCounts,
    textMatchOccurrences,
    textSearchDetectedFiles,
    watermark,
    headerFooter,
  };
}
