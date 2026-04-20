import { DEFAULT_HEADER_FOOTER, DEFAULT_WATERMARK } from "../../config.js";
import { idbGetFile } from "../../state/idb.js";
import {
  normalizeWatermarkImageFit,
  normalizeWatermarkMode,
  normalizeWatermarkPosition,
  normalizeWatermarkSizeMode,
  normalizeWatermarkTarget,
} from "../../state/store-helpers.js";
import { clamp } from "../../utils/math.js";
import {
  clampWatermarkOrigin,
  getRotatedBoundsForRect,
  getWatermarkMargin,
  getWatermarkPlacement,
  rotatePoint,
} from "../../utils/watermark-geometry.js";
import { applyPdfMetadata } from "./metadata.js";
import { parsePageRanges } from "./page-ranges.js";

let pdfLibPromise = null;

function isUsablePdfLib(value) {
  return (
    value &&
    typeof value === "object" &&
    value.PDFDocument &&
    typeof value.PDFDocument.create === "function" &&
    typeof value.PDFDocument.load === "function"
  );
}

async function getPdfLib() {
  if (isUsablePdfLib(globalThis.PDFLib)) {
    return globalThis.PDFLib;
  }

  if (!pdfLibPromise) {
    pdfLibPromise = Promise.resolve().then(() => {
      if (!isUsablePdfLib(globalThis.PDFLib)) {
        throw new Error("pdf-lib unavailable. Verify /vendor/pdf-lib.min.js is present and loaded.");
      }
      return globalThis.PDFLib;
    });
  }

  return pdfLibPromise;
}

function toUint8Array(bytesLike) {
  if (bytesLike instanceof Uint8Array) {
    return bytesLike;
  }

  if (bytesLike instanceof ArrayBuffer) {
    return new Uint8Array(bytesLike);
  }

  if (ArrayBuffer.isView(bytesLike)) {
    return new Uint8Array(bytesLike.buffer, bytesLike.byteOffset, bytesLike.byteLength);
  }

  throw new Error("Invalid PDF byte buffer from storage");
}

function getReadableFileName(files, fileId) {
  const safeFiles = Array.isArray(files) ? files : [];
  const record = safeFiles.find((file) => file?.id === fileId);
  return record?.name || record?.originalName || fileId;
}

function toPageIndex(value) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return 0;
}

function toRotation(value) {
  return Number.isFinite(value) ? value : 0;
}


function normalizeHeaderFooterTarget(target) {
  if (target === "selected_output_pages") {
    return "selected_output_pages";
  }
  if (target === "range_output_pages") {
    return "range_output_pages";
  }
  return "all_output_pages";
}

function normalizeHeaderFooterPosition(position, fallback = "bottom_center") {
  switch (position) {
    case "top_left":
    case "top_center":
    case "top_right":
    case "bottom_left":
    case "bottom_center":
    case "bottom_right":
      return position;
    default:
      return fallback;
  }
}

function normalizeSelectedOutputIndices(indices) {
  if (!Array.isArray(indices)) {
    return [];
  }
  return Array.from(
    new Set(indices.filter((index) => Number.isInteger(index) && index >= 0)),
  ).sort((a, b) => a - b);
}

function resolveHeaderFooterTargetSet({
  target,
  rangeInput,
  selectedOutputPageIndices,
  totalOutputPages,
}) {
  if (target === "selected_output_pages") {
    return new Set(selectedOutputPageIndices);
  }
  if (target === "range_output_pages") {
    const parsed = parsePageRanges(rangeInput, totalOutputPages);
    return new Set(parsed);
  }
  return new Set();
}

