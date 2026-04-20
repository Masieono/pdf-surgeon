import { importPdfBytes } from "../pdf/import-pdf-bytes.js";

const DEFAULT_IMAGE_NAME = "image-import";
const EXIF_TAG_ORIENTATION = 0x0112;
const EXIF_TAG_EXIF_IFD_POINTER = 0x8769;
const EXIF_TAG_DATETIME_ORIGINAL = 0x9003;
const JPEG_SOI_MARKER = 0xffd8;

function toErrorMessage(errorLike) {
  if (errorLike instanceof Error) {
    return errorLike.message || errorLike.toString();
  }
  return String(errorLike ?? "Unknown error");
}

function getPdfLib() {
  if (typeof globalThis !== "object" || !globalThis || !globalThis.PDFLib) {
    throw new Error("pdf-lib is not available");
  }
  return globalThis.PDFLib;
}

function bytesToArrayBuffer(bytesLike) {
  if (bytesLike instanceof ArrayBuffer) {
    return bytesLike;
  }
  if (bytesLike instanceof Uint8Array) {
    return bytesLike.buffer.slice(bytesLike.byteOffset, bytesLike.byteOffset + bytesLike.byteLength);
  }
  throw new Error("Expected ArrayBuffer or Uint8Array");
}

function getSafeFileName(value, fallback = DEFAULT_IMAGE_NAME) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function toImageFileList(files) {
  const hasFileList = typeof FileList !== "undefined";
  const hasFile = typeof File !== "undefined";

  if (hasFileList && files instanceof FileList) {
    return hasFile
      ? Array.from(files).filter((file) => file instanceof File)
      : Array.from(files);
  }
  if (!Array.isArray(files)) {
    return [];
  }
  return hasFile
    ? files.filter((file) => file instanceof File)
    : files.filter((file) => file && typeof file === "object" && typeof file.arrayBuffer === "function");
}

function stripFileExtension(name) {
  return String(name ?? "").replace(/\.[^.]+$/g, "");
}

function buildCombinedImageImportName(files) {
  const safeFiles = toImageFileList(files);
  if (safeFiles.length === 0) {
    return "combined-images.pdf";
  }

  const firstName = getSafeFileName(safeFiles[0]?.name, "images");
  const firstBase = stripFileExtension(firstName).trim() || "images";
  if (safeFiles.length === 1) {
    return `${firstBase}.pdf`;
  }
  return `${firstBase} +${safeFiles.length - 1} images.pdf`;
}

function canRead(view, offset, length) {
  return offset >= 0 && length >= 0 && offset + length <= view.byteLength;
}

function isJpegImage({ mimeType, fileName }) {
  const safeType = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (safeType === "image/jpeg" || safeType === "image/jpg") {
    return true;
  }

  const safeName = typeof fileName === "string" ? fileName.toLowerCase() : "";
  return safeName.endsWith(".jpg") || safeName.endsWith(".jpeg");
}

function parseTiffContext(view, tiffOffset) {
  if (!canRead(view, tiffOffset, 8)) {
    return null;
  }

  const byteOrder = view.getUint16(tiffOffset, false);
  let littleEndian = false;
  if (byteOrder === 0x4949) {
    littleEndian = true;
  } else if (byteOrder !== 0x4d4d) {
    return null;
  }

  if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) {
    return null;
  }

  const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
  const firstIfdStart = tiffOffset + firstIfdOffset;
  if (!canRead(view, firstIfdStart, 2)) {
    return null;
  }

  return {
    littleEndian,
    firstIfdStart,
  };
}

function findIfdEntry(view, ifdStart, littleEndian, targetTag) {
  if (!canRead(view, ifdStart, 2)) {
    return null;
  }
  const entryCount = view.getUint16(ifdStart, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (!canRead(view, entryOffset, 12)) {
      break;
    }
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag !== targetTag) {
      continue;
    }
    return {
      entryOffset,
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      value: view.getUint32(entryOffset + 8, littleEndian),
    };
  }
  return null;
}

function readAsciiValue(view, offset, count) {
  if (!canRead(view, offset, count)) {
    return null;
  }
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, count);
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text.trim();
}

