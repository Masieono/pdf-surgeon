import { DEFAULT_HEADER_FOOTER, DEFAULT_WATERMARK, LS_MANIFEST_KEY } from "../config.js";
import { idbClearAll, idbDeleteFile } from "../state/idb.js";
import {
  clearThumbCacheForFile,
  renderThumbnailToCanvas,
} from "../formats/pdf/pdfjs-renderer.js";
import { releasePdfDoc } from "../formats/pdf/pdfjs-docs.js";
import { exportPdfFromDocPlan, exportPdfFromPageRefs } from "../formats/pdf/pdflib-export.js";
import { parsePageRanges, parseRangeGroups } from "../formats/pdf/page-ranges.js";
import {
  findTextMatchStats,
  getPdfTextIndex,
  normalizeSearchQuery,
  clearPdfTextIndex,
} from "../formats/pdf/pdfjs-text.js";
import { importPdfBytes } from "../formats/pdf/import-pdf-bytes.js";
import { showModal } from "./components/modals.js";
import { showToast } from "./components/toasts.js";
import { openWatermarkModal } from "./modals/watermark.js";
import { openReorderModal } from "./modals/reorder.js";
import { openAppendFileRangeModal } from "./modals/append-range.js";
import { openOutputSourceFilterModal } from "./modals/source-filter.js";
import { openDeleteSelectedModal, openDeleteByRangeModal } from "./modals/delete-confirm.js";
import { openExportMetadataModal } from "./modals/export-metadata.js";
import { openSplitOutputModal } from "./modals/split-output.js";
import { openHeaderFooterModal } from "./modals/header-footer.js";
import {
  DEFAULT_WATERMARK_TEXT,
  applyTheme,
  buildBlankPageName,
  buildDownloadNamePlan,
  cancelActiveJob,
  clamp,
  clearActiveJobCanceler,
  clearTimelineDropPosition,
  createJobId,
  cycleThemePreference,
  defaultRotationForWatermarkPosition,
  downloadPdfBytes,
  drawWatermarkOnCanvas,
  escapeHtml,
  focusTimelineIndex,
  getDetectedTextFilesMap,
  getEdgeTimelineDropTarget,
  getFileById,
  getFileDisplayName,
  getMaxPageIndex,
  getMaxSourcePageNumber,
  getSelectedFile,
  getTextMatchCounts,
  getTextQuery,
  getThumbWidth,
  getTimelineThumbWidth,
  getUnlockedOutputIndices,
  isExpectedTextSearchError,
  isImageCandidateFile,
  isOutputIndexLocked,
  isSameDocPlanOrder,
  normalizeImageImportAutoAppendSetting,
  normalizeImageImportModeSetting,
  normalizeImageImportOrderSetting,
  normalizeImageImportSkipDuplicatesSetting,
  normalizeOutputFindMode,
  normalizeOutputSelection,
  normalizeSourcePageSelection,
  normalizeThemePreference,
  normalizeWatermarkFontSizePct,
  normalizeWatermarkImageFit,
  normalizeWatermarkMode,
  normalizeWatermarkPosition,
  normalizeWatermarkSizeMode,
  normalizeWatermarkState,
  normalizeWatermarkTarget,
  parseLookupPageRanges,
  parseNonNegativeInt,
  promptImageImportOptions,
  readThemePreference,
  sampleCanvasDarkPixelCount,
  setActiveJobCanceler,
  setTimelineDropPosition,
  setTimelineDropPositionByEdge,
  shouldApplyWatermarkToOutputIndex,
  stripPdfExtension,
  surfaceRuntimeError,
  toErrorMessage,
  toFileArray,
  updateThemeButtonLabel,
  warnIfLargeOutputPlan,
  writeThemePreference,
} from "./events/helpers.js";