function normalizeHeaderFooterConfig(rawHeaderFooter, totalOutputPages) {
  const safe = rawHeaderFooter && typeof rawHeaderFooter === "object" ? rawHeaderFooter : {};
  const headerText = typeof safe.headerText === "string" ? safe.headerText.trim() : "";
  const footerText = typeof safe.footerText === "string" ? safe.footerText.trim() : "";
  const pageNumbersEnabled = safe.pageNumbersEnabled === true;
  const pageNumberFormatRaw =
    typeof safe.pageNumberFormat === "string" ? safe.pageNumberFormat.trim() : "";
  const pageNumberFormat = pageNumberFormatRaw || DEFAULT_HEADER_FOOTER.pageNumberFormat;
  const target = normalizeHeaderFooterTarget(safe.target);
  const rangeInput = typeof safe.rangeInput === "string" ? safe.rangeInput.trim() : "";
  const outputPageCountRaw = Number(safe.outputPageCount);
  const outputPageCount = Number.isInteger(outputPageCountRaw) && outputPageCountRaw > 0
    ? outputPageCountRaw
    : totalOutputPages;
  const selectedOutputPageIndices = normalizeSelectedOutputIndices(safe.selectedOutputPageIndices);
  const targetSet = resolveHeaderFooterTargetSet({
    target,
    rangeInput,
    selectedOutputPageIndices,
    totalOutputPages: outputPageCount,
  });
  const opacityRaw = Number(safe.opacity);
  const fontSizePtRaw = Number(safe.fontSizePt);
  const marginPtRaw = Number(safe.marginPt);
  const outputFileName = typeof safe.outputFileName === "string" ? safe.outputFileName.trim() : "";

  return {
    enabled: headerText.length > 0 || footerText.length > 0 || pageNumbersEnabled,
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
    targetSet,
    opacity: Number.isFinite(opacityRaw) ? clamp(opacityRaw, 0.05, 1) : DEFAULT_HEADER_FOOTER.opacity,
    fontSizePt: Number.isFinite(fontSizePtRaw) ? clamp(fontSizePtRaw, 6, 48) : DEFAULT_HEADER_FOOTER.fontSizePt,
    marginPt: Number.isFinite(marginPtRaw) ? clamp(marginPtRaw, 8, 72) : DEFAULT_HEADER_FOOTER.marginPt,
    outputFileName,
  };
}

function shouldApplyHeaderFooterToPage(config, pageRef, outputIndex) {
  if (!config.enabled) {
    return false;
  }

  const sourceOutputIndex = Number.isInteger(pageRef?.sourceOutputIndex)
    ? pageRef.sourceOutputIndex
    : outputIndex;
  if (config.target === "all_output_pages") {
    return true;
  }
  return config.targetSet.has(sourceOutputIndex);
}

function getDefaultRotationForPosition(position) {
  return position === "diagonal_center" ? 45 : 0;
}

function sanitizeImageDataUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^data:image\/(png|jpeg|jpg);base64,/i.test(trimmed) ? trimmed : "";
}

function resolveWatermarkTargetSet({ target, rangeInput, selectedOutputPageIndices, totalOutputPages }) {
  if (target === "selected_output_pages") {
    return new Set(selectedOutputPageIndices);
  }
  if (target === "range_output_pages") {
    const parsed = parsePageRanges(rangeInput, totalOutputPages);
    return new Set(parsed);
  }
  return new Set();
}

