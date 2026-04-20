function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PLUS_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-plus"></use></svg>';

function getSelectedFile(state) {
  const selectedFileId = state?.ui?.selectedFileId;
  const files = Array.isArray(state?.files) ? state.files : [];
  return files.find((file) => file?.id === selectedFileId) ?? null;
}

function getPageCount(file) {
  if (Number.isFinite(file?.pageCount) && file.pageCount > 0) {
    return file.pageCount;
  }
  return 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSourceSelection(indices, pageCount) {
  if (!Array.isArray(indices)) {
    return [];
  }
  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount),
    ),
  ).sort((a, b) => a - b);
}

export function renderPagePreview(state = {}) {
  const selectedFile = getSelectedFile(state);
  if (!selectedFile) {
    return "";
  }

  const pageCount = getPageCount(selectedFile);
  const currentIndex = Number.isFinite(state?.ui?.selectedSourcePageIndex)
    ? state.ui.selectedSourcePageIndex
    : 0;
  const clampedIndex = clamp(currentIndex, 0, Math.max(0, pageCount - 1));
  const canGoPrev = clampedIndex > 0;
  const canGoNext = clampedIndex < pageCount - 1;
  const explicitSelection = normalizeSourceSelection(state?.ui?.selectedSourcePageIndices, pageCount);
  const selectedCount = explicitSelection.length > 0 ? explicitSelection.length : 1;
  const isMultiSelect = selectedCount > 1;

  const rawFileName = selectedFile.name || selectedFile.originalName || "Untitled file";
  const fileName = escapeHtml(rawFileName);

  return `
    <div class="source-page-controls">
      <div class="source-page-meta">
        <span class="source-page-file muted" title="${fileName}">${fileName}</span>
        ${isMultiSelect ? `<span class="muted">${selectedCount} pages selected</span>` : ""}
      </div>
      <div class="source-page-actions">
        <button
          type="button"
          class="btn small secondary"
          data-ui-action="preview-prev"
          ${canGoPrev ? "" : "disabled"}
        >
          Prev
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-ui-action="preview-next"
          ${canGoNext ? "" : "disabled"}
        >
          Next
        </button>
        <button
          type="button"
          class="btn small primary"
          data-action="append-current-source-page"
        >
          ${PLUS_ICON_HTML}
          <span class="label-full">${isMultiSelect ? "Append Selected" : "Append Page"}</span>
          <span class="label-short">Append</span>
        </button>
      </div>
    </div>
  `;
}
