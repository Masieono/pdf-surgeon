function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function getPageCount(file) {
  if (Number.isFinite(file?.pageCount) && file.pageCount > 0) {
    return file.pageCount;
  }
  return 0;
}

export function renderPageGrid({ file, state } = {}) {
  if (!file?.id) {
    return "";
  }

  const pageCount = getPageCount(file);
  if (pageCount <= 1) {
    return "";
  }

  const selectedIndex = clamp(
    Number.isFinite(state?.ui?.selectedSourcePageIndex) ? state.ui.selectedSourcePageIndex : 0,
    0,
    pageCount - 1,
  );
  const explicitSelection = normalizeSourceSelection(state?.ui?.selectedSourcePageIndices, pageCount);
  const selectedSet =
    explicitSelection.length > 0 ? new Set(explicitSelection) : new Set([selectedIndex]);
  const canScroll = pageCount > 1;

  const tiles = Array.from({ length: pageCount }, (_, pageIndex) => {
    const pageLabel = `Page ${pageIndex + 1}`;
    const isSelected = selectedSet.has(pageIndex);
    const selectedClass = isSelected ? " selected" : "";

    return `
      <button
        type="button"
        class="thumb-tile thumb-tile-inline${selectedClass}"
        data-ui-action="select-source-page"
        data-page-index="${pageIndex}"
        aria-pressed="${isSelected ? "true" : "false"}"
        aria-label="${escapeHtml(pageLabel)}"
      >
        <canvas
          class="thumb-canvas"
          data-page-index="${pageIndex}"
          data-file-id="${escapeHtml(file.id)}"
          aria-hidden="true"
        ></canvas>
        <div class="thumb-label">${pageIndex + 1}</div>
      </button>
    `;
  }).join("");

  return `
    <div class="source-filmstrip" data-thumb-grid data-file-id="${escapeHtml(file.id)}">
      <button
        type="button"
        class="btn small secondary source-filmstrip-nav"
        data-ui-action="source-filmstrip-prev"
        aria-label="Scroll source thumbnails left"
        ${canScroll ? "" : "disabled"}
      >
        ◀
      </button>
      <div class="source-filmstrip-viewport" data-source-filmstrip-viewport>
        <div class="source-filmstrip-track">
          ${tiles}
        </div>
      </div>
      <button
        type="button"
        class="btn small secondary source-filmstrip-nav"
        data-ui-action="source-filmstrip-next"
        aria-label="Scroll source thumbnails right"
        ${canScroll ? "" : "disabled"}
      >
        ▶
      </button>
    </div>
  `;
}
