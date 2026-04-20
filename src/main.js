import { createInitialState, LS_THEME_PREF_KEY } from "./config.js";
import { ensurePdfJsWorkerConfigured } from "./formats/pdf/pdfjs-setup.js";
import { importFiles } from "./formats/registry.js";
import { idbGetFile } from "./state/idb.js";
import { migrateManifest } from "./state/migrations.js";
import { loadManifest, installAutosave } from "./state/persistence.js";
import { initStore } from "./state/store.js";
import {
  initTextDetectionQueue,
  queueTextDetectionForFiles,
  queueTextDetectionForUnknownFiles,
  getAvailableFileIdSet,
} from "./state/text-detection-queue.js";
import { initModals, showModal } from "./ui/components/modals.js";
import { initToasts, showToast } from "./ui/components/toasts.js";
import { renderAppShell } from "./ui/dom.js";
import { wireUiEvents } from "./ui/events.js";
import { getFileById } from "./ui/events/helpers.js";
import {
  captureFocusSnapshot,
  restoreFocusSnapshot,
  captureSourceFilmstripScrollSnapshot,
  persistSourceFilmstripScrollSnapshot,
  restoreSourceFilmstripScroll,
  captureOutputFilmstripScrollSnapshot,
  persistOutputFilmstripScrollSnapshot,
  restoreOutputFilmstripScroll,
  captureWindowScrollSnapshot,
  restoreWindowScrollSnapshot,
  captureSourceToolsDetailsOpenSnapshot,
  persistSourceToolsDetailsOpenSnapshot,
  restoreSourceToolsDetailsOpenSnapshot,
} from "./ui/scroll-state.js";

const PDF_PREVIEW_ERROR = "PDF.js failed to initialize. Check /vendor/pdfjs (pdf.mjs + pdf.worker.mjs).";
let isPdfPreviewAvailable = true;

function isValidThemePreference(theme) {
  return theme === "light" || theme === "dark" || theme === "system";
}

function getSystemTheme() {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readThemePreference() {
  try {
    const stored = localStorage.getItem(LS_THEME_PREF_KEY);
    return isValidThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function toReadableError(errorLike) {
  if (errorLike instanceof Error) {
    return errorLike.message || errorLike.toString();
  }
  if (typeof errorLike === "string") {
    return errorLike;
  }
  try {
    return JSON.stringify(errorLike);
  } catch {
    return String(errorLike ?? "Unexpected error");
  }
}

function applyThemeFromState() {
  const resolvedPreference = readThemePreference();
  const resolvedTheme = resolvedPreference === "system" ? getSystemTheme() : resolvedPreference;
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.documentElement.setAttribute("data-theme-pref", resolvedPreference);
  return resolvedTheme;
}

function applyPreviewUnavailableUi() {
  if (isPdfPreviewAvailable) {
    return;
  }

  const previewSection = document.querySelector('[data-preview-stage="review"]');
  if (!(previewSection instanceof HTMLElement)) {
    return;
  }

  previewSection.querySelector(".thumb-grid")?.remove();
  previewSection.querySelector(".source-filmstrip")?.remove();
  previewSection.querySelector(".source-page-controls")?.remove();

  for (const subtitle of previewSection.querySelectorAll(".section-subtitle")) {
    if (subtitle.textContent?.trim() === "Pages") {
      subtitle.remove();
    }
  }

  let messageEl = previewSection.querySelector("[data-preview-unavailable]");
  if (!(messageEl instanceof HTMLElement)) {
    messageEl = document.createElement("div");
    messageEl.setAttribute("data-preview-unavailable", "true");
    messageEl.className = "muted";
    messageEl.textContent = "PDF preview unavailable. Check /vendor/pdfjs (pdf.mjs + pdf.worker.mjs).";
    const divider = previewSection.querySelector(".divider");
    if (divider?.nextSibling) {
      previewSection.insertBefore(messageEl, divider.nextSibling);
    } else {
      previewSection.appendChild(messageEl);
    }
  }
}

async function reconcileManifestWithIdb() {
  const state = store.getState();
  const files = Array.isArray(state?.files) ? state.files : [];
  if (files.length === 0) {
    return;
  }

  let missingFileIds = [];

  try {
    const results = await Promise.all(
      files.map(async (file) => {
        const fileId = typeof file?.id === "string" ? file.id : null;
        if (!fileId) return null;
        const stored = await idbGetFile(fileId);
        return stored?.bytes ? null : fileId;
      }),
    );
    missingFileIds = results.filter(Boolean);
  } catch (error) {
    const message = "IndexedDB failed while verifying saved files.";
    store.dispatch({
      type: "RUNTIME_ERROR_SET",
      payload: { error: message },
    });
    showToast({
      type: "error",
      title: "Storage error",
      message: `${message} Refresh the page or clear the project if problems persist.`,
      timeoutMs: 4200,
    });
    console.error("[startup] idb verification failed", error);
    return;
  }

  if (missingFileIds.length === 0) {
    return;
  }

  for (const fileId of missingFileIds) {
    store.dispatch({
      type: "FILES_REMOVE",
      payload: { fileId },
    });
  }

  const currentState = store.getState();
  if (
    currentState?.ui?.selectedFileId &&
    !currentState.files.some((file) => file?.id === currentState.ui.selectedFileId)
  ) {
    store.dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          selectedFileId: null,
          selectedSourcePageIndex: 0,
        },
      },
    });
  }

  showToast({
    type: "warning",
    title: "Recovered project",
    message: `Removed ${missingFileIds.length} file record${missingFileIds.length === 1 ? "" : "s"} with missing bytes.`,
    timeoutMs: 4200,
  });
}

