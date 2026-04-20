import {
  buildPageRefsForFile,
  clampIndex,
  getAvailableFileIdSet,
  isPlainObject,
  mergeUiPatch,
  normalizeDocPlanIndices,
  normalizeQuarterTurnRotation,
  remapLastSelectedAfterMove,
  remapLastSelectedAfterRemovals,
  remapSelectionAfterMove,
  remapSelectionAfterRemovals,
  sanitizeImageImportDefaults,
  sanitizeHeaderFooterUi,
  sanitizeUiForSnapshot,
  sanitizeWatermarkUi,
  toInteger,
} from "./store-helpers.js";

const HISTORY_LIMIT = 100;
const TRACKED_ACTION_TYPES = new Set([
  "DOCPLAN_SET",
  "DOCPLAN_CLEAR",
  "DOCPLAN_APPEND_FILE",
  "DOCPLAN_APPEND_FILE_RANGE",
  "DOCPLAN_INSERT_FILE_AT",
  "DOCPLAN_REMOVE_INDICES",
  "DOCPLAN_REORDER",
  "DOCPLAN_ROTATE_INDICES",
  "DOCPLAN_SET_LOCK",
  "DOCPLAN_DELETE_SELECTED",
]);
const PERSISTED_MUTATION_ACTION_TYPES = new Set([
  "FILES_ADD_RECORDS",
  "FILES_REMOVE",
  "DOCPLAN_SET",
  "DOCPLAN_CLEAR",
  "DOCPLAN_APPEND_FILE",
  "DOCPLAN_APPEND_FILE_RANGE",
  "DOCPLAN_INSERT_FILE_AT",
  "DOCPLAN_REMOVE_INDICES",
  "DOCPLAN_REORDER",
  "DOCPLAN_ROTATE_INDICES",
  "DOCPLAN_SET_LOCK",
  "DOCPLAN_DELETE_SELECTED",
]);
const TRACKED_UI_KEYS = new Set([
  "exportMetadata",
  "watermark",
  "headerFooter",
]);

function createHistorySnapshot(state, label = null) {
  const ui = state.ui
    ? {
        ...state.ui,
        watermark: state.ui.watermark
          ? { ...state.ui.watermark, imageDataUrl: "" }
          : state.ui.watermark,
      }
    : state.ui;
  return {
    manifestVersion: state.manifestVersion,
    docPlan: state.docPlan,
    ui,
    label: typeof label === "string" && label.trim() ? label.trim() : null,
  };
}

function restoreStateFromSnapshot(currentState, snapshot) {
  const currentFiles = Array.isArray(currentState?.files) ? currentState.files : [];
  const availableFileIds = getAvailableFileIdSet(currentFiles);
  const snapshotDocPlan = Array.isArray(snapshot?.docPlan) ? snapshot.docPlan : currentState.docPlan;
  const filteredDocPlan = Array.isArray(snapshotDocPlan)
    ? snapshotDocPlan.filter((entry) => typeof entry?.fileId === "string" && availableFileIds.has(entry.fileId))
    : [];
  const nextUi = sanitizeUiForSnapshot(snapshot?.ui, currentFiles, filteredDocPlan);

  return {
    ...currentState,
    manifestVersion:
      typeof snapshot?.manifestVersion === "number"
        ? snapshot.manifestVersion
        : currentState.manifestVersion,
    docPlan: filteredDocPlan,
    ui: nextUi,
  };
}

function pushHistoryEntry(stack, entry) {
  stack.push(entry);
  if (stack.length > HISTORY_LIMIT) {
    stack.shift();
  }
}

function normalizeHistorySnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    return null;
  }

  if (!Array.isArray(snapshot.docPlan) || !isPlainObject(snapshot.ui)) {
    return null;
  }

  return {
    manifestVersion:
      typeof snapshot.manifestVersion === "number" ? snapshot.manifestVersion : undefined,
    docPlan: snapshot.docPlan,
    ui: snapshot.ui,
    label: typeof snapshot.label === "string" && snapshot.label.trim() ? snapshot.label.trim() : null,
  };
}