function normalizeWatermarkConfig(rawWatermark, totalOutputPages) {
  const safe = rawWatermark && typeof rawWatermark === "object" ? rawWatermark : {};
  const mode = normalizeWatermarkMode(safe.mode);
  const text = typeof safe.text === "string" ? safe.text.trim() : "";
  const position = normalizeWatermarkPosition(safe.position);
  const target = normalizeWatermarkTarget(safe.target);
  const rangeInput = typeof safe.rangeInput === "string" ? safe.rangeInput.trim() : "";
  const rawOpacity = Number(safe.opacity);
  const rawRotation = Number(safe.rotationDeg);
  const sizeMode = normalizeWatermarkSizeMode(safe.sizeMode);
  const rawFontSizePct = Number(safe.fontSizePct);
  const selectedOutputPageIndices = normalizeSelectedOutputIndices(safe.selectedOutputPageIndices);
  const imageDataUrl = sanitizeImageDataUrl(safe.imageDataUrl);
  const imageFit = normalizeWatermarkImageFit(safe.imageFit);
  const targetSet = resolveWatermarkTargetSet({
    target,
    rangeInput,
    selectedOutputPageIndices,
    totalOutputPages,
  });

  return {
    enabled: mode === "image" ? imageDataUrl.length > 0 : text.length > 0,
    mode,
    text,
    target,
    rangeInput,
    targetSet,
    position,
    opacity: Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0.05, 1) : DEFAULT_WATERMARK.opacity,
    rotationDeg: Number.isFinite(rawRotation)
      ? clamp(rawRotation, -180, 180)
      : getDefaultRotationForPosition(position),
    sizeMode,
    fontSizePct: Number.isFinite(rawFontSizePct)
      ? clamp(rawFontSizePct, 4, 40)
      : DEFAULT_WATERMARK.fontSizePct,
    selectedOutputPageIndices,
    imageDataUrl,
    imageFit,
  };
}

function shouldApplyWatermarkToPage(watermark, pageRef, outputIndex) {
  if (!watermark.enabled) {
    return false;
  }

  const sourceOutputIndex = Number.isInteger(pageRef?.sourceOutputIndex)
    ? pageRef.sourceOutputIndex
    : outputIndex;

  if (watermark.target === "all_output_pages") {
    return true;
  }
  if (watermark.target === "odd_output_pages") {
    return (sourceOutputIndex + 1) % 2 === 1;
  }
  if (watermark.target === "even_output_pages") {
    return (sourceOutputIndex + 1) % 2 === 0;
  }
  return watermark.targetSet.has(sourceOutputIndex);
}

function getPdfTextBoxMetrics(watermarkFont, text, fontSize) {
  const width = Math.max(0.0001, watermarkFont.widthOfTextAtSize(text, fontSize));
  const fullHeight = Math.max(
    0.0001,
    typeof watermarkFont.heightAtSize === "function"
      ? watermarkFont.heightAtSize(fontSize, { descender: true })
      : fontSize,
  );
  const ascentHeight = Math.max(
    0.0001,
    typeof watermarkFont.heightAtSize === "function"
      ? watermarkFont.heightAtSize(fontSize, { descender: false })
      : fullHeight,
  );
  const descenderHeight = clamp(fullHeight - ascentHeight, 0, fullHeight);
  const ascenderHeight = Math.max(0.0001, fullHeight - descenderHeight);

  return {
    minX: 0,
    maxX: width,
    minY: -descenderHeight,
    maxY: ascenderHeight,
  };
}

function getMaxFitFontSizeForPdf({ watermarkFont, text, rotationDeg, pageWidth, pageHeight }) {
  const margin = getWatermarkMargin(pageWidth, pageHeight);
  const boxAt1 = getPdfTextBoxMetrics(watermarkFont, text, 1);
  const boundsAt1 = getRotatedBoundsForRect({ ...boxAt1, rotationDeg });
  const spanX = Math.max(0.0001, boundsAt1.maxX - boundsAt1.minX);
  const spanY = Math.max(0.0001, boundsAt1.maxY - boundsAt1.minY);
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  return clamp(scale, 10, Math.max(pageWidth, pageHeight) * 1.2);
}

function resolveHeaderFooterTemplate(template, { pageNumber, totalPages, fileName, outputFileName }) {
  if (typeof template !== "string") {
    return "";
  }
  return template.replace(
    /\{(page|total|input_filename|output_filename)\}/gi,
    (match, token) => {
      switch (String(token).toLowerCase()) {
        case "page":
          return String(pageNumber);
        case "total":
          return String(totalPages);
        case "input_filename":
          return String(fileName ?? "");
        case "output_filename":
          return String(outputFileName ?? "");
        default:
          return match;
      }
    },
  );
}