function parseTiffOrientation(view, tiffOffset) {
  if (!canRead(view, tiffOffset, 8)) {
    return null;
  }

  const byteOrder = view.getUint16(tiffOffset, false);
  let littleEndian = false;
  if (byteOrder === 0x4949) {
    littleEndian = true;
  } else if (byteOrder !== 0x4d4d) {
    return null;
  }

  if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002a) {
    return null;
  }

  const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
  const ifdStart = tiffOffset + ifdOffset;
  if (!canRead(view, ifdStart, 2)) {
    return null;
  }

  const entryCount = view.getUint16(ifdStart, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (!canRead(view, entryOffset, 12)) {
      break;
    }

    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag !== EXIF_TAG_ORIENTATION) {
      continue;
    }

    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    if (type !== 3 || count < 1) {
      return null;
    }

    let orientation = view.getUint16(entryOffset + 8, littleEndian);
    if (count > 1) {
      const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
      const valuePtr = tiffOffset + valueOffset;
      if (!canRead(view, valuePtr, 2)) {
        return null;
      }
      orientation = view.getUint16(valuePtr, littleEndian);
    }

    if (orientation >= 1 && orientation <= 8) {
      return orientation;
    }
    return null;
  }

  return null;
}

function findJpegExifSegment(bytes) {
  const view = new DataView(bytes);
  if (!canRead(view, 0, 2) || view.getUint16(0, false) !== JPEG_SOI_MARKER) {
    return null;
  }

  let offset = 2;
  while (canRead(view, offset, 4)) {
    if (view.getUint8(offset) !== 0xff) {
      break;
    }

    while (canRead(view, offset + 1, 1) && view.getUint8(offset + 1) === 0xff) {
      offset += 1;
    }

    const marker = view.getUint8(offset + 1);
    offset += 2;

    if (marker === 0xd8 || marker === 0x01) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (!canRead(view, offset, 2)) {
      break;
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || !canRead(view, offset, segmentLength)) {
      break;
    }

    if (marker === 0xe1 && segmentLength >= 8) {
      const exifOffset = offset + 2;
      if (
        canRead(view, exifOffset, 6) &&
        view.getUint8(exifOffset + 0) === 0x45 &&
        view.getUint8(exifOffset + 1) === 0x78 &&
        view.getUint8(exifOffset + 2) === 0x69 &&
        view.getUint8(exifOffset + 3) === 0x66 &&
        view.getUint8(exifOffset + 4) === 0x00 &&
        view.getUint8(exifOffset + 5) === 0x00
      ) {
        return { view, exifOffset };
      }
    }

    offset += segmentLength;
  }

  return null;
}

function getExifOrientationFromJpegBytes(bytes) {
  const segment = findJpegExifSegment(bytes);
  if (!segment) {
    return 1;
  }
  const orientation = parseTiffOrientation(segment.view, segment.exifOffset + 6);
  return orientation ?? 1;
}

function parseExifDateTimeOriginalFromSegment(view, tiffOffset) {
  const context = parseTiffContext(view, tiffOffset);
  if (!context) {
    return null;
  }

  const { littleEndian, firstIfdStart } = context;
  const exifPointerEntry = findIfdEntry(
    view,
    firstIfdStart,
    littleEndian,
    EXIF_TAG_EXIF_IFD_POINTER,
  );
  if (!exifPointerEntry || exifPointerEntry.type !== 4 || exifPointerEntry.count < 1) {
    return null;
  }

  const exifIfdStart = tiffOffset + exifPointerEntry.value;
  if (!canRead(view, exifIfdStart, 2)) {
    return null;
  }

  const dateEntry = findIfdEntry(
    view,
    exifIfdStart,
    littleEndian,
    EXIF_TAG_DATETIME_ORIGINAL,
  );
  if (!dateEntry || dateEntry.type !== 2 || dateEntry.count < 1) {
    return null;
  }

  const rawText = dateEntry.count <= 4
    ? readAsciiValue(view, dateEntry.entryOffset + 8, dateEntry.count)
    : readAsciiValue(view, tiffOffset + dateEntry.value, dateEntry.count);
  if (!rawText) {
    return null;
  }

  const match = rawText.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getExifDateTimeOriginalFromJpegBytes(bytes) {
  const segment = findJpegExifSegment(bytes);
  if (!segment) {
    return null;
  }
  const timestamp = parseExifDateTimeOriginalFromSegment(segment.view, segment.exifOffset + 6);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getImageCaptureTimestampFromBytes({
  bytes,
  mimeType,
  fileName,
  fallbackTimestamp = null,
} = {}) {
  if (!(bytes instanceof ArrayBuffer)) {
    return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : null;
  }

  if (!isJpegImage({ mimeType, fileName })) {
    return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : null;
  }

  const capturedAt = getExifDateTimeOriginalFromJpegBytes(bytes);
  if (Number.isFinite(capturedAt)) {
    return capturedAt;
  }

  return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : null;
}

function getOrientedCanvasSize(width, height, orientation) {
  const swapAxis = orientation >= 5 && orientation <= 8;
  return {
    canvasWidth: swapAxis ? height : width,
    canvasHeight: swapAxis ? width : height,
  };
}

function applyExifOrientationTransform(context, width, height, orientation) {
  switch (orientation) {
    case 2:
      context.setTransform(-1, 0, 0, 1, width, 0);
      return;
    case 3:
      context.setTransform(-1, 0, 0, -1, width, height);
      return;
    case 4:
      context.setTransform(1, 0, 0, -1, 0, height);
      return;
    case 5:
      context.setTransform(0, 1, 1, 0, 0, 0);
      return;
    case 6:
      context.setTransform(0, 1, -1, 0, height, 0);
      return;
    case 7:
      context.setTransform(0, -1, -1, 0, height, width);
      return;
    case 8:
      context.setTransform(0, -1, 1, 0, 0, width);
      return;
    default:
      context.setTransform(1, 0, 0, 1, 0, 0);
  }
}

async function loadImageElementFromBytes(bytes, mimeType) {
  if (typeof document === "undefined") {
    throw new Error("Image conversion requires a browser environment");
  }

  const safeMimeType = typeof mimeType === "string" && mimeType ? mimeType : "application/octet-stream";
  const blob = new Blob([bytes], { type: safeMimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode image"));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to encode image as PNG"));
          return;
        }
        resolve(result);
      },
      "image/png",
      1,
    );
  });

  return blob.arrayBuffer();
}