function normalizeHistoryList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const normalized = [];
  for (const item of list) {
    const snapshot = normalizeHistorySnapshot(item);
    if (snapshot) {
      normalized.push(snapshot);
    }
  }

  if (normalized.length <= HISTORY_LIMIT) {
    return normalized;
  }
  return normalized.slice(normalized.length - HISTORY_LIMIT);
}

function getUiPatchKeys(action) {
  const payload = isPlainObject(action?.payload) ? action.payload : {};
  const patch = payload.patch;
  if (!isPlainObject(patch)) {
    return [];
  }
  return Object.keys(patch);
}

function getUiHistoryLabel(action) {
  const keys = getUiPatchKeys(action);
  if (keys.includes("watermark")) {
    return "watermark settings";
  }
  if (keys.includes("headerFooter")) {
    return "header/footer settings";
  }
  if (keys.includes("exportMetadata")) {
    return "export metadata";
  }
  return "UI settings";
}

function getHistoryLabel(action) {
  if (!action || typeof action.type !== "string") {
    return "project update";
  }

  switch (action.type) {
    case "DOCPLAN_SET":
      return "output plan";
    case "DOCPLAN_CLEAR":
      return "clear output";
    case "DOCPLAN_APPEND_FILE":
      return "append file";
    case "DOCPLAN_APPEND_FILE_RANGE":
      return "append file range";
    case "DOCPLAN_INSERT_FILE_AT":
      return "insert file";
    case "DOCPLAN_REMOVE_INDICES":
      return "output page removal";
    case "DOCPLAN_REORDER":
      return "output reorder";
    case "DOCPLAN_ROTATE_INDICES":
      return "page rotation";
    case "DOCPLAN_SET_LOCK":
      return "page lock";
    case "DOCPLAN_DELETE_SELECTED":
      return "selected-page deletion";
    case "FILES_ADD_RECORDS":
      return "file import";
    case "FILES_REMOVE":
      return "file removal";
    case "UI_SET":
      return getUiHistoryLabel(action);
    default:
      return "project update";
  }
}

function shouldTrackAction(action) {
  if (!action || typeof action.type !== "string") {
    return false;
  }

  if (TRACKED_ACTION_TYPES.has(action.type)) {
    return true;
  }

  if (action.type !== "UI_SET") {
    return false;
  }

  const patchKeys = getUiPatchKeys(action);
  return patchKeys.some((key) => TRACKED_UI_KEYS.has(key));
}

function shouldClearRedoOnChange(action) {
  if (!action || typeof action.type !== "string") {
    return false;
  }
  return PERSISTED_MUTATION_ACTION_TYPES.has(action.type);
}

function withHistoryFlags(state, canUndo, canRedo, nextUndoLabel, nextRedoLabel) {
  const runtime = isPlainObject(state?.runtime) ? state.runtime : {};
  const current = isPlainObject(runtime.history) ? runtime.history : {};

  if (
    current.canUndo === canUndo &&
    current.canRedo === canRedo &&
    current.nextUndoLabel === nextUndoLabel &&
    current.nextRedoLabel === nextRedoLabel
  ) {
    return state;
  }

  return {
    ...state,
    runtime: {
      ...runtime,
      history: {
        ...current,
        canUndo,
        canRedo,
        nextUndoLabel,
        nextRedoLabel,
      },
    },
  };
}

