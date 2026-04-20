import { getPdfTextIndex } from "../formats/pdf/pdfjs-text.js";

const textDetectionQueue = new Set();
let isTextDetectionRunning = false;

let _getState = null;
let _dispatch = null;
let _isPreviewAvailable = () => true;

export function initTextDetectionQueue({ getState, dispatch, isPreviewAvailable }) {
  _getState = getState;
  _dispatch = dispatch;
  if (typeof isPreviewAvailable === "function") {
    _isPreviewAvailable = isPreviewAvailable;
  }
}

function getDetectedTextFilesMap(state) {
  if (!state?.ui?.textSearchDetectedFiles || typeof state.ui.textSearchDetectedFiles !== "object") {
    return {};
  }
  return state.ui.textSearchDetectedFiles;
}

export function getAvailableFileIdSet(state) {
  const files = Array.isArray(state?.files) ? state.files : [];
  return new Set(
    files
      .filter((file) => typeof file?.id === "string" && file.id)
      .map((file) => file.id),
  );
}

function getFileById(state, fileId) {
  const files = Array.isArray(state?.files) ? state.files : [];
  return files.find((file) => file?.id === fileId) ?? null;
}

function isTextDetectableFileRecord(fileRecord) {
  return Boolean(fileRecord) && fileRecord.sourceType !== "image";
}

export function queueTextDetectionForFiles(fileIds) {
  if (!_isPreviewAvailable() || !Array.isArray(fileIds) || fileIds.length === 0) {
    return;
  }

  const state = _getState();
  const detectedMap = getDetectedTextFilesMap(state);
  const availableIds = getAvailableFileIdSet(state);
  let nextDetectedMap = null;
  let detectedMapChanged = false;

  for (const fileId of fileIds) {
    if (typeof fileId !== "string" || !fileId || !availableIds.has(fileId)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(detectedMap, fileId)) {
      continue;
    }
    const fileRecord = getFileById(state, fileId);
    if (!isTextDetectableFileRecord(fileRecord)) {
      if (!nextDetectedMap) {
        nextDetectedMap = { ...detectedMap };
      }
      nextDetectedMap[fileId] = false;
      detectedMapChanged = true;
      continue;
    }
    textDetectionQueue.add(fileId);
  }

  if (detectedMapChanged && nextDetectedMap) {
    _dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          textSearchDetectedFiles: nextDetectedMap,
        },
      },
    });
  }

  if (textDetectionQueue.size === 0 || isTextDetectionRunning) {
    return;
  }

  void runQueuedTextDetection();
}

export function queueTextDetectionForUnknownFiles() {
  const state = _getState();
  const files = Array.isArray(state?.files) ? state.files : [];
  const detectedMap = getDetectedTextFilesMap(state);
  const unknownFileIds = files
    .map((file) => (typeof file?.id === "string" ? file.id : null))
    .filter((fileId) => typeof fileId === "string" && !Object.prototype.hasOwnProperty.call(detectedMap, fileId));
  queueTextDetectionForFiles(unknownFileIds);
}

async function runQueuedTextDetection() {
  if (isTextDetectionRunning) {
    return;
  }

  isTextDetectionRunning = true;
  try {
    while (textDetectionQueue.size > 0) {
      const iterator = textDetectionQueue.values().next();
      if (iterator.done) {
        break;
      }
      const fileId = iterator.value;
      textDetectionQueue.delete(fileId);

      const stateBefore = _getState();
      const availableBefore = getAvailableFileIdSet(stateBefore);
      if (!availableBefore.has(fileId)) {
        continue;
      }
      const detectedBefore = getDetectedTextFilesMap(stateBefore);
      if (Object.prototype.hasOwnProperty.call(detectedBefore, fileId)) {
        continue;
      }
      const fileBefore = getFileById(stateBefore, fileId);
      if (!isTextDetectableFileRecord(fileBefore)) {
        _dispatch({
          type: "UI_SET",
          payload: {
            patch: {
              textSearchDetectedFiles: {
                ...detectedBefore,
                [fileId]: false,
              },
            },
          },
        });
        continue;
      }

      let hasSearchableText = false;
      try {
        const textIndex = await getPdfTextIndex(fileId);
        hasSearchableText = Boolean(textIndex?.hasSearchableText);
      } catch {
        hasSearchableText = false;
      }

      const stateAfter = _getState();
      const availableAfter = getAvailableFileIdSet(stateAfter);
      if (!availableAfter.has(fileId)) {
        continue;
      }
      const detectedAfter = getDetectedTextFilesMap(stateAfter);
      if (Object.prototype.hasOwnProperty.call(detectedAfter, fileId)) {
        continue;
      }

      _dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            textSearchDetectedFiles: {
              ...detectedAfter,
              [fileId]: hasSearchableText,
            },
          },
        },
      });
    }
  } finally {
    isTextDetectionRunning = false;
    if (textDetectionQueue.size > 0) {
      void runQueuedTextDetection();
    }
  }
}