function getHeaderFooterCoords(page, font, text, fontSizePt, position, marginPt) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const textWidth = Math.max(0.001, font.widthOfTextAtSize(text, fontSizePt));
  const top = position.startsWith("top_");
  const horizontal = position.endsWith("_left")
    ? "left"
    : position.endsWith("_right")
      ? "right"
      : "center";

  let x = marginPt;
  if (horizontal === "center") {
    x = (pageWidth - textWidth) / 2;
  } else if (horizontal === "right") {
    x = pageWidth - marginPt - textWidth;
  }
  if (textWidth >= pageWidth - marginPt * 2) {
    x = marginPt;
  } else {
    x = clamp(x, marginPt, Math.max(marginPt, pageWidth - marginPt - textWidth));
  }

  const y = top
    ? clamp(pageHeight - marginPt - fontSizePt, marginPt, Math.max(marginPt, pageHeight - marginPt))
    : marginPt;

  return { x, y };
}

function drawHeaderFooterText({ page, font, PDFLib, config, text, position }) {
  const safeText = typeof text === "string" ? text.trim() : "";
  if (!safeText) {
    return;
  }
  const fontSizePt = config.fontSizePt;
  const marginPt = config.marginPt;
  const { x, y } = getHeaderFooterCoords(page, font, safeText, fontSizePt, position, marginPt);
  page.drawText(safeText, {
    x,
    y,
    size: fontSizePt,
    font,
    color: PDFLib.rgb(0.15, 0.15, 0.15),
    opacity: config.opacity,
  });
}

function applyHeaderFooterToPage({
  page,
  PDFLib,
  font,
  config,
  pageNumber,
  totalPages,
  fileName,
  outputFileName,
}) {
  if (!page || !font || !config.enabled) {
    return;
  }

  if (config.headerText) {
    const headerText = resolveHeaderFooterTemplate(config.headerText, {
      pageNumber,
      totalPages,
      fileName,
      outputFileName,
    });
    drawHeaderFooterText({
      page,
      font,
      PDFLib,
      config,
      text: headerText,
      position: config.headerPosition,
    });
  }

  if (config.footerText) {
    const footerText = resolveHeaderFooterTemplate(config.footerText, {
      pageNumber,
      totalPages,
      fileName,
      outputFileName,
    });
    drawHeaderFooterText({
      page,
      font,
      PDFLib,
      config,
      text: footerText,
      position: config.footerPosition,
    });
  }

  if (config.pageNumbersEnabled) {
    const numberText = resolveHeaderFooterTemplate(config.pageNumberFormat, {
      pageNumber,
      totalPages,
      fileName,
      outputFileName,
    });
    drawHeaderFooterText({
      page,
      font,
      PDFLib,
      config,
      text: numberText,
      position: config.pageNumberPosition,
    });
  }
}

function getImageScaleForPage({ imageWidth, imageHeight, rotationDeg, pageWidth, pageHeight, fitMode }) {
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

function applyTextWatermarkToPage(page, watermark, watermarkFont, PDFLib) {
  if (!page || !watermarkFont || !PDFLib || typeof page.getSize !== "function") {
    return;
  }

  const { width: pageWidth, height: pageHeight } = page.getSize();
  const minEdge = Math.max(1, Math.min(pageWidth, pageHeight));
  const manualSizeScale = Number.isFinite(watermark?.fontSizePct)
    ? clamp(watermark.fontSizePct, 4, 40) / 100
    : DEFAULT_WATERMARK.fontSizePct / 100;
  const manualFontSize = clamp(minEdge * manualSizeScale, 10, 160);
  const fontSize =
    watermark?.sizeMode === "max_fit"
      ? getMaxFitFontSizeForPdf({
          watermarkFont,
          text: watermark.text,
          rotationDeg: watermark.rotationDeg,
          pageWidth,
          pageHeight,
        })
      : manualFontSize;
  const box = getPdfTextBoxMetrics(watermarkFont, watermark.text, fontSize);
  const { x, y } = getWatermarkPlacement({
    pageWidth,
    pageHeight,
    box,
    position: watermark.position,
    rotationDeg: watermark.rotationDeg,
  });

  page.drawText(watermark.text, {
    x,
    y,
    size: fontSize,
    font: watermarkFont,
    color: PDFLib.rgb(0.25, 0.25, 0.25),
    opacity: watermark.opacity,
    rotate: PDFLib.degrees(watermark.rotationDeg),
  });
}

function parseDataUrlImageBytes(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw new Error("Invalid watermark image data");
  }
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error("Invalid watermark image bytes");
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2].replace(/\s+/g, "");
  if (!base64Payload) {
    throw new Error("Invalid watermark image bytes");
  }

  let binary = "";
  try {
    binary = atob(base64Payload);
  } catch {
    throw new Error("Invalid watermark image bytes");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mimeType, bytes };
}