function reduceState(state, action) {
  const payload = isPlainObject(action.payload) ? action.payload : {};

  switch (action.type) {
    case "MANIFEST_LOADED": {
      const nextFiles = Array.isArray(payload.files) ? payload.files : state.files;
      const nextDocPlan = Array.isArray(payload.docPlan) ? payload.docPlan : state.docPlan;
      const mergedUi = isPlainObject(payload.ui) ? mergeUiPatch(state.ui, payload.ui) : state.ui;
      return {
        manifestVersion:
          typeof payload.manifestVersion === "number" ? payload.manifestVersion : state.manifestVersion,
        files: nextFiles,
        docPlan: nextDocPlan,
        history: isPlainObject(payload.history) ? payload.history : state.history,
        ui: sanitizeUiForSnapshot(mergedUi, nextFiles, nextDocPlan),
        runtime: state.runtime,
      };
    }

    case "FILES_ADD_RECORDS": {
      const records = Array.isArray(payload.records) ? payload.records : [];
      if (records.length === 0) {
        return state;
      }

      const seenIds = new Set(state.files.map((record) => record?.id));
      const uniqueNewRecords = [];
      for (const record of records) {
        if (!record || typeof record.id !== "string" || seenIds.has(record.id)) {
          continue;
        }
        seenIds.add(record.id);
        uniqueNewRecords.push(record);
      }

      if (uniqueNewRecords.length === 0) {
        return state;
      }

      return {
        ...state,
        files: [...state.files, ...uniqueNewRecords],
      };
    }

    case "FILES_REMOVE": {
      const fileId = payload.fileId;
      if (typeof fileId !== "string") {
        return state;
      }

      const nextFiles = state.files.filter((record) => record?.id !== fileId);
      const nextDocPlan = state.docPlan.filter((entry) => entry?.fileId !== fileId);
      const selectedFileWasRemoved = state.ui?.selectedFileId === fileId;

      return {
        ...state,
        files: nextFiles,
        docPlan: nextDocPlan,
        ui: {
          ...state.ui,
          selectedFileId: selectedFileWasRemoved ? null : state.ui.selectedFileId,
          selectedSourcePageIndex: selectedFileWasRemoved ? 0 : state.ui.selectedSourcePageIndex,
          selectedSourcePageIndices: selectedFileWasRemoved ? [] : state.ui.selectedSourcePageIndices,
          lastSelectedSourcePageIndex: selectedFileWasRemoved ? null : state.ui.lastSelectedSourcePageIndex,
          selectedOutputPageIndices: [],
          lastSelectedOutputIndex: null,
          outputCursorIndex: clampIndex(toInteger(state.ui.outputCursorIndex, 0), 0, nextDocPlan.length),
        },
      };
    }

    case "DOCPLAN_SET": {
      return {
        ...state,
        docPlan: Array.isArray(payload.docPlan) ? payload.docPlan : state.docPlan,
      };
    }

    case "DOCPLAN_CLEAR": {
      return {
        ...state,
        docPlan: [],
        ui: {
          ...state.ui,
          selectedOutputPageIndices: [],
          lastSelectedOutputIndex: null,
          outputCursorIndex: 0,
        },
      };
    }

    case "DOCPLAN_APPEND_FILE": {
      const fileId = payload.fileId;
      if (typeof fileId !== "string") {
        return state;
      }

      const sourceFile = state.files.find((file) => file?.id === fileId);
      if (!sourceFile) {
        return state;
      }

      const appendedRefs = buildPageRefsForFile(sourceFile);
      if (appendedRefs.length === 0) {
        return state;
      }

      return {
        ...state,
        docPlan: [...state.docPlan, ...appendedRefs],
      };
    }

    case "DOCPLAN_APPEND_FILE_RANGE": {
      const fileId = payload.fileId;
      if (typeof fileId !== "string") {
        return state;
      }

      const sourceFile = state.files.find((file) => file?.id === fileId);
      if (!sourceFile) {
        return state;
      }

      const pageCount = Number.isFinite(sourceFile.pageCount) && sourceFile.pageCount > 0 ? sourceFile.pageCount : 0;
      if (pageCount <= 0) {
        return state;
      }

      const rawIndices = Array.isArray(payload.pageIndices) ? payload.pageIndices : [];
      const pageIndices = Array.from(
        new Set(rawIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount)),
      ).sort((a, b) => a - b);

      if (pageIndices.length === 0) {
        return state;
      }

      const nextRefs = pageIndices.map((pageIndex) => ({
        fileId,
        pageIndex,
        rotation: 0,
        locked: false,
      }));

      return {
        ...state,
        docPlan: [...state.docPlan, ...nextRefs],
      };
    }

    case "DOCPLAN_INSERT_FILE_AT": {
      const fileId = payload.fileId;
      if (typeof fileId !== "string") {
        return state;
      }

      const sourceFile = state.files.find((file) => file?.id === fileId);
      if (!sourceFile) {
        return state;
      }

      const insertedRefs = buildPageRefsForFile(sourceFile);
      if (insertedRefs.length === 0) {
        return state;
      }

      const insertRaw = toInteger(payload.atIndex, state.docPlan.length);
      const insertAt = clampIndex(insertRaw, 0, state.docPlan.length);
      const nextDocPlan = [...state.docPlan];
      nextDocPlan.splice(insertAt, 0, ...insertedRefs);

      return {
        ...state,
        docPlan: nextDocPlan,
        ui: {
          ...state.ui,
          outputCursorIndex: insertAt + insertedRefs.length,
        },
      };
    }

    case "DOCPLAN_REMOVE_INDICES": {
      const indicesInput = Array.isArray(payload.indices) ? payload.indices : [];
      if (indicesInput.length === 0 || state.docPlan.length === 0) {
        return state;
      }

      const uniqueIndices = Array.from(
        new Set(
          indicesInput.filter(
            (index) =>
              Number.isInteger(index) &&
              index >= 0 &&
              index < state.docPlan.length &&
              state.docPlan[index]?.locked !== true,
          ),
        ),
      ).sort((a, b) => b - a);

      if (uniqueIndices.length === 0) {
        return state;
      }

      const nextDocPlan = [...state.docPlan];
      for (const index of uniqueIndices) {
        nextDocPlan.splice(index, 1);
      }

      const nextSelection = remapSelectionAfterRemovals(
        state.ui?.selectedOutputPageIndices,
        uniqueIndices,
        state.docPlan.length,
        nextDocPlan.length,
      );
      const nextLastSelected = remapLastSelectedAfterRemovals(
        state.ui?.lastSelectedOutputIndex,
        uniqueIndices,
        state.docPlan.length,
        nextDocPlan.length,
      );

      return {
        ...state,
        docPlan: nextDocPlan,
        ui: {
          ...state.ui,
          selectedOutputPageIndices: nextSelection,
          lastSelectedOutputIndex: nextLastSelected,
          outputCursorIndex: clampIndex(toInteger(state.ui.outputCursorIndex, 0), 0, nextDocPlan.length),
        },
      };
    }

    case "DOCPLAN_REORDER": {
      const planLength = state.docPlan.length;
      if (planLength <= 1) {
        return state;
      }

      const fromRaw = payload.fromIndex;
      const toRaw = payload.toIndex;
      if (!Number.isInteger(fromRaw) || !Number.isInteger(toRaw)) {
        return state;
      }

      const fromIndex = clampIndex(fromRaw, 0, planLength - 1);
      const toIndex = clampIndex(toRaw, 0, planLength - 1);
      if (fromIndex === toIndex) {
        return state;
      }
      if (state.docPlan[fromIndex]?.locked === true) {
        return state;
      }

      const nextDocPlan = [...state.docPlan];
      const [moved] = nextDocPlan.splice(fromIndex, 1);
      if (!moved) {
        return state;
      }

      const insertAt = clampIndex(toIndex, 0, nextDocPlan.length);
      nextDocPlan.splice(insertAt, 0, moved);
      const nextSelection = remapSelectionAfterMove(
        state.ui?.selectedOutputPageIndices,
        fromIndex,
        insertAt,
        nextDocPlan.length,
      );
      const nextLastSelected = remapLastSelectedAfterMove(
        state.ui?.lastSelectedOutputIndex,
        fromIndex,
        insertAt,
        nextDocPlan.length,
      );

      return {
        ...state,
        docPlan: nextDocPlan,
        ui: {
          ...state.ui,
          selectedOutputPageIndices: nextSelection,
          lastSelectedOutputIndex: nextLastSelected,
        },
      };
    }

    case "DOCPLAN_ROTATE_INDICES": {
      const delta = payload.delta;
      if (delta !== 90 && delta !== -90) {
        return state;
      }

      const targetIndices = normalizeDocPlanIndices(payload.indices, state.docPlan.length);
      const unlockedTargetIndices = targetIndices.filter((index) => state.docPlan[index]?.locked !== true);
      if (unlockedTargetIndices.length === 0) {
        return state;
      }

      const targetSet = new Set(unlockedTargetIndices);
      const nextDocPlan = state.docPlan.map((entry, index) => {
        if (!targetSet.has(index)) {
          return entry;
        }

        const currentRotation = normalizeQuarterTurnRotation(entry?.rotation);
        const nextRotation = normalizeQuarterTurnRotation(currentRotation + delta);
        return {
          ...entry,
          rotation: nextRotation,
        };
      });

      return {
        ...state,
        docPlan: nextDocPlan,
      };
    }

    case "DOCPLAN_DELETE_SELECTED": {
      const targetIndices = normalizeDocPlanIndices(payload.indices, state.docPlan.length).sort((a, b) => b - a);
      const removableIndices = targetIndices.filter((index) => state.docPlan[index]?.locked !== true);
      if (removableIndices.length === 0) {
        return state;
      }

      const nextDocPlan = [...state.docPlan];
      for (const index of removableIndices) {
        nextDocPlan.splice(index, 1);
      }

      return {
        ...state,
        docPlan: nextDocPlan,
        ui: {
          ...state.ui,
          selectedOutputPageIndices: [],
          lastSelectedOutputIndex: null,
        },
      };
    }

    case "DOCPLAN_SET_LOCK": {
      const targetIndices = normalizeDocPlanIndices(payload.indices, state.docPlan.length);
      if (targetIndices.length === 0) {
        return state;
      }
      const locked = payload.locked === true;
      const targetSet = new Set(targetIndices);
      const nextDocPlan = state.docPlan.map((entry, index) => {
        if (!targetSet.has(index)) {
          return entry;
        }
        return {
          ...entry,
          locked,
        };
      });
      return {
        ...state,
        docPlan: nextDocPlan,
      };
    }

    case "UI_SET": {
      const nextUi = mergeUiPatch(state.ui, payload.patch);
      if (
        isPlainObject(payload.patch) &&
        Object.prototype.hasOwnProperty.call(payload.patch, "watermark")
      ) {
        nextUi.watermark = sanitizeWatermarkUi(nextUi.watermark);
      }
      if (
        isPlainObject(payload.patch) &&
        Object.prototype.hasOwnProperty.call(payload.patch, "imageImportDefaults")
      ) {
        nextUi.imageImportDefaults = sanitizeImageImportDefaults(nextUi.imageImportDefaults);
      }
      if (
        isPlainObject(payload.patch) &&
        Object.prototype.hasOwnProperty.call(payload.patch, "headerFooter")
      ) {
        nextUi.headerFooter = sanitizeHeaderFooterUi(nextUi.headerFooter);
      }
      return {
        ...state,
        ui: nextUi,
      };
    }

    case "RUNTIME_JOB_SET": {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          job: payload.job ?? null,
        },
      };
    }

    case "RUNTIME_JOB_CLEAR": {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          job: null,
        },
      };
    }

    case "RUNTIME_ERROR_SET": {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          lastError:
            typeof payload.error === "string" ? payload.error : String(payload.error ?? ""),
        },
      };
    }

    case "RUNTIME_ERROR_CLEAR": {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          lastError: null,
        },
      };
    }

    case "RUNTIME_BUSY_SET": {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          busy: Boolean(payload.busy),
        },
      };
    }

    default:
      return state;
  }
}

