import { LS_MANIFEST_KEY, AUTOSAVE_DEBOUNCE_MS, MANIFEST_VERSION } from "../config.js";
import { isPlainObject } from "./store-helpers.js";
import { showToast } from "../ui/components/toasts.js";

function debounce(fn, waitMs) {
  let timerId = null;

  const debounced = (...args) => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      timerId = null;
      fn(...args);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced;
}

export function loadManifest() {
  let raw = null;
  try {
    raw = localStorage.getItem(LS_MANIFEST_KEY);
  } catch {
    return null;
  }

  if (raw == null) {
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  if (typeof parsed.manifestVersion !== "number" || Number.isNaN(parsed.manifestVersion)) {
    return null;
  }

  return parsed;
}

let _quotaToastShown = false;

export function saveManifest(manifest) {
  try {
    localStorage.setItem(LS_MANIFEST_KEY, JSON.stringify(manifest));
    _quotaToastShown = false;
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    if (isQuota && !_quotaToastShown) {
      _quotaToastShown = true;
      showToast({
        type: "warning",
        title: "Storage full",
        message: "Project autosave failed — browser storage is full. Export your work to avoid losing changes.",
        timeoutMs: 8000,
      });
    }
  }
}

export function getPersistedSubset(state) {
  const safeState = isPlainObject(state) ? state : {};
  const safeHistory = isPlainObject(safeState.history) ? safeState.history : {};

  return {
    manifestVersion:
      typeof safeState.manifestVersion === "number" ? safeState.manifestVersion : MANIFEST_VERSION,
    files: Array.isArray(safeState.files) ? safeState.files : [],
    docPlan: Array.isArray(safeState.docPlan) ? safeState.docPlan : [],
    history: {
      past: Array.isArray(safeHistory.past) ? safeHistory.past : [],
      future: Array.isArray(safeHistory.future) ? safeHistory.future : [],
    },
    ui: isPlainObject(safeState.ui) ? safeState.ui : {},
  };
}

export function installAutosave(store) {
  const saveDebounced = debounce(() => {
    const state = store.getState();
    const manifest = getPersistedSubset(state);
    saveManifest(manifest);
  }, AUTOSAVE_DEBOUNCE_MS);

  const unsubscribe = store.subscribe(() => {
    saveDebounced();
  });

  return function uninstall() {
    unsubscribe();
    saveDebounced.cancel();
  };
}