async function embedWatermarkImage(out, PDFLib, watermark) {
  const { mimeType, bytes } = parseDataUrlImageBytes(watermark.imageDataUrl);
  if (mimeType === "image/png") {
    return out.embedPng(bytes);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return out.embedJpg(bytes);
  }
  throw new Error("Unsupported watermark image type. Use PNG or JPG.");
}

function applyImageWatermarkToPage(page, watermark, embeddedImage, PDFLib) {
  if (!page || !embeddedImage || !PDFLib || typeof page.getSize !== "function") {
    return;
  }

  const imageSize =
    typeof embeddedImage.scale === "function"
      ? embeddedImage.scale(1)
      : {
          width: embeddedImage.width,
          height: embeddedImage.height,
        };
  const imageWidth = Number(imageSize?.width);
  const imageHeight = Number(imageSize?.height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Invalid watermark image dimensions");
  }

  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = getImageScaleForPage({
    imageWidth,
    imageHeight,
    rotationDeg: watermark.rotationDeg,
    pageWidth,
    pageHeight,
    fitMode: watermark.imageFit,
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
    pageWidth,
    pageHeight,
    box,
    position: watermark.position,
    rotationDeg: watermark.rotationDeg,
  });

  page.drawImage(embeddedImage, {
    x,
    y,
    width: drawWidth,
    height: drawHeight,
    opacity: watermark.opacity,
    rotate: PDFLib.degrees(watermark.rotationDeg),
  });
}

export async function exportPdfFromDocPlan({ state, onProgress } = {}) {
  const safeState = state && typeof state === "object" ? state : {};
  const docPlan = Array.isArray(safeState.docPlan) ? safeState.docPlan : [];
  return exportPdfFromPageRefs({
    files: safeState.files,
    pageRefs: docPlan,
    onProgress,
    meta: safeState?.ui?.exportMetadata,
    watermark: {
      ...(safeState?.ui?.watermark ?? {}),
      selectedOutputPageIndices: safeState?.ui?.selectedOutputPageIndices,
    },
    headerFooter: {
      ...(safeState?.ui?.headerFooter ?? {}),
      selectedOutputPageIndices: safeState?.ui?.selectedOutputPageIndices,
      outputPageCount: docPlan.length,
      outputFileName: typeof safeState?.ui?.exportFileName === "string" ? safeState.ui.exportFileName : "",
    },
  });
}