export function initStore({ initialState }) {
  let state = initialState;
  const historyPast = [];
  const historyFuture = [];
  const listeners = new Set();

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("subscribe(listener) expects a function");
    }
    listeners.add(listener);

    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  function emitChange() {
    for (const listener of listeners) {
      listener();
    }
  }

  function applyHistoryFlags(nextState) {
    const nextUndoLabel =
      historyPast.length > 0 && typeof historyPast[historyPast.length - 1]?.label === "string"
        ? historyPast[historyPast.length - 1].label
        : null;
    const nextRedoLabel =
      historyFuture.length > 0 && typeof historyFuture[historyFuture.length - 1]?.label === "string"
        ? historyFuture[historyFuture.length - 1].label
        : null;
    return withHistoryFlags(nextState, historyPast.length > 0, historyFuture.length > 0, nextUndoLabel, nextRedoLabel);
  }

  function hydrateHistoryFromState(nextState) {
    const persistedHistory = isPlainObject(nextState?.history) ? nextState.history : {};
    historyPast.length = 0;
    historyFuture.length = 0;
    historyPast.push(...normalizeHistoryList(persistedHistory.past));
    historyFuture.push(...normalizeHistoryList(persistedHistory.future));
  }

  function sameHistoryStack(stateStack, runtimeStack) {
    if (!Array.isArray(stateStack) || stateStack.length !== runtimeStack.length) {
      return false;
    }

    for (let index = 0; index < stateStack.length; index += 1) {
      if (stateStack[index] !== runtimeStack[index]) {
        return false;
      }
    }

    return true;
  }

  function applyPersistedHistory(nextState) {
    const currentHistory = isPlainObject(nextState?.history) ? nextState.history : {};
    const samePast = sameHistoryStack(currentHistory.past, historyPast);
    const sameFuture = sameHistoryStack(currentHistory.future, historyFuture);

    if (samePast && sameFuture) {
      return nextState;
    }

    return {
      ...nextState,
      history: {
        past: [...historyPast],
        future: [...historyFuture],
      },
    };
  }

  function applyHistoryState(nextState) {
    return applyPersistedHistory(applyHistoryFlags(nextState));
  }

  hydrateHistoryFromState(state);
  state = applyHistoryState(state);

  function runUndo() {
    if (Boolean(state?.runtime?.busy) || historyPast.length === 0) {
      state = applyHistoryState(state);
      emitChange();
      return;
    }

    const snapshot = historyPast.pop();
    const historyLabel = typeof snapshot?.label === "string" && snapshot.label ? snapshot.label : null;
    pushHistoryEntry(historyFuture, createHistorySnapshot(state, historyLabel));
    state = applyHistoryState(restoreStateFromSnapshot(state, snapshot));
    emitChange();
  }

  function runRedo() {
    if (Boolean(state?.runtime?.busy) || historyFuture.length === 0) {
      state = applyHistoryState(state);
      emitChange();
      return;
    }

    const snapshot = historyFuture.pop();
    const historyLabel = typeof snapshot?.label === "string" && snapshot.label ? snapshot.label : null;
    pushHistoryEntry(historyPast, createHistorySnapshot(state, historyLabel));
    state = applyHistoryState(restoreStateFromSnapshot(state, snapshot));
    emitChange();
  }

  function dispatch(action) {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      throw new TypeError("dispatch(action) expects an object with a string type");
    }

    if (action.type === "HISTORY_UNDO") {
      runUndo();
      return action;
    }

    if (action.type === "HISTORY_REDO") {
      runRedo();
      return action;
    }

    const prevState = state;
    const nextState = reduceState(prevState, action);

    if (action.type === "MANIFEST_LOADED") {
      hydrateHistoryFromState(nextState);
    }

    if (nextState !== prevState) {
      if (shouldTrackAction(action)) {
        pushHistoryEntry(historyPast, createHistorySnapshot(prevState, getHistoryLabel(action)));
        historyFuture.length = 0;
      } else if (shouldClearRedoOnChange(action)) {
        historyFuture.length = 0;
      }
    }

    state = applyHistoryState(nextState);
    emitChange();
    return action;
  }

  return {
    getState,
    subscribe,
    dispatch,
  };
}