export function wireUiEvents({ getState, dispatch, onImportFiles } = {}) {
  const appRoot = document.getElementById("app");
  if (!appRoot) {
    return;
  }

  const dispatchUiPatch = (patch) => {
    if (!dispatch) {
      return;
    }
    dispatch({
      type: "UI_SET",
      payload: { patch },
    });
  };

  const setSourceSelection = ({
    fileId,
    pageIndex,
    selectedPageIndices,
    lastSelectedPageIndex,
    activeView = "sources",
  }) => {
    const safePageIndex = Number.isFinite(pageIndex) ? pageIndex : 0;
    const safeSelected =
      Array.isArray(selectedPageIndices) && selectedPageIndices.length > 0
        ? selectedPageIndices
        : [safePageIndex];
    dispatchUiPatch({
      selectedFileId: fileId ?? null,
      selectedSourcePageIndex: safePageIndex,
      selectedSourcePageIndices: safeSelected,
      lastSelectedSourcePageIndex:
        Number.isInteger(lastSelectedPageIndex) && lastSelectedPageIndex >= 0
          ? lastSelectedPageIndex
          : safePageIndex,
      activeView,
    });
  };

  let renderWorkQueued = false;
  let thumbObserver = null;
  let timelineThumbObserver = null;
  let timelineThumbRenderChain = Promise.resolve();
  let timelineThumbRenderGeneration = 0;
  let lastSourceThumbSelectionKey = "";
  let lastOutputFilmstripSelectionKey = "";
  let pendingOutputViewportScrollLeft = null;
  let draggedPlanIndex = null;
  let draggedPlanSelectionIndices = null;
  let activeDropIndicatorItem = null;

  const disconnectThumbObserver = () => {
    if (!thumbObserver) {
      return;
    }
    thumbObserver.disconnect();
    thumbObserver = null;
  };

  const disconnectTimelineThumbObserver = () => {
    if (!timelineThumbObserver) {
      return;
    }
    timelineThumbObserver.disconnect();
    timelineThumbObserver = null;
  };

  const clearTimelineDragState = () => {
    draggedPlanIndex = null;
    draggedPlanSelectionIndices = null;
    activeDropIndicatorItem = null;
    for (const node of document.querySelectorAll(".timeline-item.dragover, .timeline-item.dragging, .timeline-item.drop-before, .timeline-item.drop-after")) {
      node.classList.remove("dragover", "dragging", "drop-before", "drop-after");
    }
  };

  const resetTimelineThumbRenderQueue = () => {
    timelineThumbRenderGeneration += 1;
    timelineThumbRenderChain = Promise.resolve();
  };

  const centerFilmstripItemIfNeeded = (viewport, item) => {
    if (!(viewport instanceof HTMLElement) || !(item instanceof HTMLElement)) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const viewportCenterX = viewportRect.left + viewportRect.width / 2;
    const itemCenterX = itemRect.left + itemRect.width / 2;
    const delta = itemCenterX - viewportCenterX;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const targetLeft = clamp(viewport.scrollLeft + delta, 0, maxScrollLeft);
    if (Math.abs(targetLeft - viewport.scrollLeft) <= 1) {
      return;
    }
    viewport.scrollTo({
      left: targetLeft,
      behavior: "smooth",
    });
  };

  const captureOutputViewportScrollLeft = () => {
    const viewport = appRoot.querySelector("[data-output-filmstrip-viewport]");
    if (!(viewport instanceof HTMLElement)) {
      pendingOutputViewportScrollLeft = null;
      return;
    }
    pendingOutputViewportScrollLeft = viewport.scrollLeft;
  };

  const restoreOutputViewportScrollLeftIfNeeded = () => {
    if (!Number.isFinite(pendingOutputViewportScrollLeft)) {
      pendingOutputViewportScrollLeft = null;
      return;
    }
    const viewport = appRoot.querySelector("[data-output-filmstrip-viewport]");
    if (viewport instanceof HTMLElement) {
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      viewport.scrollLeft = clamp(pendingOutputViewportScrollLeft, 0, maxScrollLeft);
    }
    pendingOutputViewportScrollLeft = null;
  };

  const getSettingsControls = () => {
    const button = appRoot.querySelector('[data-ui-action="toggle-settings-menu"]');
    const menu = appRoot.querySelector('[data-role="settings-menu"]');
    return {
      button: button instanceof HTMLButtonElement ? button : null,
      menu: menu instanceof HTMLElement ? menu : null,
    };
  };

  const isSettingsMenuOpen = () => {
    const { menu } = getSettingsControls();
    return Boolean(menu && !menu.hidden && menu.classList.contains("is-open"));
  };

  const closeSettingsMenu = () => {
    const { button, menu } = getSettingsControls();
    if (menu) {
      menu.classList.remove("is-open");
      menu.hidden = true;
    }
    if (button) {
      button.setAttribute("aria-expanded", "false");
    }
  };

  const openSettingsMenu = () => {
    const { button, menu } = getSettingsControls();
    updateThemeButtonLabel(appRoot);
    if (menu) {
      menu.hidden = false;
      menu.classList.add("is-open");
    }
    if (button) {
      button.setAttribute("aria-expanded", "true");
    }
  };

  const toggleSettingsMenu = () => {
    if (isSettingsMenuOpen()) {
      closeSettingsMenu();
      return;
    }
    openSettingsMenu();
  };

  const markActiveTimelineHover = (timelineItem) => {
    if (!(timelineItem instanceof HTMLElement)) {
      return;
    }
    for (const node of document.querySelectorAll(".timeline-item.dragover")) {
      if (node !== timelineItem) {
        node.classList.remove("dragover");
      }
    }
    timelineItem.classList.add("dragover");
  };

  const clearActiveDropIndicator = () => {
    if (activeDropIndicatorItem instanceof HTMLElement) {
      clearTimelineDropPosition(activeDropIndicatorItem);
    }
    activeDropIndicatorItem = null;
  };

  const setActiveDropIndicatorFromPointer = (timelineItem, clientX, clientY) => {
    if (!(timelineItem instanceof HTMLElement)) {
      return;
    }
    if (activeDropIndicatorItem instanceof HTMLElement && activeDropIndicatorItem !== timelineItem) {
      clearTimelineDropPosition(activeDropIndicatorItem);
    }
    activeDropIndicatorItem = timelineItem;
    setTimelineDropPosition(timelineItem, clientX, clientY);
  };

  const setActiveDropIndicatorByEdge = (timelineItem, edge) => {
    if (!(timelineItem instanceof HTMLElement)) {
      return;
    }
    if (activeDropIndicatorItem instanceof HTMLElement && activeDropIndicatorItem !== timelineItem) {
      clearTimelineDropPosition(activeDropIndicatorItem);
    }
    activeDropIndicatorItem = timelineItem;
    setTimelineDropPositionByEdge(timelineItem, edge);
  };

  const paintThumbnail = async (canvas, fileId, attempt = 0) => {
    if (!(canvas instanceof HTMLCanvasElement) || typeof getState !== "function") {
      return;
    }

    const state = getState();
    const selectedFile = getSelectedFile(state);
    if (!selectedFile?.id || selectedFile.id !== fileId) {
      return;
    }

    const pageIndex = Number.parseInt(canvas.dataset.pageIndex || "", 10);
    if (!Number.isFinite(pageIndex)) {
      return;
    }

    const maxPageIndex = getMaxPageIndex(selectedFile);
    if (pageIndex < 0 || pageIndex > maxPageIndex) {
      return;
    }

    try {
      const rendered = await renderThumbnailToCanvas({
        fileId,
        pageIndex,
        thumbWidthPx: getThumbWidth(canvas),
        rotation: 0,
        canvas,
      });
      if (!rendered && attempt < 2 && canvas.isConnected) {
        await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 60));
        await paintThumbnail(canvas, fileId, attempt + 1);
      }
    } catch (error) {
      console.error("[thumb] failed", error);
    }
  };

  const paintTimelineThumbnail = async (canvas, attempt = 0) => {
    if (!(canvas instanceof HTMLCanvasElement) || typeof getState !== "function") {
      return;
    }

    const state = getState();
    const fileId = typeof canvas.dataset.fileId === "string" ? canvas.dataset.fileId : "";
    if (!fileId) {
      return;
    }

    const pageIndex = Number.parseInt(canvas.dataset.pageIndex || "", 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return;
    }

    const rotation = Number.parseInt(canvas.dataset.rotation || "0", 10);
    const safeRotation = Number.isInteger(rotation) ? rotation : 0;
    const fileRecord = Array.isArray(state?.files)
      ? state.files.find((file) => file?.id === fileId) ?? null
      : null;
    try {
      const rendered = await renderThumbnailToCanvas({
        fileId,
        pageIndex,
        thumbWidthPx: getTimelineThumbWidth(canvas),
        rotation: safeRotation,
        canvas,
      });
      if (!rendered) {
        canvas.dataset.thumbPainted = "0";
        if (attempt < 2 && canvas.isConnected) {
          await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 80));
          await paintTimelineThumbnail(canvas, attempt + 1);
        }
        return;
      }
      canvas.dataset.thumbPainted = "1";
      const shouldValidateBlank = fileRecord?.sourceType === "image" && attempt < 1;
      const pixelSample = shouldValidateBlank ? sampleCanvasDarkPixelCount(canvas) : null;

      const isLikelyBlank =
        shouldValidateBlank &&
        pixelSample != null &&
        pixelSample.sampledPixels > 0 &&
        pixelSample.darkPixels === 0;
      if (isLikelyBlank && canvas.isConnected) {
        canvas.dataset.thumbPainted = "0";
        clearThumbCacheForFile(fileId);
        await releasePdfDoc(fileId);
        await new Promise((resolve) => setTimeout(resolve, 60));
        await paintTimelineThumbnail(canvas, attempt + 1);
        return;
      }

      const row = canvas.closest(".timeline-item[data-plan-index]");
      const outputIndex = parseNonNegativeInt(row?.getAttribute("data-plan-index"));
      if (outputIndex == null) {
        return;
      }

      const outputPageCount = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
      const watermark = normalizeWatermarkState(state?.ui?.watermark, outputPageCount);
      const selectedOutputIndices = normalizeOutputSelection(
        state?.ui?.selectedOutputPageIndices,
        outputPageCount,
      );
      if (!shouldApplyWatermarkToOutputIndex(watermark, outputIndex, selectedOutputIndices, outputPageCount)) {
        return;
      }

      await drawWatermarkOnCanvas(canvas, watermark);
    } catch (error) {
      canvas.dataset.thumbPainted = "0";
      console.error("[timeline-thumb] failed", error);
    }
  };

  const enqueueTimelineThumbnailPaint = (canvas) => {
    const generation = timelineThumbRenderGeneration;
    timelineThumbRenderChain = timelineThumbRenderChain
      .then(async () => {
        if (generation !== timelineThumbRenderGeneration) {
          return;
        }
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
          return;
        }
        await paintTimelineThumbnail(canvas);
      })
      .catch((error) => {
        console.error("[timeline-thumb][queue] failed", error);
      });
  };

  const setupThumbnailObserver = () => {
    if (typeof getState !== "function") {
      disconnectThumbObserver();
      return;
    }

    const state = getState();
    const selectedFile = getSelectedFile(state);
    if (!selectedFile?.id) {
      disconnectThumbObserver();
      return;
    }

    const canvases = Array.from(document.querySelectorAll(".thumb-canvas")).filter(
      (node) => node instanceof HTMLCanvasElement && node.dataset.fileId === selectedFile.id,
    );

    disconnectThumbObserver();

    if (canvases.length === 0) {
      return;
    }

    const selectedIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
      ? clamp(state.ui.selectedSourcePageIndex, 0, getMaxPageIndex(selectedFile))
      : 0;
    const eagerCanvases = [];
    const deferredCanvases = [];
    for (const canvas of canvases) {
      const pageIndex = Number.parseInt(canvas.dataset.pageIndex || "", 10);
      if (Number.isInteger(pageIndex) && Math.abs(pageIndex - selectedIndex) <= 2) {
        eagerCanvases.push(canvas);
      } else {
        deferredCanvases.push(canvas);
      }
    }

    if (typeof IntersectionObserver !== "function") {
      for (const canvas of eagerCanvases) {
        void paintThumbnail(canvas, selectedFile.id);
      }
      for (const canvas of deferredCanvases) {
        void paintThumbnail(canvas, selectedFile.id);
      }
      return;
    }

    for (const canvas of eagerCanvases) {
      void paintThumbnail(canvas, selectedFile.id);
    }

    const rootViewport = document.querySelector("[data-source-filmstrip-viewport]");
    const observerRoot = rootViewport instanceof HTMLElement ? rootViewport : null;

    thumbObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          observer.unobserve(entry.target);
          void paintThumbnail(entry.target, selectedFile.id);
        }
      },
      {
        root: observerRoot,
        rootMargin: observerRoot ? "0px 280px 0px 280px" : "240px 0px",
        threshold: 0.01,
      },
    );

    for (const canvas of deferredCanvases) {
      thumbObserver.observe(canvas);
    }
  };

  const setupTimelineThumbnailObserver = () => {
    if (typeof getState !== "function") {
      disconnectTimelineThumbObserver();
      return;
    }

    const canvases = Array.from(document.querySelectorAll(".timeline-thumb-canvas")).filter(
      (node) => node instanceof HTMLCanvasElement,
    );

    disconnectTimelineThumbObserver();
    resetTimelineThumbRenderQueue();

    if (canvases.length === 0) {
      return;
    }

    const outputViewport = document.querySelector("[data-output-filmstrip-viewport]");
    const observerRoot = outputViewport instanceof HTMLElement ? outputViewport : null;
    const rootRect = observerRoot?.getBoundingClientRect() ?? null;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const eagerMarginPx = 320;
    const eagerCanvases = [];
    const deferredCanvases = [];
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect();
      const intersectsViewportBand = rootRect
        ? rect.right >= rootRect.left - 180 && rect.left <= rootRect.right + 180
        : rect.bottom >= -eagerMarginPx && rect.top <= viewportHeight + eagerMarginPx;
      if (intersectsViewportBand || eagerCanvases.length < 6) {
        eagerCanvases.push(canvas);
      } else {
        deferredCanvases.push(canvas);
      }
    }

    for (const canvas of eagerCanvases) {
      void paintTimelineThumbnail(canvas);
    }
    if (typeof IntersectionObserver !== "function") {
      for (const canvas of deferredCanvases) {
        enqueueTimelineThumbnailPaint(canvas);
      }
      return;
    }

    timelineThumbObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          observer.unobserve(entry.target);
          enqueueTimelineThumbnailPaint(entry.target);
        }
      },
      {
        root: observerRoot,
        rootMargin: observerRoot ? "0px 220px 0px 220px" : "200px 0px",
        threshold: 0.01,
      },
    );

    for (const canvas of deferredCanvases) {
      timelineThumbObserver.observe(canvas);
    }

    // Safety sweep: if an observed canvas never intersected, still paint it.
    window.setTimeout(() => {
      const generation = timelineThumbRenderGeneration;
      for (const canvas of deferredCanvases) {
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
          continue;
        }
        if (canvas.dataset.thumbPainted === "1") {
          continue;
        }
        if (generation !== timelineThumbRenderGeneration) {
          return;
        }
        enqueueTimelineThumbnailPaint(canvas);
      }
    }, 1200);
  };

  const queueRenderWork = () => {
    if (renderWorkQueued) {
      return;
    }

    renderWorkQueued = true;
    requestAnimationFrame(() => {
      renderWorkQueued = false;
      setupThumbnailObserver();
      setupTimelineThumbnailObserver();
      restoreOutputViewportScrollLeftIfNeeded();
      if (typeof getState === "function") {
        const state = getState();
        const selectedFileId = typeof state?.ui?.selectedFileId === "string" ? state.ui.selectedFileId : "";
        const selectedPageIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
          ? state.ui.selectedSourcePageIndex
          : 0;
        const selectionKey = `${selectedFileId}:${selectedPageIndex}`;
        if (selectionKey !== lastSourceThumbSelectionKey) {
          lastSourceThumbSelectionKey = selectionKey;
          const selectedThumb = document.querySelector(".source-filmstrip .thumb-tile.selected");
          const viewport = document.querySelector("[data-source-filmstrip-viewport]");
          centerFilmstripItemIfNeeded(viewport, selectedThumb);
        }

        const outputSelection = normalizeOutputSelection(
          state?.ui?.selectedOutputPageIndices,
          Array.isArray(state?.docPlan) ? state.docPlan.length : 0,
        );
        const outputSelectionKey = outputSelection.join(",");
        if (outputSelectionKey !== lastOutputFilmstripSelectionKey) {
          lastOutputFilmstripSelectionKey = outputSelectionKey;
          const anchorIndex = Number.parseInt(String(state?.ui?.lastSelectedOutputIndex ?? ""), 10);
          const selectedTimelineItem = Number.isInteger(anchorIndex)
            ? appRoot.querySelector(`.timeline-list-filmstrip .timeline-item[data-plan-index="${anchorIndex}"]`)
            : appRoot.querySelector(".timeline-list-filmstrip .timeline-item.selected");
          const outputViewport = appRoot.querySelector("[data-output-filmstrip-viewport]");
          centerFilmstripItemIfNeeded(outputViewport, selectedTimelineItem);
        }
      }
      syncSourceFilmstripNavState();
      syncOutputFilmstripNavState();
    });
  };

  const scrollSourceFilmstripBy = (direction) => {
    const viewport = document.querySelector("[data-source-filmstrip-viewport]");
    if (!(viewport instanceof HTMLElement)) {
      return;
    }
    const delta = Math.max(120, Math.round(viewport.clientWidth * 0.72));
    viewport.scrollBy({
      left: direction > 0 ? delta : -delta,
      behavior: "smooth",
    });
  };

  const scrollOutputFilmstripBy = (direction) => {
    const viewport = document.querySelector("[data-output-filmstrip-viewport]");
    if (!(viewport instanceof HTMLElement)) {
      return;
    }
    const delta = Math.max(120, Math.round(viewport.clientWidth * 0.72));
    viewport.scrollBy({
      left: direction > 0 ? delta : -delta,
      behavior: "smooth",
    });
  };

  const syncSourceFilmstripNavState = () => {
    const viewport = appRoot.querySelector("[data-source-filmstrip-viewport]");
    const prevBtn = appRoot.querySelector('[data-ui-action="source-filmstrip-prev"]');
    const nextBtn = appRoot.querySelector('[data-ui-action="source-filmstrip-next"]');
    const prev = prevBtn instanceof HTMLButtonElement ? prevBtn : null;
    const next = nextBtn instanceof HTMLButtonElement ? nextBtn : null;

    if (!(viewport instanceof HTMLElement)) {
      if (prev) {
        prev.disabled = true;
      }
      if (next) {
        next.disabled = true;
      }
      return;
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const canScroll = maxScrollLeft > 1;
    const atStart = viewport.scrollLeft <= 1;
    const atEnd = viewport.scrollLeft >= maxScrollLeft - 1;

    if (prev) {
      prev.disabled = !canScroll || atStart;
    }
    if (next) {
      next.disabled = !canScroll || atEnd;
    }
  };

  const syncOutputFilmstripNavState = () => {
    const viewport = appRoot.querySelector("[data-output-filmstrip-viewport]");
    const prevBtn = appRoot.querySelector('[data-ui-action="output-filmstrip-prev"]');
    const nextBtn = appRoot.querySelector('[data-ui-action="output-filmstrip-next"]');
    const prev = prevBtn instanceof HTMLButtonElement ? prevBtn : null;
    const next = nextBtn instanceof HTMLButtonElement ? nextBtn : null;

    if (!(viewport instanceof HTMLElement)) {
      if (prev) {
        prev.disabled = true;
      }
      if (next) {
        next.disabled = true;
      }
      return;
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const canScroll = maxScrollLeft > 1;
    const atStart = viewport.scrollLeft <= 1;
    const atEnd = viewport.scrollLeft >= maxScrollLeft - 1;

    if (prev) {
      prev.disabled = !canScroll || atStart;
    }
    if (next) {
      next.disabled = !canScroll || atEnd;
    }
  };

  const clearSourceSelection = () => {
    if (!dispatch || typeof getState !== "function") {
      return;
    }

    const state = getState();
    if (!state?.ui?.selectedFileId) {
      return;
    }

    dispatchUiPatch({
      selectedFileId: null,
      selectedSourcePageIndex: 0,
      selectedSourcePageIndices: [],
      lastSelectedSourcePageIndex: null,
      activeView: "sources",
    });
  };


  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => {
      queueRenderWork();
    });
    observer.observe(appRoot, { childList: true });
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isSettingsMenuOpen()) {
        return;
      }
      const { button, menu } = getSettingsControls();
      const target = event.target;
      if (!(target instanceof Node)) {
        closeSettingsMenu();
        return;
      }
      if (menu?.contains(target) || button?.contains(target)) {
        return;
      }
      closeSettingsMenu();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (isSettingsMenuOpen()) {
      closeSettingsMenu();
      return;
    }

    closeSettingsMenu();
    if (document.querySelector(".modal-backdrop")) {
      return;
    }

    const reviewSection = appRoot.querySelector('[data-preview-stage="review"]');
    const active = document.activeElement;
    if (
      reviewSection instanceof HTMLElement &&
      active instanceof Node &&
      reviewSection.contains(active)
    ) {
      clearSourceSelection();
    }
  });

  appRoot.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.matches("[data-source-filmstrip-viewport]")) {
        syncSourceFilmstripNavState();
        return;
      }
      if (target.matches("[data-output-filmstrip-viewport]")) {
        syncOutputFilmstripNavState();
      }
    },
    true,
  );

  appRoot.addEventListener(
    "wheel",
    (event) => {
      const viewport =
        event.target instanceof Element
          ? event.target.closest("[data-source-filmstrip-viewport], [data-output-filmstrip-viewport]")
          : null;
      if (!(viewport instanceof HTMLElement)) {
        return;
      }
      const isSourceViewport = viewport.matches("[data-source-filmstrip-viewport]");
      if (viewport.scrollWidth <= viewport.clientWidth + 1) {
        if (isSourceViewport) {
          syncSourceFilmstripNavState();
        } else {
          syncOutputFilmstripNavState();
        }
        return;
      }

      const dominantDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!Number.isFinite(dominantDelta) || Math.abs(dominantDelta) < 0.01) {
        return;
      }

      viewport.scrollLeft += dominantDelta;
      if (isSourceViewport) {
        syncSourceFilmstripNavState();
      } else {
        syncOutputFilmstripNavState();
      }
      event.preventDefault();
    },
    { passive: false },
  );

  const runImportHook = async (files) => {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    const stateAtStart = typeof getState === "function" ? getState() : null;
    const defaultImportMode = normalizeImageImportModeSetting(stateAtStart?.ui?.imageImportDefaults?.mode);
    const defaultImportOrder = normalizeImageImportOrderSetting(stateAtStart?.ui?.imageImportDefaults?.order);
    const defaultSkipDuplicates = normalizeImageImportSkipDuplicatesSetting(
      stateAtStart?.ui?.imageImportDefaults?.skipDuplicates,
    );
    const defaultAutoAppendToOutput = normalizeImageImportAutoAppendSetting(
      stateAtStart?.ui?.imageImportDefaults?.autoAppendToOutput,
    );
    let imageImportMode = defaultImportMode;
    let imageImportOrder = defaultImportOrder;
    let skipDuplicateImages = defaultSkipDuplicates;
    let autoAppendImportedImages = defaultAutoAppendToOutput;
    const imageFileCount = files.filter((file) => isImageCandidateFile(file)).length;
    if (imageFileCount > 1) {
      const selectedOptions = await promptImageImportOptions(imageFileCount, {
        mode: defaultImportMode,
        order: defaultImportOrder,
        skipDuplicates: defaultSkipDuplicates,
        autoAppendToOutput: defaultAutoAppendToOutput,
      });
      if (!selectedOptions) {
        return;
      }
      imageImportMode = normalizeImageImportModeSetting(selectedOptions.mode);
      imageImportOrder = normalizeImageImportOrderSetting(selectedOptions.order);
      skipDuplicateImages = normalizeImageImportSkipDuplicatesSetting(selectedOptions.skipDuplicates);
      autoAppendImportedImages = normalizeImageImportAutoAppendSetting(selectedOptions.autoAppendToOutput);
      if (dispatch) {
        dispatch({
          type: "UI_SET",
          payload: {
            patch: {
              imageImportDefaults: {
                mode: imageImportMode,
                order: imageImportOrder,
                skipDuplicates: skipDuplicateImages,
                autoAppendToOutput: autoAppendImportedImages,
              },
            },
          },
        });
      }
    }

    if (typeof onImportFiles === "function") {
      await onImportFiles(files, {
        imageImportMode,
        imageImportOrder,
        skipDuplicateImages,
        autoAppendImportedImages,
      });
    }
  };

  const readTextQueryFromInput = (inputId, fallback = "") => {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      return input.value;
    }
    return fallback;
  };

  const syncTextQueryState = (rawQuery) => {
    if (!dispatch) {
      return;
    }

    const normalized = normalizeSearchQuery(rawQuery);
    if (!normalized) {
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            textQuery: "",
            textMatchQuery: "",
            textMatchCounts: {},
            textMatchOccurrences: {},
          },
        },
      });
      return;
    }

    dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          textQuery: rawQuery,
        },
      },
    });
  };

  const runTextSearchAcrossFiles = async (query) => {
    if (!dispatch || typeof getState !== "function") {
      throw new Error("Text search is unavailable.");
    }

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) {
      throw new Error("Enter text to search.");
    }

    const state = getState();
    const allFiles = Array.isArray(state?.files)
      ? state.files.filter((file) => typeof file?.id === "string" && file.id)
      : [];
    const detectedTextFiles = { ...getDetectedTextFilesMap(state) };
    if (allFiles.length === 0) {
      throw new Error("Import at least one file first.");
    }
    const files = allFiles.filter((file) => file?.sourceType !== "image");
    for (const file of allFiles) {
      if (file?.sourceType !== "image") {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(detectedTextFiles, file.id)) {
        detectedTextFiles[file.id] = false;
      }
    }
    if (files.length === 0) {
      throw new Error("No text-searchable PDF sources available.");
    }
    if (state?.runtime?.busy) {
      throw new Error("Another job is already running.");
    }

    let cancelled = false;
    const jobId = createJobId();
    const startedAtMs = Date.now();
    setActiveJobCanceler(() => {
      cancelled = true;
    });

    dispatch({
      type: "RUNTIME_BUSY_SET",
      payload: { busy: true },
    });
    dispatch({ type: "RUNTIME_ERROR_CLEAR" });
    dispatch({
      type: "RUNTIME_JOB_SET",
      payload: {
        job: {
          id: jobId,
          type: "other",
          stage: "indexing_text",
          progress: { done: 0, total: files.length },
          etaSeconds: null,
          canCancel: true,
          message: "Preparing text search...",
        },
      },
    });

    const counts = {};
    const occurrences = {};
    const matchesByFile = new Map();
    let searchableFileCount = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        if (cancelled) {
          throw new Error("Text search cancelled");
        }

        const file = files[index];
        const elapsedSec = (Date.now() - startedAtMs) / 1000;
        const done = index;
        const etaSeconds = done > 0 ? Math.max(0, Math.round((elapsedSec / done) * (files.length - done))) : null;

        dispatch({
          type: "RUNTIME_JOB_SET",
          payload: {
            job: {
              id: jobId,
              type: "other",
              stage: "indexing_text",
              progress: { done, total: files.length },
              etaSeconds,
              canCancel: true,
              message: `Scanning ${file.name || file.originalName || "file"} (${index + 1}/${files.length})...`,
            },
          },
        });

        const textIndex = await getPdfTextIndex(file.id, {
          isCancelled: () => cancelled,
        });

        if (textIndex.hasSearchableText) {
          searchableFileCount += 1;
        }
        detectedTextFiles[file.id] = Boolean(textIndex.hasSearchableText);

        const matchStats = findTextMatchStats(textIndex, normalizedQuery);
        matchesByFile.set(file.id, matchStats.pageIndices);
        counts[file.id] = matchStats.pageCount;
        occurrences[file.id] = matchStats.totalMatches;

        dispatch({
          type: "RUNTIME_JOB_SET",
          payload: {
            job: {
              id: jobId,
              type: "other",
              stage: "indexing_text",
              progress: { done: index + 1, total: files.length },
              etaSeconds: null,
              canCancel: true,
              message: `Scanned ${file.name || file.originalName || "file"}: ${matchStats.totalMatches} matches`,
            },
          },
        });
      }

      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            textMatchQuery: normalizedQuery,
            textMatchCounts: counts,
            textMatchOccurrences: occurrences,
            textSearchDetectedFiles: detectedTextFiles,
          },
        },
      });

      return {
        normalizedQuery,
        counts,
        occurrences,
        matchesByFile,
        searchableFileCount,
      };
    } finally {
      clearActiveJobCanceler();
      dispatch({ type: "RUNTIME_JOB_CLEAR" });
      dispatch({
        type: "RUNTIME_BUSY_SET",
        payload: { busy: false },
      });
    }
  };

  const getOutputMatchIndices = (docPlan, matchesByFile) => {
    if (!Array.isArray(docPlan) || docPlan.length === 0) {
      return [];
    }

    const matchSetByFile = new Map();
    for (const [fileId, indices] of matchesByFile.entries()) {
      matchSetByFile.set(fileId, new Set(indices));
    }

    const outputIndices = [];
    for (let outputIndex = 0; outputIndex < docPlan.length; outputIndex += 1) {
      const pageRef = docPlan[outputIndex];
      const fileId = typeof pageRef?.fileId === "string" ? pageRef.fileId : "";
      const pageIndex = Number.parseInt(String(pageRef?.pageIndex ?? ""), 10);
      if (!fileId || !Number.isInteger(pageIndex)) {
        continue;
      }
      const matchSet = matchSetByFile.get(fileId);
      if (matchSet?.has(pageIndex)) {
        outputIndices.push(outputIndex);
      }
    }

    return outputIndices;
  };

  const applyOutputSelection = (indices) => {
    if (!dispatch) {
      return;
    }
    const safe = Array.isArray(indices)
      ? Array.from(new Set(indices.filter((index) => Number.isInteger(index) && index >= 0))).sort((a, b) => a - b)
      : [];
    dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          activeView: "output",
          selectedOutputPageIndices: safe,
          lastSelectedOutputIndex: safe.length > 0 ? safe[safe.length - 1] : null,
        },
      },
    });
    if (safe.length > 0) {
      focusTimelineIndex(safe[0]);
    }
  };

  appRoot.addEventListener("dragenter", (event) => {
    const dropzone = event.target instanceof Element ? event.target.closest("[data-dropzone]") : null;
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.add("dragover");
      return;
    }

    const timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;
    if (!timelineItem) {
      if (!Number.isInteger(draggedPlanIndex)) {
        return;
      }
      const edgeTarget = getEdgeTimelineDropTarget(event.clientX, event.clientY);
      if (!edgeTarget) {
        return;
      }
      event.preventDefault();
      markActiveTimelineHover(edgeTarget.item);
      setActiveDropIndicatorByEdge(edgeTarget.item, edgeTarget.edge);
      return;
    }

    event.preventDefault();
    markActiveTimelineHover(timelineItem);
    setActiveDropIndicatorFromPointer(timelineItem, event.clientX, event.clientY);
  });

  appRoot.addEventListener("dragover", (event) => {
    const dropzone = event.target instanceof Element ? event.target.closest("[data-dropzone]") : null;
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.add("dragover");
      return;
    }

    const timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;
    if (!timelineItem) {
      if (!Number.isInteger(draggedPlanIndex)) {
        return;
      }
      const edgeTarget = getEdgeTimelineDropTarget(event.clientX, event.clientY);
      if (!edgeTarget) {
        return;
      }
      event.preventDefault();
      markActiveTimelineHover(edgeTarget.item);
      setActiveDropIndicatorByEdge(edgeTarget.item, edgeTarget.edge);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      return;
    }

    event.preventDefault();
    markActiveTimelineHover(timelineItem);
    setActiveDropIndicatorFromPointer(timelineItem, event.clientX, event.clientY);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  appRoot.addEventListener("dragleave", (event) => {
    const dropzone = event.target instanceof Element ? event.target.closest("[data-dropzone]") : null;
    if (dropzone) {
      const related = event.relatedTarget;
      if (related instanceof Node && dropzone.contains(related)) {
        return;
      }

      dropzone.classList.remove("dragover");
      return;
    }

    const timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;
    if (!timelineItem) {
      return;
    }

    const related = event.relatedTarget;
    if (related instanceof Node && timelineItem.contains(related)) {
      return;
    }

    timelineItem.classList.remove("dragover");
    if (activeDropIndicatorItem === timelineItem) {
      clearActiveDropIndicator();
    } else {
      clearTimelineDropPosition(timelineItem);
    }
  });

  appRoot.addEventListener("drop", (event) => {
    const dropzone = event.target instanceof Element ? event.target.closest("[data-dropzone]") : null;
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      const files = toFileArray(event.dataTransfer?.files);
      void runImportHook(files);
      return;
    }

    let timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;

    if (!timelineItem) {
      if (activeDropIndicatorItem instanceof HTMLElement) {
        timelineItem = activeDropIndicatorItem;
      } else {
        const edgeTarget = getEdgeTimelineDropTarget(event.clientX, event.clientY);
        if (edgeTarget?.item) {
          timelineItem = edgeTarget.item;
          setTimelineDropPositionByEdge(timelineItem, edgeTarget.edge);
        }
      }
    }

    if (!timelineItem) {
      return;
    }

    event.preventDefault();
    for (const node of document.querySelectorAll(".timeline-item.dragover")) {
      node.classList.remove("dragover");
    }
    const hadDropAfter = timelineItem.classList.contains("drop-after");
    clearActiveDropIndicator();
    clearTimelineDropPosition(timelineItem);

    if (!dispatch) {
      clearTimelineDragState();
      return;
    }

    const targetIndex = parseNonNegativeInt(timelineItem.getAttribute("data-plan-index"));
    if (targetIndex == null) {
      clearTimelineDragState();
      return;
    }

    const stateAtDrop = typeof getState === "function" ? getState() : null;
    let fromIndex = draggedPlanIndex;
    if (!Number.isInteger(fromIndex) && event.dataTransfer) {
      fromIndex = parseNonNegativeInt(
        event.dataTransfer.getData("application/x-pdfsurgery-plan-index") ||
          event.dataTransfer.getData("text/plain"),
      );
    }

    if (!Number.isInteger(fromIndex)) {
      clearTimelineDragState();
      return;
    }

    const planLength =
      Array.isArray(stateAtDrop?.docPlan)
        ? stateAtDrop.docPlan.length
        : document.querySelectorAll(".timeline-item[data-plan-index]").length;
    if (!Number.isInteger(planLength) || planLength <= 1) {
      clearTimelineDragState();
      return;
    }

    const dropSlot = clamp(targetIndex + (hadDropAfter ? 1 : 0), 0, planLength);
    const dragSelection = normalizeOutputSelection(
      Array.isArray(draggedPlanSelectionIndices) ? draggedPlanSelectionIndices : [],
      planLength,
    );
    if (dragSelection.length > 1 && Array.isArray(stateAtDrop?.docPlan)) {
      const lockedDraggedIndices = dragSelection.filter((index) => isOutputIndexLocked(stateAtDrop, index));
      if (lockedDraggedIndices.length > 0) {
        showToast({
          type: "warning",
          title: "Pages are locked",
          message: "Unlock selected output pages before reordering.",
          timeoutMs: 2200,
        });
        clearTimelineDragState();
        return;
      }

      const selectedSet = new Set(dragSelection);
      const selectedItems = dragSelection.map((index) => stateAtDrop.docPlan[index]).filter(Boolean);
      if (selectedItems.length !== dragSelection.length) {
        clearTimelineDragState();
        return;
      }
      const remainingItems = stateAtDrop.docPlan.filter((_, index) => !selectedSet.has(index));
      const removedBeforeDrop = dragSelection.filter((index) => index < dropSlot).length;
      const insertAt = clamp(dropSlot - removedBeforeDrop, 0, remainingItems.length);
      const nextDocPlan = [
        ...remainingItems.slice(0, insertAt),
        ...selectedItems,
        ...remainingItems.slice(insertAt),
      ];

      if (isSameDocPlanOrder(nextDocPlan, stateAtDrop.docPlan)) {
        clearTimelineDragState();
        return;
      }

      const nextSelectedIndices = selectedItems.map((_, offset) => insertAt + offset);
      dispatch({
        type: "DOCPLAN_SET",
        payload: { docPlan: nextDocPlan },
      });
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            activeView: "output",
            selectedOutputPageIndices: nextSelectedIndices,
            lastSelectedOutputIndex: nextSelectedIndices[nextSelectedIndices.length - 1] ?? null,
          },
        },
      });
      clearTimelineDragState();
      return;
    }

    const toIndex = clamp(fromIndex < dropSlot ? dropSlot - 1 : dropSlot, 0, planLength - 1);
    if (toIndex === fromIndex) {
      clearTimelineDragState();
      return;
    }
    if (stateAtDrop && isOutputIndexLocked(stateAtDrop, fromIndex)) {
      showToast({
        type: "warning",
        title: "Page is locked",
        message: "Unlock this output page before reordering.",
        timeoutMs: 2200,
      });
      clearTimelineDragState();
      return;
    }

    dispatch({
      type: "DOCPLAN_REORDER",
      payload: { fromIndex, toIndex },
    });
    dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          activeView: "output",
          selectedOutputPageIndices: [toIndex],
          lastSelectedOutputIndex: toIndex,
        },
      },
    });
    clearTimelineDragState();
  });

  appRoot.addEventListener("dragstart", (event) => {
    const timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;
    if (!timelineItem) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("[data-action]")) {
      event.preventDefault();
      return;
    }

    const fromIndex = parseNonNegativeInt(timelineItem.getAttribute("data-plan-index"));
    if (fromIndex == null) {
      event.preventDefault();
      return;
    }
    if (timelineItem.getAttribute("data-locked") === "true") {
      event.preventDefault();
      showToast({
        type: "warning",
        title: "Page is locked",
        message: "Unlock this output page before dragging.",
        timeoutMs: 2200,
      });
      return;
    }

    if (typeof getState === "function") {
      const state = getState();
      const planLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
      const currentSelection = normalizeOutputSelection(state?.ui?.selectedOutputPageIndices, planLength);
      const dragSelection =
        currentSelection.includes(fromIndex) && currentSelection.length > 0 ? currentSelection : [fromIndex];
      const lockedDraggedIndices = dragSelection.filter((index) => isOutputIndexLocked(state, index));
      if (lockedDraggedIndices.length > 0) {
        event.preventDefault();
        showToast({
          type: "warning",
          title: "Pages are locked",
          message: "Unlock selected output pages before dragging.",
          timeoutMs: 2200,
        });
        return;
      }
      draggedPlanSelectionIndices = dragSelection;
    } else {
      draggedPlanSelectionIndices = [fromIndex];
    }

    draggedPlanIndex = fromIndex;
    clearActiveDropIndicator();
    timelineItem.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-pdfsurgery-plan-index", String(fromIndex));
      event.dataTransfer.setData("text/plain", String(fromIndex));
    }
  });

  appRoot.addEventListener("dragend", () => {
    clearTimelineDragState();
  });

  appRoot.addEventListener("change", (event) => {
    const target =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
        ? event.target
        : null;
    if (!target) {
      return;
    }

    const uiAction = target.getAttribute("data-ui-action");

    if (uiAction === "set-output-find-mode") {
      if (!dispatch) {
        return;
      }
      const nextMode = normalizeOutputFindMode(target.value);
      const state = typeof getState === "function" ? getState() : null;
      const existingSourceFileId =
        typeof state?.ui?.outputFindSourceFileId === "string" ? state.ui.outputFindSourceFileId : "";
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            outputFindMode: nextMode,
            outputFindSourceFileId: nextMode === "source_page" ? existingSourceFileId : "",
          },
        },
      });
      return;
    }

    if (uiAction === "set-output-find-source-file") {
      if (!dispatch) {
        return;
      }
      const nextSourceFileId = target.value || "";
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            outputFindSourceFileId: nextSourceFileId,
          },
        },
      });
      return;
    }

    if (!(target instanceof HTMLInputElement) || target.id !== "file-input") {
      return;
    }

    const files = toFileArray(target.files);
    void runImportHook(files);
    target.value = "";
  });

  appRoot.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) {
      return;
    }
    if (!details.matches('[data-role="output-tools-details"]')) {
      return;
    }
    if (!dispatch || typeof getState !== "function") {
      return;
    }
    const currentOpen = getState()?.ui?.outputToolsOpen === true;
    if (currentOpen === details.open) {
      return;
    }
    dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          outputToolsOpen: details.open,
        },
      },
    });
  }, true);

  appRoot.addEventListener("input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input) {
      return;
    }

    if (!dispatch) {
      return;
    }

    const uiAction = input.getAttribute("data-ui-action");
    if (uiAction !== "set-export-file-name") {
      return;
    }

    dispatch({
      type: "UI_SET",
      payload: {
        patch: {
          exportFileName: input.value,
        },
      },
    });
  });

  appRoot.addEventListener("click", (event) => {
    const actionTarget = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (actionTarget) {
      const action = actionTarget.getAttribute("data-action");

      if (action === "undo" || action === "redo") {
        event.stopPropagation();
        if (!dispatch) {
          return;
        }

        dispatch({
          type: action === "undo" ? "HISTORY_UNDO" : "HISTORY_REDO",
        });
        return;
      }

      if (action === "append-to-output") {
        event.stopPropagation();
        if (!dispatch) {
          return;
        }

        const fileId = actionTarget.getAttribute("data-file-id");
        if (!fileId) {
          return;
        }

        dispatch({
          type: "DOCPLAN_APPEND_FILE",
          payload: { fileId },
        });
        return;
      }

      if (action === "append-selected-file-range") {
        event.stopPropagation();
        if (typeof getState !== "function") {
          return;
        }
        const state = getState();
        const file = getSelectedFile(state);
        if (!file?.id) {
          return;
        }
        const currentIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
          ? state.ui.selectedSourcePageIndex
          : 0;
        const suggestedRange = String(clamp(currentIndex, 0, getMaxPageIndex(file)) + 1);
        openAppendFileRangeModal({ dispatch, getState }, file.id, suggestedRange);
        return;
      }

      if (action === "append-current-source-page") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }
        const state = getState();
        const file = getSelectedFile(state);
        if (!file?.id) {
          return;
        }
        const pageCount =
          Number.isFinite(file.pageCount) && file.pageCount > 0 ? file.pageCount : 1;
        const currentIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
          ? state.ui.selectedSourcePageIndex
          : 0;
        const pageIndex = clamp(currentIndex, 0, getMaxPageIndex(file));
        const selectedIndices = normalizeSourcePageSelection(state?.ui?.selectedSourcePageIndices, pageCount);
        const pageIndices = selectedIndices.length > 0 ? selectedIndices : [pageIndex];
        dispatch({
          type: "DOCPLAN_APPEND_FILE_RANGE",
          payload: {
            fileId: file.id,
            pageIndices,
          },
        });
        return;
      }

      if (
        action === "filter-output-all" ||
        action === "filter-output-rotated" ||
        action === "filter-output-source-picker"
      ) {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const state = getState();
        const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
        if (docPlan.length === 0) {
          return;
        }

        if (action === "filter-output-all") {
          applyOutputSelection(Array.from({ length: docPlan.length }, (_, index) => index));
          return;
        }

        if (action === "filter-output-rotated") {
          const rotatedIndices = docPlan
            .map((pageRef, index) => ({ index, rotation: Number.parseInt(String(pageRef?.rotation ?? "0"), 10) }))
            .filter((entry) => Number.isInteger(entry.rotation) && ((entry.rotation % 360) + 360) % 360 !== 0)
            .map((entry) => entry.index);
          if (rotatedIndices.length === 0) {
            showToast({
              type: "warning",
              title: "No rotated pages",
              message: "No output pages currently have a rotation.",
              timeoutMs: 2200,
            });
            return;
          }
          applyOutputSelection(rotatedIndices);
          return;
        }

        openOutputSourceFilterModal({ dispatch, getState, applyOutputSelection });
        return;
      }

      if (action === "find-source-text") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        void (async () => {
          try {
            const stateAtStart = getState();
            const query = readTextQueryFromInput("source-text-query", getTextQuery(stateAtStart));
            syncTextQueryState(query);
            const result = await runTextSearchAcrossFiles(query);

            const latestState = getState();
            const currentSelectedFileId = latestState?.ui?.selectedFileId;
            const currentSelectedSourcePageIndex = Number.isFinite(latestState?.ui?.selectedSourcePageIndex)
              ? latestState.ui.selectedSourcePageIndex
              : 0;
            let nextSelectedFileId = currentSelectedFileId ?? null;
            let nextSelectedSourcePageIndex = currentSelectedSourcePageIndex;

            const selectedMatches = currentSelectedFileId
              ? result.matchesByFile.get(currentSelectedFileId) ?? []
              : [];
            if (selectedMatches.length > 0) {
              nextSelectedSourcePageIndex = selectedMatches[0];
            } else {
              for (const [fileId, matches] of result.matchesByFile.entries()) {
                if (matches.length > 0) {
                  nextSelectedFileId = fileId;
                  nextSelectedSourcePageIndex = matches[0];
                  break;
                }
              }
            }

            dispatch({
              type: "UI_SET",
              payload: {
                patch: {
                  activeView: "sources",
                  selectedFileId: nextSelectedFileId,
                  selectedSourcePageIndex: nextSelectedSourcePageIndex,
                  selectedSourcePageIndices: [nextSelectedSourcePageIndex],
                  lastSelectedSourcePageIndex: nextSelectedSourcePageIndex,
                },
              },
            });

            const filesWithMatches = Object.values(result.counts).filter((count) => count > 0).length;
            const totalMatches = Object.values(result.occurrences).reduce((sum, count) => sum + count, 0);
            if (result.searchableFileCount === 0) {
              showToast({
                type: "warning",
                title: "No selectable text",
                message: "No selectable text found in imported files.",
                timeoutMs: 3600,
              });
              return;
            }

            showToast({
              type: filesWithMatches > 0 ? "success" : "warning",
              title: filesWithMatches > 0 ? "Text search complete" : "No text matches",
              message:
                filesWithMatches > 0
                  ? `${totalMatches} matches across ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}.`
                  : "No pages matched that text.",
              timeoutMs: 2800,
            });
          } catch (error) {
            const message = toErrorMessage(error, "Failed to search text");
            if (message.toLowerCase().includes("cancelled")) {
              showToast({
                type: "warning",
                title: "Text search cancelled",
                message: "Text indexing/search was cancelled.",
                timeoutMs: 2600,
              });
              return;
            }
            if (isExpectedTextSearchError(message)) {
              showToast({
                type: "warning",
                title: "Text search",
                message,
                timeoutMs: 2800,
              });
              return;
            }
            surfaceRuntimeError(dispatch, "Text search failed", message, 3600);
          }
        })();
        return;
      }

      if (action === "append-source-text-matches") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        void (async () => {
          try {
            const stateAtStart = getState();
            const query = readTextQueryFromInput("source-text-query", getTextQuery(stateAtStart));
            syncTextQueryState(query);
            const selectedFile = getSelectedFile(stateAtStart);
            if (!selectedFile?.id) {
              showToast({
                type: "warning",
                title: "Select a source file",
                message: "Choose a source file first, then append its text matches.",
                timeoutMs: 2800,
              });
              return;
            }

            const result = await runTextSearchAcrossFiles(query);
            const matches = result.matchesByFile.get(selectedFile.id) ?? [];
            if (matches.length === 0) {
              showToast({
                type: "warning",
                title: "No matches",
                message: `No text matches found in ${selectedFile.name || selectedFile.originalName || "selected file"}.`,
                timeoutMs: 2800,
              });
              return;
            }

            const latestState = getState();
            const currentPlan = Array.isArray(latestState?.docPlan) ? latestState.docPlan : [];
            const appendedRefs = matches.map((pageIndex) => ({
              fileId: selectedFile.id,
              pageIndex,
              rotation: 0,
            }));
            const nextDocPlan = [...currentPlan, ...appendedRefs];
            const firstInserted = currentPlan.length;
            const nextSelectedIndices = Array.from(
              { length: appendedRefs.length },
              (_, offset) => firstInserted + offset,
            );

            dispatch({
              type: "DOCPLAN_SET",
              payload: { docPlan: nextDocPlan },
            });
            dispatch({
              type: "UI_SET",
              payload: {
                patch: {
                  activeView: "output",
                  selectedOutputPageIndices: nextSelectedIndices,
                  lastSelectedOutputIndex: nextSelectedIndices[nextSelectedIndices.length - 1] ?? null,
                  outputCursorIndex: nextDocPlan.length,
                },
              },
            });

            showToast({
              type: "success",
              title: "Appended matches",
              message: `Added ${matches.length} matching page${matches.length === 1 ? "" : "s"} to output.`,
              timeoutMs: 2800,
            });
          } catch (error) {
            const message = toErrorMessage(error, "Failed to append text matches");
            if (message.toLowerCase().includes("cancelled")) {
              showToast({
                type: "warning",
                title: "Text search cancelled",
                message: "Text indexing/search was cancelled.",
                timeoutMs: 2600,
              });
              return;
            }
            if (isExpectedTextSearchError(message)) {
              showToast({
                type: "warning",
                title: "Text search",
                message,
                timeoutMs: 2800,
              });
              return;
            }
            surfaceRuntimeError(dispatch, "Append matches failed", message, 3600);
          }
        })();
        return;
      }

      if (
        action === "find-output-text" ||
        action === "keep-output-text-matches" ||
        action === "remove-output-text-matches" ||
        action === "export-output-text-matches"
      ) {
        event.stopPropagation();
        if (typeof getState !== "function") {
          return;
        }

        void (async () => {
          try {
            const initialState = getState();
            const query = readTextQueryFromInput("output-find-text", getTextQuery(initialState));
            syncTextQueryState(query);
            const result = await runTextSearchAcrossFiles(query);
            if (result.searchableFileCount === 0) {
              showToast({
                type: "warning",
                title: "No selectable text",
                message: "No selectable text found in imported files.",
                timeoutMs: 3600,
              });
              return;
            }

            const latestState = getState();
            const docPlan = Array.isArray(latestState?.docPlan) ? latestState.docPlan : [];
            if (docPlan.length === 0) {
              showToast({
                type: "warning",
                title: "Output is empty",
                message: "Add pages to output before running text-match actions.",
                timeoutMs: 2600,
              });
              return;
            }

            const matchedOutputIndices = getOutputMatchIndices(docPlan, result.matchesByFile);
            if (matchedOutputIndices.length === 0) {
              showToast({
                type: "warning",
                title: "No output matches",
                message: "No output pages matched that text query.",
                timeoutMs: 2800,
              });
              return;
            }

            if (!dispatch && action !== "export-output-text-matches") {
              return;
            }

            if (action === "find-output-text") {
              dispatch({
                type: "UI_SET",
                payload: {
                  patch: {
                    activeView: "output",
                    selectedOutputPageIndices: matchedOutputIndices,
                    lastSelectedOutputIndex: matchedOutputIndices[matchedOutputIndices.length - 1] ?? null,
                  },
                },
              });
              focusTimelineIndex(matchedOutputIndices[0] ?? 0);
              showToast({
                type: "success",
                title: "Output matches selected",
                message: `${matchedOutputIndices.length} output page${matchedOutputIndices.length === 1 ? "" : "s"} selected.`,
                timeoutMs: 2600,
              });
              return;
            }

            if (action === "export-output-text-matches") {
              const namePlan = buildDownloadNamePlan(latestState);
              const baseName = stripPdfExtension(namePlan.exportName) || "output";
              const fileName = `${baseName}-matches.pdf`;
              const pageRefs = matchedOutputIndices
                .map((index) => {
                  const pageRef = docPlan[index];
                  if (!pageRef || typeof pageRef.fileId !== "string") {
                    return null;
                  }
                  return {
                    fileId: pageRef.fileId,
                    pageIndex: pageRef.pageIndex,
                    rotation: pageRef.rotation,
                    sourceOutputIndex: index,
                  };
                })
                .filter(Boolean);

              const bytes = await exportPdfFromPageRefs({
                files: latestState.files,
                pageRefs,
                meta: latestState?.ui?.exportMetadata,
                watermark: {
                  ...(latestState?.ui?.watermark ?? {}),
                  selectedOutputPageIndices: latestState?.ui?.selectedOutputPageIndices,
                },
                headerFooter: {
                  ...(latestState?.ui?.headerFooter ?? {}),
                  selectedOutputPageIndices: latestState?.ui?.selectedOutputPageIndices,
                  outputPageCount: docPlan.length,
                  outputFileName: fileName,
                },
              });
              downloadPdfBytes(bytes, fileName);
              showToast({
                type: "success",
                title: "Export complete",
                message: `Downloaded ${fileName}`,
                timeoutMs: 2600,
              });
              return;
            }

            const matchedSet = new Set(matchedOutputIndices);
            const removalIndices =
              action === "keep-output-text-matches"
                ? docPlan
                    .map((_, index) => index)
                    .filter((index) => !matchedSet.has(index))
                : matchedOutputIndices;

            if (removalIndices.length === 0) {
              showToast({
                type: "warning",
                title: "Nothing to remove",
                message:
                  action === "keep-output-text-matches"
                    ? "All output pages already match the query."
                    : "No matching output pages to remove.",
                timeoutMs: 2400,
              });
              return;
            }

            const isKeepMode = action === "keep-output-text-matches";
            const title = isKeepMode ? "Keep Matching Pages" : "Remove Matching Pages";
            const body = isKeepMode
              ? `<p>Remove ${removalIndices.length} non-matching output page(s) and keep only matches?</p>`
              : `<p>Remove ${removalIndices.length} matching output page(s)?</p>`;
            const primaryText = isKeepMode ? "Keep Matches" : "Remove Matches";

            showModal({
              title,
              bodyHtml: body,
              primaryText,
              secondaryText: "Cancel",
              onPrimary: () => {
                dispatch({
                  type: "DOCPLAN_DELETE_SELECTED",
                  payload: { indices: removalIndices },
                });
                return true;
              },
              onSecondary: () => true,
            });
          } catch (error) {
            const message = toErrorMessage(error, "Failed to process text matches");
            if (message.toLowerCase().includes("cancelled")) {
              showToast({
                type: "warning",
                title: "Text search cancelled",
                message: "Text indexing/search was cancelled.",
                timeoutMs: 2600,
              });
              return;
            }
            if (isExpectedTextSearchError(message)) {
              showToast({
                type: "warning",
                title: "Text matches",
                message,
                timeoutMs: 2800,
              });
              return;
            }
            if (dispatch) {
              surfaceRuntimeError(dispatch, "Text match operation failed", message, 3600);
            } else {
              showToast({
                type: "error",
                title: "Text match operation failed",
                message,
                timeoutMs: 3200,
              });
            }
          }
        })();
        return;
      }

      if (action === "insert-file-advanced") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const fileId = actionTarget.getAttribute("data-file-id");
        if (!fileId) {
          return;
        }

        const state = getState();
        const planLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
        const maxPosition = Math.max(planLength, 1);
        const canTargetExistingPosition = planLength > 0;

        showModal({
          title: "Insert Into Output",
          bodyHtml: `
            <div class="field-inline">
              <label class="field-label" for="insert-mode">Insert target</label>
              <select id="insert-mode" class="select field-input">
                <option value="beginning">Beginning</option>
                <option value="end" selected>End</option>
                <option value="before"${canTargetExistingPosition ? "" : " disabled"}>Before position</option>
                <option value="after"${canTargetExistingPosition ? "" : " disabled"}>After position</option>
              </select>
            </div>

            <div class="field-inline" id="insert-output-position-row" hidden>
              <label class="field-label" for="insert-output-position">Output position</label>
              <input
                id="insert-output-position"
                class="select field-input"
                type="number"
                min="1"
                max="${maxPosition}"
                step="1"
                value="${maxPosition}"
              />
            </div>

            <div class="hint">Positions refer to current output order (1-based).</div>
          `,
          primaryText: "Insert",
          secondaryText: "Cancel",
          onPrimary: () => {
            const modeEl = document.getElementById("insert-mode");
            if (!(modeEl instanceof HTMLSelectElement)) {
              return false;
            }

            const mode = modeEl.value;
            let atIndex = 0;

            if (mode === "end") {
              atIndex = planLength;
            } else if (mode === "beginning") {
              atIndex = 0;
            } else {
              if (!canTargetExistingPosition) {
                showToast({
                  type: "warning",
                  title: "No output pages",
                  message: "Add at least one output page before using before/after position.",
                  timeoutMs: 3200,
                });
                return false;
              }

              const positionEl = document.getElementById("insert-output-position");
              const rawPosition = positionEl instanceof HTMLInputElement ? positionEl.value : "";
              const parsedPosition = Number.parseInt(rawPosition, 10);
              if (!Number.isInteger(parsedPosition) || parsedPosition < 1 || parsedPosition > planLength) {
                showToast({
                  type: "warning",
                  title: "Invalid output position",
                  message: `Enter a value from 1 to ${planLength}.`,
                  timeoutMs: 3200,
                });
                return false;
              }

              atIndex = mode === "before" ? parsedPosition - 1 : parsedPosition;
            }

            dispatch({
              type: "DOCPLAN_INSERT_FILE_AT",
              payload: {
                fileId,
                atIndex: clamp(atIndex, 0, planLength),
              },
            });
            return true;
          },
        });

        const modeEl = document.getElementById("insert-mode");
        const positionRowEl = document.getElementById("insert-output-position-row");
        const positionInputEl = document.getElementById("insert-output-position");
        if (
          modeEl instanceof HTMLSelectElement &&
          positionRowEl instanceof HTMLElement &&
          positionInputEl instanceof HTMLInputElement
        ) {
          const syncPositionUi = () => {
            const mode = modeEl.value;
            const showPosition = mode === "before" || mode === "after";
            positionRowEl.hidden = !showPosition;
            positionInputEl.disabled = !showPosition;
            if (!showPosition) {
              return;
            }
            const parsed = Number.parseInt(positionInputEl.value || "", 10);
            const safeValue = clamp(Number.isInteger(parsed) ? parsed : 1, 1, maxPosition);
            positionInputEl.value = String(safeValue);
          };

          modeEl.addEventListener("change", syncPositionUi);
          positionInputEl.addEventListener("input", () => {
            const parsed = Number.parseInt(positionInputEl.value || "", 10);
            if (!Number.isInteger(parsed)) {
              return;
            }
            positionInputEl.value = String(clamp(parsed, 1, maxPosition));
          });
          syncPositionUi();
        }

        return;
      }

      if (action === "move-plan-left" || action === "move-plan-right") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const state = getState();
        const planLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
        if (planLength <= 1) {
          return;
        }

        const fromIndex = Number.parseInt(actionTarget.getAttribute("data-plan-index") || "", 10);
        if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= planLength) {
          return;
        }
        if (isOutputIndexLocked(state, fromIndex)) {
          showToast({
            type: "warning",
            title: "Page is locked",
            message: "Unlock this output page before moving it.",
            timeoutMs: 2200,
          });
          return;
        }

        const delta = action === "move-plan-left" ? -1 : 1;
        const toIndex = clamp(fromIndex + delta, 0, planLength - 1);
        if (toIndex === fromIndex) {
          return;
        }

        dispatch({
          type: "DOCPLAN_REORDER",
          payload: { fromIndex, toIndex },
        });
        dispatch({
          type: "UI_SET",
          payload: {
            patch: {
              activeView: "output",
              selectedOutputPageIndices: [toIndex],
              lastSelectedOutputIndex: toIndex,
            },
          },
        });
        return;
      }

      if (action === "remove-plan-index") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const indexValue = Number.parseInt(actionTarget.getAttribute("data-plan-index") || "", 10);
        if (!Number.isFinite(indexValue)) {
          return;
        }
        const state = getState();
        if (isOutputIndexLocked(state, indexValue)) {
          showToast({
            type: "warning",
            title: "Page is locked",
            message: "Unlock this output page before removing it.",
            timeoutMs: 2200,
          });
          return;
        }

        dispatch({
          type: "DOCPLAN_DELETE_SELECTED",
          payload: { indices: [indexValue] },
        });
        return;
      }

      if (action === "toggle-plan-lock") {
        event.stopPropagation();
        if (!dispatch) {
          return;
        }
        const indexValue = Number.parseInt(actionTarget.getAttribute("data-plan-index") || "", 10);
        if (!Number.isInteger(indexValue) || indexValue < 0) {
          return;
        }
        const lockValue = actionTarget.getAttribute("data-lock") === "true";
        captureOutputViewportScrollLeft();
        dispatch({
          type: "DOCPLAN_SET_LOCK",
          payload: {
            indices: [indexValue],
            locked: lockValue,
          },
        });
        return;
      }

      if (action === "lock-selected-output" || action === "unlock-selected-output") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }
        const state = getState();
        const selectedIndices = normalizeOutputSelection(
          state?.ui?.selectedOutputPageIndices,
          Array.isArray(state?.docPlan) ? state.docPlan.length : 0,
        );
        if (selectedIndices.length === 0) {
          return;
        }
        captureOutputViewportScrollLeft();
        dispatch({
          type: "DOCPLAN_SET_LOCK",
          payload: {
            indices: selectedIndices,
            locked: action === "lock-selected-output",
          },
        });
        return;
      }

      if (action === "rotate-selected-left" || action === "rotate-selected-right") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const state = getState();
        const selectedIndices = getUnlockedOutputIndices(
          state,
          state?.ui?.selectedOutputPageIndices,
        );

        if (selectedIndices.length === 0) {
          showToast({
            type: "warning",
            title: "No editable pages",
            message: "Select at least one unlocked output page.",
            timeoutMs: 2200,
          });
          return;
        }

        dispatch({
          type: "DOCPLAN_ROTATE_INDICES",
          payload: {
            indices: selectedIndices,
            delta: action === "rotate-selected-right" ? 90 : -90,
          },
        });
        return;
      }

      if (action === "delete-selected-output") {
        event.stopPropagation();
        openDeleteSelectedModal({ dispatch, getState });
        return;
      }

      if (action === "delete-by-range-output") {
        event.stopPropagation();
        openDeleteByRangeModal({ dispatch, getState });
        return;
      }

      if (action === "find-output-pages") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const state = getState();
        const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
        if (docPlan.length === 0) {
          return;
        }

        const lookupMode = normalizeOutputFindMode(state?.ui?.outputFindMode);
        const outputFindSourceFileId =
          lookupMode === "source_page" && typeof state?.ui?.outputFindSourceFileId === "string"
            ? state.ui.outputFindSourceFileId
            : "";
        const sourceScopedPlan =
          lookupMode === "source_page" && outputFindSourceFileId
            ? docPlan.filter((pageRef) => pageRef?.fileId === outputFindSourceFileId)
            : docPlan;
        if (lookupMode === "source_page" && sourceScopedPlan.length === 0) {
          showToast({
            type: "warning",
            title: "No pages for selected source",
            message: "Choose another source or switch to output lookup.",
            timeoutMs: 2800,
          });
          return;
        }
        const sourceScopedMaxPage = lookupMode === "source_page"
          ? sourceScopedPlan.reduce((maxPage, pageRef) => {
              const pageIndex = Number.parseInt(String(pageRef?.pageIndex ?? ""), 10);
              if (!Number.isInteger(pageIndex) || pageIndex < 0) {
                return maxPage;
              }
              return Math.max(maxPage, pageIndex + 1);
            }, 0)
          : 0;
        const lookupScopeMax =
          lookupMode === "source_page"
            ? (outputFindSourceFileId ? sourceScopedMaxPage : getMaxSourcePageNumber(docPlan))
            : docPlan.length;

        const inputEl = document.getElementById("output-find-range");
        const rawInput = inputEl instanceof HTMLInputElement ? inputEl.value : "";

        let lookup;
        try {
          lookup = parseLookupPageRanges(rawInput, lookupScopeMax);
          if (lookup.indices.length === 0 && lookup.overflowMaxPage == null) {
            throw new Error("Enter at least one page number or range.");
          }
        } catch (error) {
          showToast({
            type: "error",
            title: "Invalid page lookup",
            message: toErrorMessage(error, "Unable to parse page lookup"),
            timeoutMs: 3000,
          });
          return;
        }

        if (lookup.overflowMaxPage != null) {
          const scopeLabel = lookupMode === "source_page" ? "source page" : "output position";
          showToast({
            type: "warning",
            title: "Page range exceeds available pages",
            message: `Max ${scopeLabel} is ${lookupScopeMax}. Query included ${lookup.overflowMaxPage}; only available pages were selected.`,
            timeoutMs: 3600,
          });
        }

        const lookupIndexSet = new Set(lookup.indices);
        const matchedIndices =
          lookupMode === "source_page"
            ? docPlan
                .map((pageRef, index) => ({
                  index,
                  fileId: typeof pageRef?.fileId === "string" ? pageRef.fileId : "",
                  pageIndex: Number.parseInt(String(pageRef?.pageIndex ?? ""), 10),
                }))
                .filter(
                  (entry) =>
                    Number.isInteger(entry.pageIndex) &&
                    lookupIndexSet.has(entry.pageIndex) &&
                    (!outputFindSourceFileId || entry.fileId === outputFindSourceFileId),
                )
                .map((entry) => entry.index)
            : lookup.indices;

        if (matchedIndices.length === 0) {
          showToast({
            type: "warning",
            title: "No matches found",
            message:
              lookupMode === "source_page"
                ? "No output items match those source page numbers."
                : "No output positions matched your query.",
            timeoutMs: 2800,
          });
          return;
        }

        const lastIndex = matchedIndices[matchedIndices.length - 1] ?? null;
        dispatch({
          type: "UI_SET",
          payload: {
            patch: {
              activeView: "output",
              selectedOutputPageIndices: matchedIndices,
              lastSelectedOutputIndex: lastIndex,
            },
          },
        });
        focusTimelineIndex(matchedIndices[0] ?? 0);
        return;
      }

      if (action === "extract-selected-output") {
        event.stopPropagation();
        if (typeof getState !== "function") {
          return;
        }

        const state = getState();
        const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
        const namePlan = buildDownloadNamePlan(state);
        const selectedIndices = normalizeOutputSelection(
          state?.ui?.selectedOutputPageIndices,
          docPlan.length,
        );
        if (selectedIndices.length === 0) {
          return;
        }

        const pageRefs = selectedIndices
          .map((index) => {
            const pageRef = docPlan[index];
            if (!pageRef || typeof pageRef.fileId !== "string") {
              return null;
            }
            return {
              fileId: pageRef.fileId,
              pageIndex: pageRef.pageIndex,
              rotation: pageRef.rotation,
              sourceOutputIndex: index,
            };
          })
          .filter(Boolean);

        if (pageRefs.length === 0) {
          showToast({
            type: "warning",
            title: "Nothing to extract",
            message: "No valid pages were selected.",
            timeoutMs: 2400,
          });
          return;
        }

        if (namePlan.inputAdjusted) {
          showToast({
            type: "warning",
            title: "Filename adjusted",
            message: `Using "${namePlan.adjustedInputName}" as the output filename base.`,
            timeoutMs: 3200,
          });
        }

        void (async () => {
          try {
            const bytes = await exportPdfFromPageRefs({
              files: state.files,
              pageRefs,
              meta: state?.ui?.exportMetadata,
              watermark: {
                ...(state?.ui?.watermark ?? {}),
                selectedOutputPageIndices: state?.ui?.selectedOutputPageIndices,
              },
              headerFooter: {
                ...(state?.ui?.headerFooter ?? {}),
                selectedOutputPageIndices: state?.ui?.selectedOutputPageIndices,
                outputPageCount: docPlan.length,
                outputFileName: namePlan.extractName,
              },
            });
            downloadPdfBytes(bytes, namePlan.extractName);
            showToast({
              type: "success",
              title: "Extract complete",
              message: `Downloaded ${namePlan.extractName}`,
              timeoutMs: 2200,
            });
          } catch (error) {
            showToast({
              type: "error",
              title: "Extract failed",
              message: toErrorMessage(error, "Failed to extract selected pages"),
              timeoutMs: 3200,
            });
          }
        })();
        return;
      }

      if (action === "split-output") {
        event.stopPropagation();
        openSplitOutputModal({ dispatch, getState });
        return;
      }

      if (action === "open-export-settings") {
        event.stopPropagation();
        openExportMetadataModal({ dispatch, getState });
        return;
      }

      if (action === "open-watermark-settings") {
        event.stopPropagation();
        openWatermarkModal({ dispatch, getState });
        return;
      }

      if (action === "open-header-footer-settings") {
        event.stopPropagation();
        openHeaderFooterModal({ dispatch, getState });
        return;
      }

      if (action === "add-blank-page") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const stateAtStart = getState();
        if (stateAtStart?.runtime?.busy) {
          showToast({
            type: "warning",
            title: "Busy",
            message: "Please wait for the current job to finish.",
            timeoutMs: 2200,
          });
          return;
        }

        void (async () => {
          dispatch({
            type: "RUNTIME_BUSY_SET",
            payload: { busy: true },
          });
          dispatch({ type: "RUNTIME_ERROR_CLEAR" });

          try {
            const bytes = await createBlankPdfPageBytes();
            const name = buildBlankPageName();
            const record = await importPdfBytes({
              bytes,
              name,
              sourceType: "pdf",
              badges: ["Blank page"],
              ctx: { dispatch },
            });

            dispatch({
              type: "DOCPLAN_APPEND_FILE",
              payload: { fileId: record.id },
            });

            const latestState = getState();
            const nextDocPlanLength = Array.isArray(latestState?.docPlan)
              ? latestState.docPlan.length
              : 0;
            const selectedIndex = Math.max(0, nextDocPlanLength - 1);
            dispatch({
              type: "UI_SET",
              payload: {
                patch: {
                  activeView: "output",
                  selectedOutputPageIndices: nextDocPlanLength > 0 ? [selectedIndex] : [],
                  lastSelectedOutputIndex: nextDocPlanLength > 0 ? selectedIndex : null,
                  outputCursorIndex: nextDocPlanLength,
                },
              },
            });

            showToast({
              type: "success",
              title: "Blank page added",
              message: "Added a new blank page to output.",
              timeoutMs: 2200,
            });
          } catch (error) {
            const message = toErrorMessage(error, "Failed to add blank page");
            dispatch({
              type: "RUNTIME_ERROR_SET",
              payload: { error: message },
            });
            showToast({
              type: "error",
              title: "Add blank page failed",
              message,
              timeoutMs: 3200,
            });
          } finally {
            dispatch({
              type: "RUNTIME_BUSY_SET",
              payload: { busy: false },
            });
          }
        })();
        return;
      }

      if (action === "open-reorder-mode") {
        event.stopPropagation();
        openReorderModal({ dispatch, getState });
        return;
      }

      if (action === "clear-output") {
        event.stopPropagation();
        if (!dispatch) {
          return;
        }

        showModal({
          title: "Clear Output",
          bodyHtml: "<p>Remove all pages from the output plan?</p>",
          primaryText: "Clear Output",
          secondaryText: "Cancel",
          onPrimary: () => {
            dispatch({ type: "DOCPLAN_CLEAR" });
            dispatch({
              type: "UI_SET",
              payload: {
                patch: {
                  selectedOutputPageIndices: [],
                  lastSelectedOutputIndex: null,
                },
              },
            });
            return true;
          },
          onSecondary: () => true,
        });
        return;
      }

      if (action === "export-output-pdf") {
        event.stopPropagation();
        if (!dispatch || typeof getState !== "function") {
          return;
        }

        const stateAtStart = getState();
        const docPlan = Array.isArray(stateAtStart?.docPlan) ? stateAtStart.docPlan : [];
        if (docPlan.length === 0 || stateAtStart?.runtime?.busy) {
          return;
        }

        const namePlan = buildDownloadNamePlan(stateAtStart);
        if (namePlan.inputAdjusted) {
          showToast({
            type: "warning",
            title: "Filename adjusted",
            message: `Using "${namePlan.adjustedInputName}" as the export filename.`,
            timeoutMs: 3200,
          });
        }

        const jobId = createJobId();
        const total = docPlan.length;
        warnIfLargeOutputPlan(total);

        dispatch({
          type: "RUNTIME_BUSY_SET",
          payload: { busy: true },
        });
        dispatch({ type: "RUNTIME_ERROR_CLEAR" });
        dispatch({
          type: "RUNTIME_JOB_SET",
          payload: {
            job: {
              id: jobId,
              type: "export_pdf",
              stage: "assembling",
              progress: { done: 0, total },
              etaSeconds: null,
              canCancel: false,
              message: "Building output PDF...",
            },
          },
        });

        void (async () => {
          try {
            const bytes = await exportPdfFromDocPlan({
              state: getState(),
              onProgress: ({ done, total: nextTotal }) => {
                const safeDone = Number.isFinite(done) ? Math.max(0, Math.floor(done)) : 0;
                const safeTotal = Number.isFinite(nextTotal) ? Math.max(0, Math.floor(nextTotal)) : total;
                dispatch({
                  type: "RUNTIME_JOB_SET",
                  payload: {
                    job: {
                      id: jobId,
                      type: "export_pdf",
                      stage: "assembling",
                      progress: { done: safeDone, total: safeTotal },
                      etaSeconds: null,
                      canCancel: false,
                      message: "Copying pages...",
                    },
                  },
                });
              },
            });

            downloadPdfBytes(bytes, namePlan.exportName);
            showToast({
              type: "success",
              title: "Export complete",
              message: `Exported ${namePlan.exportName}`,
              timeoutMs: 2200,
            });
          } catch (error) {
            const message = toErrorMessage(error, "Failed to export PDF");
            dispatch({
              type: "RUNTIME_ERROR_SET",
              payload: { error: message },
            });
            showToast({
              type: "error",
              title: "Export failed",
              message,
              timeoutMs: 3200,
            });
          } finally {
            dispatch({ type: "RUNTIME_JOB_CLEAR" });
            dispatch({
              type: "RUNTIME_BUSY_SET",
              payload: { busy: false },
            });
          }
        })();
        return;
      }
    }

    const timelineItem =
      event.target instanceof Element ? event.target.closest(".timeline-item[data-plan-index]") : null;
    if (timelineItem) {
      if (!dispatch || typeof getState !== "function") {
        return;
      }
      event.preventDefault();

      const state = getState();
      const planLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
      const clickedIndex = parseNonNegativeInt(timelineItem.getAttribute("data-plan-index"));
      if (clickedIndex == null || clickedIndex >= planLength) {
        return;
      }

      const currentSelection = normalizeOutputSelection(state?.ui?.selectedOutputPageIndices, planLength);
      const anchorRaw = Number.parseInt(String(state?.ui?.lastSelectedOutputIndex ?? ""), 10);
      const anchor = Number.isInteger(anchorRaw) && anchorRaw >= 0 && anchorRaw < planLength
        ? anchorRaw
        : currentSelection.length > 0
          ? currentSelection[currentSelection.length - 1]
          : clickedIndex;

      let nextSelectedIndices = [clickedIndex];
      if (event.shiftKey) {
        const start = Math.min(anchor, clickedIndex);
        const end = Math.max(anchor, clickedIndex);
        nextSelectedIndices = [];
        for (let index = start; index <= end; index += 1) {
          nextSelectedIndices.push(index);
        }
      } else if (event.ctrlKey || event.metaKey) {
        const nextSet = new Set(currentSelection);
        if (nextSet.has(clickedIndex)) {
          nextSet.delete(clickedIndex);
        } else {
          nextSet.add(clickedIndex);
        }
        nextSelectedIndices = Array.from(nextSet).sort((a, b) => a - b);
      }

      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            activeView: "output",
            selectedOutputPageIndices: nextSelectedIndices,
            lastSelectedOutputIndex: nextSelectedIndices.length > 0 ? clickedIndex : null,
          },
        },
      });
      return;
    }

    const target = event.target instanceof Element ? event.target.closest("[data-ui-action]") : null;
    if (!target) {
      return;
    }

    const action = target.getAttribute("data-ui-action");

    if (action === "toggle-settings-menu") {
      event.preventDefault();
      event.stopPropagation();
      toggleSettingsMenu();
      return;
    }

    if (action && action !== "toggle-theme") {
      closeSettingsMenu();
    }

    if (action === "cancel-job") {
      cancelActiveJob();
      return;
    }

    if (action === "toggle-theme") {
      const currentPreference = normalizeThemePreference(
        readThemePreference() || document.documentElement.getAttribute("data-theme-pref") || "system",
      );
      const nextPreference = cycleThemePreference(currentPreference);
      applyTheme(nextPreference);
      writeThemePreference(nextPreference);
      updateThemeButtonLabel(appRoot);
      return;
    }

    if (action === "clear-project") {
      showModal({
        title: "Factory Reset",
        bodyHtml: "<p>This will clear the saved project data (manifest and stored PDF bytes) and reload the page.</p>",
        primaryText: "Reset & Reload",
        secondaryText: "Cancel",
        onPrimary: () => {
          void (async () => {
            let hadCleanupError = false;

            try {
              localStorage.removeItem(LS_MANIFEST_KEY);
            } catch {
              hadCleanupError = true;
            }

            try {
              await idbClearAll();
            } catch {
              hadCleanupError = true;
            }

            if (hadCleanupError) {
              showToast({
                type: "warning",
                title: "Partial cleanup",
                message: "Some saved data could not be cleared before reload.",
                timeoutMs: 3200,
              });
            }

            window.location.reload();
          })();
          return false;
        },
        onSecondary: () => true,
      });
      return;
    }

    if (action === "choose-files") {
      const input = document.getElementById("file-input");
      if (input instanceof HTMLInputElement) {
        input.click();
      }
      return;
    }

    if (action === "source-filmstrip-prev") {
      scrollSourceFilmstripBy(-1);
      return;
    }

    if (action === "source-filmstrip-next") {
      scrollSourceFilmstripBy(1);
      return;
    }

    if (action === "output-filmstrip-prev") {
      scrollOutputFilmstripBy(-1);
      return;
    }

    if (action === "output-filmstrip-next") {
      scrollOutputFilmstripBy(1);
      return;
    }

    if (action === "select-file") {
      if (!dispatch || typeof getState !== "function") {
        return;
      }

      const fileId = target.getAttribute("data-file-id");
      if (!fileId) {
        return;
      }

      const state = getState();
      const selectedFileId = typeof state?.ui?.selectedFileId === "string" ? state.ui.selectedFileId : null;
      if (selectedFileId === fileId) {
        clearSourceSelection();
        return;
      }

      setSourceSelection({
        fileId,
        pageIndex: 0,
        selectedPageIndices: [0],
        lastSelectedPageIndex: 0,
      });
      return;
    }

    if (action === "select-source-page") {
      if (!dispatch || typeof getState !== "function") {
        return;
      }

      const state = getState();
      const selectedFile = getSelectedFile(state);
      if (!selectedFile) {
        return;
      }

      const pageIndexRaw = Number.parseInt(target.getAttribute("data-page-index") || "", 10);
      if (!Number.isFinite(pageIndexRaw)) {
        return;
      }

      const nextIndex = clamp(pageIndexRaw, 0, getMaxPageIndex(selectedFile));
      const pageCount =
        Number.isFinite(selectedFile.pageCount) && selectedFile.pageCount > 0 ? selectedFile.pageCount : 1;
      const selectedIndices = normalizeSourcePageSelection(state?.ui?.selectedSourcePageIndices, pageCount);
      const anchorRaw = Number.parseInt(String(state?.ui?.lastSelectedSourcePageIndex ?? ""), 10);
      const fallbackAnchor = Number.isFinite(state?.ui?.selectedSourcePageIndex)
        ? clamp(state.ui.selectedSourcePageIndex, 0, pageCount - 1)
        : nextIndex;
      const anchor = Number.isInteger(anchorRaw) ? clamp(anchorRaw, 0, pageCount - 1) : fallbackAnchor;
      let nextSelectedIndices = [];

      if (event.shiftKey) {
        const rangeStart = Math.min(anchor, nextIndex);
        const rangeEnd = Math.max(anchor, nextIndex);
        nextSelectedIndices = Array.from(
          { length: rangeEnd - rangeStart + 1 },
          (_, offset) => rangeStart + offset,
        );
      } else if (event.ctrlKey || event.metaKey) {
        const nextSet = new Set(selectedIndices);
        if (nextSet.has(nextIndex)) {
          nextSet.delete(nextIndex);
        } else {
          nextSet.add(nextIndex);
        }
        nextSelectedIndices = Array.from(nextSet).sort((a, b) => a - b);
      } else {
        nextSelectedIndices = [nextIndex];
      }

      if (nextSelectedIndices.length === 0) {
        nextSelectedIndices = [nextIndex];
      }

      setSourceSelection({
        fileId: selectedFile.id,
        pageIndex: nextIndex,
        selectedPageIndices: nextSelectedIndices,
        lastSelectedPageIndex: nextIndex,
      });
      return;
    }

    if (action === "preview-prev" || action === "preview-next") {
      if (!dispatch || typeof getState !== "function") {
        return;
      }

      const state = getState();
      const selectedFile = getSelectedFile(state);
      if (!selectedFile) {
        return;
      }

      const currentIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
        ? state.ui.selectedSourcePageIndex
        : 0;
      const maxPageIndex = getMaxPageIndex(selectedFile);
      const delta = action === "preview-next" ? 1 : -1;
      const nextIndex = clamp(currentIndex + delta, 0, maxPageIndex);

      if (nextIndex === currentIndex) {
        return;
      }

      setSourceSelection({
        fileId: selectedFile.id,
        pageIndex: nextIndex,
        selectedPageIndices: [nextIndex],
        lastSelectedPageIndex: nextIndex,
      });
      return;
    }

    if (action === "remove-file") {
      event.stopPropagation();
      const fileId = target.getAttribute("data-file-id");
      if (!fileId || !dispatch) {
        return;
      }

      const state = getState ? getState() : {};
      const fileLabel = getFileDisplayName(state, fileId);

      showModal({
        title: "Remove File",
        bodyHtml: `<p>Remove <strong>${fileLabel}</strong> from this project?</p>`,
        primaryText: "Remove",
        secondaryText: "Cancel",
        onPrimary: () => {
          void (async () => {
            try {
              await idbDeleteFile(fileId);
              clearThumbCacheForFile(fileId, { includePersistent: false });
              clearPdfTextIndex(fileId);
              dispatch({
                type: "FILES_REMOVE",
                payload: { fileId },
              });
              const latestState = typeof getState === "function" ? getState() : null;
              const nextCounts = { ...getTextMatchCounts(latestState) };
              const nextOccurrences =
                latestState?.ui?.textMatchOccurrences && typeof latestState.ui.textMatchOccurrences === "object"
                  ? { ...latestState.ui.textMatchOccurrences }
                  : {};
              const nextDetectedTextFiles = { ...getDetectedTextFilesMap(latestState) };
              delete nextCounts[fileId];
              delete nextOccurrences[fileId];
              delete nextDetectedTextFiles[fileId];
              dispatch({
                type: "UI_SET",
                payload: {
                  patch: {
                    textMatchCounts: nextCounts,
                    textMatchOccurrences: nextOccurrences,
                    textSearchDetectedFiles: nextDetectedTextFiles,
                  },
                },
              });
              showToast({
                type: "success",
                title: "Removed",
                message: `${fileLabel} was removed`,
                timeoutMs: 1800,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
              showToast({
                type: "error",
                title: "Remove failed",
                message,
                timeoutMs: 2400,
              });
            }
          })();

          return true;
        },
        onSecondary: () => true,
      });
    }
  });

  appRoot.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      event.target.getAttribute("data-ui-action") === "find-output-pages-input"
    ) {
      const trigger = appRoot.querySelector('[data-action="find-output-pages"]');
      if (trigger instanceof HTMLButtonElement && !trigger.disabled) {
        event.preventDefault();
        trigger.click();
      }
      return;
    }

    if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      event.target.getAttribute("data-ui-action") === "set-text-query"
    ) {
      const triggerSelector =
        event.target.id === "source-text-query"
          ? '[data-action="find-source-text"]'
          : '[data-action="find-output-text"]';
      const trigger = appRoot.querySelector(triggerSelector);
      if (trigger instanceof HTMLButtonElement && !trigger.disabled) {
        event.preventDefault();
        trigger.click();
      }
      return;
    }

    const target = event.target.closest(
      '[data-ui-action="select-file"], [data-ui-action="select-source-page"], .timeline-item[data-plan-index]',
    );
    if (!target) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
  });

  updateThemeButtonLabel(appRoot);
  queueRenderWork();
}