export async function exportPdfFromPageRefs({
  files,
  pageRefs,
  onProgress,
  meta,
  watermark,
  headerFooter,
} = {}) {
  const safeFiles = Array.isArray(files) ? files : [];
  const safePageRefs = Array.isArray(pageRefs) ? pageRefs : [];
  const total = safePageRefs.length;
  const progress = typeof onProgress === "function" ? onProgress : null;

  const PDFLib = await getPdfLib();
  const out = await PDFLib.PDFDocument.create();
  applyPdfMetadata(out, meta);
  const watermarkConfig = normalizeWatermarkConfig(watermark, safePageRefs.length);
  const watermarkFont =
    watermarkConfig.enabled &&
    watermarkConfig.mode === "text" &&
    typeof out.embedFont === "function" &&
    PDFLib?.StandardFonts &&
    typeof PDFLib.StandardFonts.Helvetica === "string"
      ? await out.embedFont(PDFLib.StandardFonts.Helvetica)
      : null;
  const watermarkImage =
    watermarkConfig.enabled && watermarkConfig.mode === "image"
      ? await embedWatermarkImage(out, PDFLib, watermarkConfig)
      : null;
  const headerFooterConfig = normalizeHeaderFooterConfig(headerFooter, safePageRefs.length);
  const headerFooterFont =
    headerFooterConfig.enabled &&
    typeof out.embedFont === "function" &&
    PDFLib?.StandardFonts &&
    typeof PDFLib.StandardFonts.Helvetica === "string"
      ? await out.embedFont(PDFLib.StandardFonts.Helvetica)
      : null;
  const sourceDocCache = new Map();
  const sourceNameCache = new Map();

  let done = 0;
  for (let outputIndex = 0; outputIndex < safePageRefs.length; outputIndex += 1) {
    const pageRef = safePageRefs[outputIndex];
    const fileId = typeof pageRef?.fileId === "string" ? pageRef.fileId : null;
    if (!fileId) {
      throw new Error("Invalid docPlan entry: missing fileId");
    }

    let srcDoc = sourceDocCache.get(fileId);
    if (!srcDoc) {
      const fileName = getReadableFileName(safeFiles, fileId);
      const record = await idbGetFile(fileId);
      if (!record?.bytes) {
        throw new Error(`Missing file bytes for ${fileName} (${fileId})`);
      }

      srcDoc = await PDFLib.PDFDocument.load(toUint8Array(record.bytes));
      sourceDocCache.set(fileId, srcDoc);
      sourceNameCache.set(fileId, fileName);
    }

    const pageIndex = toPageIndex(pageRef?.pageIndex);
    const pageCount = srcDoc.getPageCount();
    if (pageIndex < 0 || pageIndex >= pageCount) {
      const sourceName = sourceNameCache.get(fileId) || fileId;
      throw new Error(`Invalid page index ${pageIndex} for ${sourceName}`);
    }

    const [copiedPage] = await out.copyPages(srcDoc, [pageIndex]);
    const rotation = toRotation(pageRef?.rotation);
    if (rotation !== 0 && typeof copiedPage.setRotation === "function" && typeof PDFLib.degrees === "function") {
      copiedPage.setRotation(PDFLib.degrees(rotation));
    }
    out.addPage(copiedPage);
    if (shouldApplyWatermarkToPage(watermarkConfig, pageRef, outputIndex)) {
      if (watermarkConfig.mode === "text" && watermarkFont) {
        applyTextWatermarkToPage(copiedPage, watermarkConfig, watermarkFont, PDFLib);
      } else if (watermarkConfig.mode === "image" && watermarkImage) {
        applyImageWatermarkToPage(copiedPage, watermarkConfig, watermarkImage, PDFLib);
      }
    }
    if (headerFooterFont && shouldApplyHeaderFooterToPage(headerFooterConfig, pageRef, outputIndex)) {
      const sourceName = sourceNameCache.get(fileId) || getReadableFileName(safeFiles, fileId);
      applyHeaderFooterToPage({
        page: copiedPage,
        PDFLib,
        font: headerFooterFont,
        config: headerFooterConfig,
        pageNumber: outputIndex + 1,
        totalPages: safePageRefs.length,
        fileName: sourceName,
        outputFileName: headerFooterConfig.outputFileName,
      });
    }

    done += 1;
    if (progress) {
      progress({ done, total, message: `Added page ${done} of ${total}` });
    }
  }

  const bytes = await out.save();
  if (progress) {
    progress({
      done: total,
      total,
      message: total === 0 ? "No pages selected for export." : "Export complete.",
    });
  }
  return bytes;
}