const initial = createInitialState();
const store = initStore({ initialState: initial });

const raw = loadManifest();
const migrated = migrateManifest(raw);
if (migrated) {
  store.dispatch({ type: "MANIFEST_LOADED", payload: migrated });
}

installAutosave(store);
initTextDetectionQueue({
  getState: () => store.getState(),
  dispatch: (action) => store.dispatch(action),
  isPreviewAvailable: () => isPdfPreviewAvailable,
});

function renderFromState() {
  const state = store.getState();
  const windowScrollSnapshot = captureWindowScrollSnapshot();
  const sourceScrollSnapshot = captureSourceFilmstripScrollSnapshot();
  persistSourceFilmstripScrollSnapshot(sourceScrollSnapshot);
  const outputScrollSnapshot = captureOutputFilmstripScrollSnapshot();
  persistOutputFilmstripScrollSnapshot(outputScrollSnapshot);
  const sourceToolsDetailsSnapshot = captureSourceToolsDetailsOpenSnapshot();
  persistSourceToolsDetailsOpenSnapshot(sourceToolsDetailsSnapshot);
  const focusSnapshot = captureFocusSnapshot();
  applyThemeFromState();
  renderAppShell(state);
  initToasts(document.body);
  initModals(document.getElementById("modal-root"));
  applyPreviewUnavailableUi();
  restoreSourceFilmstripScroll(state);
  restoreOutputFilmstripScroll();
  restoreSourceToolsDetailsOpenSnapshot();
  restoreFocusSnapshot(focusSnapshot);
  restoreWindowScrollSnapshot(windowScrollSnapshot);
}

async function runPdfJsHealthCheck() {
  try {
    await ensurePdfJsWorkerConfigured();
  } catch (error) {
    isPdfPreviewAvailable = false;
    store.dispatch({
      type: "RUNTIME_ERROR_SET",
      payload: { error: PDF_PREVIEW_ERROR },
    });
    showToast({
      type: "error",
      title: "PDF Preview Unavailable",
      message:
        "PDF.js failed to initialize. Verify vendor/pdfjs contains pdf.mjs and pdf.worker.mjs.",
    });
    renderFromState();
    console.error("[pdfjs] initialization failed", error);
  }
}

renderFromState();
void (async () => {
  await reconcileManifestWithIdb();
  await runPdfJsHealthCheck();
  queueTextDetectionForUnknownFiles();
})();
store.subscribe(() => {
  renderFromState();
});

wireUiEvents({
  getState: store.getState,
  dispatch: store.dispatch,
  onImportFiles: async (files, options = {}) => {
    try {
      const beforeState = store.getState();
      const beforeFileIds = getAvailableFileIdSet(beforeState);

      await importFiles(files, {
        dispatch: store.dispatch,
        showToast,
        showModal,
        imageImportMode: options?.imageImportMode === "combine" ? "combine" : "separate",
        imageImportOrder:
          options?.imageImportOrder === "filename_asc" ||
          options?.imageImportOrder === "filename_desc" ||
          options?.imageImportOrder === "capture_time_asc"
            ? options.imageImportOrder
            : "as_selected",
        skipDuplicateImages: options?.skipDuplicateImages === true,
        autoAppendImportedImages: options?.autoAppendImportedImages === true,
      });

      const afterState = store.getState();
      const afterFileIds = getAvailableFileIdSet(afterState);
      const newFileIds = Array.from(afterFileIds).filter((fileId) => !beforeFileIds.has(fileId));
      queueTextDetectionForFiles(newFileIds);

      if (options?.autoAppendImportedImages === true && newFileIds.length > 0) {
        for (const fileId of newFileIds) {
          const fileRecord = getFileById(afterState, fileId);
          if (!fileRecord || fileRecord.sourceType !== "image") {
            continue;
          }
          store.dispatch({
            type: "DOCPLAN_APPEND_FILE",
            payload: { fileId },
          });
        }
      }

    } catch (error) {
      const message = toReadableError(error);
      store.dispatch({
        type: "RUNTIME_ERROR_SET",
        payload: { error: message },
      });
      showToast({
        type: "error",
        title: "Import failed",
        message,
        timeoutMs: 2600,
      });
      console.error("[import] failed", error);
    }
  },
});

function isExpectedBackgroundError(errorLike) {
  const name = String(errorLike?.name ?? "");
  const message = String(errorLike?.message ?? errorLike ?? "").toLowerCase();
  // PDF.js cancels in-flight renders when pages scroll out of view — not a real error.
  return name === "RenderingCancelledException" || message.includes("rendering cancelled");
}

window.addEventListener("error", (event) => {
  if (isExpectedBackgroundError(event.error ?? event.message)) {
    return;
  }
  store.dispatch({
    type: "RUNTIME_ERROR_SET",
    payload: { error: toReadableError(event.error ?? event.message) },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  if (isExpectedBackgroundError(event.reason)) {
    event.preventDefault();
    return;
  }
  store.dispatch({
    type: "RUNTIME_ERROR_SET",
    payload: { error: toReadableError(event.reason) },
  });
});

if (typeof window.matchMedia === "function") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    if (readThemePreference() === "system") {
      applyThemeFromState();
      renderFromState();
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(handleSystemThemeChange);
  }
}

window.addEventListener("beforeunload", (event) => {
  const state = store.getState();
  const hasActiveJob = Boolean(state?.runtime?.busy) || Boolean(state?.runtime?.job);
  if (!hasActiveJob) {
    return;
  }

  event.preventDefault();
  event.returnValue = "An import or export is still running. Leaving now may interrupt it.";
});