async function imageBytesToRasterPage({ imageBytes, mimeType, fileName }) {
  const image = await loadImageElementFromBytes(imageBytes, mimeType);
  const width = Math.max(1, Math.floor(image.naturalWidth || image.width || 1));
  const height = Math.max(1, Math.floor(image.naturalHeight || image.height || 1));

  if (mimeType === "image/png") {
    return { pngBytes: imageBytes, width, height };
  }

  const exifOrientation = isJpegImage({ mimeType, fileName })
    ? getExifOrientationFromJpegBytes(imageBytes)
    : 1;
  const { canvasWidth, canvasHeight } = getOrientedCanvasSize(width, height, exifOrientation);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create image conversion canvas");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  applyExifOrientationTransform(context, width, height, exifOrientation);
  context.drawImage(image, 0, 0, width, height);
  context.restore();

  const pngBytes = await canvasToPngBytes(canvas);
  return {
    pngBytes,
    width: canvasWidth,
    height: canvasHeight,
  };
}

async function rasterPagesToPdfBytes(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("No image pages to convert");
  }

  const { PDFDocument } = getPdfLib();
  const out = await PDFDocument.create();
  for (const pageSpec of pages) {
    const embeddedImage = await out.embedPng(pageSpec.pngBytes);
    const page = out.addPage([pageSpec.width, pageSpec.height]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pageSpec.width,
      height: pageSpec.height,
    });
  }

  return out.save();
}

export async function importImageFile(file, ctx = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Invalid image file input");
  }

  const imageBytes = await file.arrayBuffer();

  try {
    const rasterPage = await imageBytesToRasterPage({
      imageBytes,
      mimeType: file.type,
      fileName: file.name,
    });
    const pdfBytes = await rasterPagesToPdfBytes([rasterPage]);

    return importPdfBytes({
      bytes: bytesToArrayBuffer(pdfBytes),
      name: typeof file.name === "string" && file.name.trim() ? file.name.trim() : DEFAULT_IMAGE_NAME,
      sourceType: "image",
      badges: ["Imported from image"],
      ctx,
    });
  } catch (error) {
    throw new Error(`Image import failed: ${toErrorMessage(error)}`);
  }
}

export async function importImageFilesAsPdf(files, ctx = {}) {
  const safeFiles = toImageFileList(files);
  if (safeFiles.length === 0) {
    throw new Error("No image files provided");
  }

  if (safeFiles.length === 1) {
    return importImageFile(safeFiles[0], ctx);
  }

  const pages = [];
  for (const file of safeFiles) {
    try {
      const bytes = await file.arrayBuffer();
      const page = await imageBytesToRasterPage({
        imageBytes: bytes,
        mimeType: file.type,
        fileName: file.name,
      });
      pages.push(page);
    } catch (error) {
      throw new Error(`Image import failed for "${getSafeFileName(file?.name)}": ${toErrorMessage(error)}`);
    }
  }

  const pdfBytes = await rasterPagesToPdfBytes(pages);
  const importName = buildCombinedImageImportName(safeFiles);

  return importPdfBytes({
    bytes: bytesToArrayBuffer(pdfBytes),
    name: importName,
    sourceType: "image",
    badges: ["Imported from images", "Combined images"],
    ctx,
  });
}

export default importImageFile;
