import {
  normalizeWatermarkMode,
  normalizeWatermarkPosition,
  normalizeWatermarkTarget,
} from "../../state/store-helpers.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isValidIndex(index, length) {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function getFileNameById(files, fileId) {
  if (!Array.isArray(files)) {
    return "Unknown file";
  }

  const match = files.find((file) => file?.id === fileId);
  return match?.name || match?.originalName || "Unknown file";
}

function normalizeSelectedIndices(indices, length) {
  if (!Array.isArray(indices)) {
    return [];
  }

  return Array.from(new Set(indices.filter((index) => isValidIndex(index, length)))).sort((a, b) => a - b);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeOutputFindMode(value) {
  return value === "source_page" ? "source_page" : "output_position";
}

function normalizeSearchQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatUndoRedoButtonLabel(prefix, actionLabel) {
  const clean = typeof actionLabel === "string" ? actionLabel.trim() : "";
  if (!clean) {
    return prefix;
  }
  return `${prefix} ${clean}`;
}

const CLEAR_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-clear"></use></svg>';
const DOWNLOAD_ICON_HTML =
  '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 12 12"><use href="#i-download"></use></svg>';
const LOCK_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-lock"></use></svg>';
const UNLOCK_ICON_HTML =
  '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-unlock"></use></svg>';
const LOCK_ICON_SOLO_HTML =
  '<svg class="btn-icon btn-icon--solo btn-icon--control" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-lock"></use></svg>';
const UNLOCK_ICON_SOLO_HTML =
  '<svg class="btn-icon btn-icon--solo btn-icon--control" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-unlock"></use></svg>';
const ARROW_LEFT_ICON_HTML =
  '<svg class="btn-icon btn-icon--solo btn-icon--control" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-arrow-left"></use></svg>';
const ARROW_RIGHT_ICON_HTML =
  '<svg class="btn-icon btn-icon--solo btn-icon--control" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-arrow-right"></use></svg>';
const ROTATE_LEFT_ICON_HTML =
  '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-rotate-left"></use></svg>';
const ROTATE_RIGHT_ICON_HTML =
  '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-rotate-right"></use></svg>';
const PLUS_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-plus"></use></svg>';

function formatMetadataSummary(exportMetadata) {
  const title = typeof exportMetadata?.title === "string" ? exportMetadata.title.trim() : "";
  const author = typeof exportMetadata?.author === "string" ? exportMetadata.author.trim() : "";
  const subject = typeof exportMetadata?.subject === "string" ? exportMetadata.subject.trim() : "";
  const keywords = typeof exportMetadata?.keywords === "string" ? exportMetadata.keywords.trim() : "";

  const parts = [];
  if (title) {
    parts.push(`Title: ${escapeHtml(title)}`);
  }
  if (author) {
    parts.push(`Author: ${escapeHtml(author)}`);
  }
  if (subject) {
    parts.push(`Subject: ${escapeHtml(subject)}`);
  }
  if (keywords) {
    parts.push(`Keywords: ${escapeHtml(keywords)}`);
  }

  if (parts.length === 0) {
    return "No export metadata set";
  }
  return parts.join(" | ");
}

function formatWatermarkSummary(watermark, selectedCount) {
  const safeWatermark = watermark && typeof watermark === "object" ? watermark : {};
  const mode = normalizeWatermarkMode(safeWatermark.mode);
  const text = typeof safeWatermark.text === "string" ? safeWatermark.text.trim() : "";
  const imageName = typeof safeWatermark.imageName === "string" ? safeWatermark.imageName.trim() : "";
  const hasImageData = typeof safeWatermark.imageDataUrl === "string" && safeWatermark.imageDataUrl.trim() !== "";
  const hasContent = mode === "image" ? hasImageData : text.length > 0;
  if (!hasContent) {
    return "Watermark: Off";
  }

  const target = normalizeWatermarkTarget(safeWatermark.target);
  const position = normalizeWatermarkPosition(safeWatermark.position);
  const targetLabel =
    target === "selected_output_pages"
      ? `Selected output pages (${selectedCount})`
      : target === "odd_output_pages"
        ? "Odd output pages"
        : target === "even_output_pages"
          ? "Even output pages"
          : target === "range_output_pages"
            ? `Range: ${escapeHtml(safeWatermark.rangeInput || "n/a")}`
            : "All output pages";
  const positionLabel =
    position === "bottom_right" ? "Bottom-right" : position === "center" ? "Center" : "Diagonal center";
  const contentLabel =
    mode === "image"
      ? `Image (${escapeHtml(imageName || "uploaded")})`
      : `"${escapeHtml(text)}"`;
  const modeLabel = mode === "image" ? "Image" : "Text";

  return `Watermark (${modeLabel}): ${contentLabel} | Pages: ${targetLabel} | Position: ${positionLabel}`;
}

function formatHeaderFooterSummary(headerFooter, selectedCount) {
  const safe = headerFooter && typeof headerFooter === "object" ? headerFooter : {};
  const headerText = typeof safe.headerText === "string" ? safe.headerText.trim() : "";
  const footerText = typeof safe.footerText === "string" ? safe.footerText.trim() : "";
  const pageNumbersEnabled = safe.pageNumbersEnabled === true;
  const enabled = headerText.length > 0 || footerText.length > 0 || pageNumbersEnabled;
  if (!enabled) {
    return "Header/Footer: Off";
  }

  const target =
    safe.target === "selected_output_pages"
      ? `Selected (${selectedCount})`
      : safe.target === "range_output_pages"
        ? `Range: ${escapeHtml((safe.rangeInput || "").trim() || "n/a")}`
        : "All output pages";
  const parts = [];
  if (headerText) {
    parts.push("Header");
  }
  if (footerText) {
    parts.push("Footer");
  }
  if (pageNumbersEnabled) {
    parts.push("Page numbers");
  }
  return `Header/Footer: ${parts.join(" + ")} | Pages: ${target}`;
}

function renderTimelineItem(pageRef, index, totalCount, files, isSelected) {
  const pageIndex = Number.isFinite(pageRef?.pageIndex) ? pageRef.pageIndex : 0;
  const rotation = Number.isFinite(pageRef?.rotation) ? pageRef.rotation : 0;
  const isLocked = pageRef?.locked === true;
  const fileId = typeof pageRef?.fileId === "string" ? pageRef.fileId : "";
  const fileName = getFileNameById(files, pageRef?.fileId);
  const canMoveLeft = index > 0;
  const canMoveRight = index < totalCount - 1;
  const lockLabel = isLocked ? "Unlock" : "Lock";
  const metaParts = [`Page ${pageIndex + 1}`];
  if (rotation !== 0) {
    metaParts.push(`⟳ ${rotation}°`);
  }

  return `
    <div
      class="timeline-item${isSelected ? " selected" : ""}${isLocked ? " locked" : ""}"
      data-plan-index="${index}"
      data-locked="${isLocked ? "true" : "false"}"
      draggable="${isLocked ? "false" : "true"}"
      role="button"
      tabindex="0"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <div class="timeline-item-body">
        <div class="timeline-thumb" aria-hidden="true">
          <canvas
            class="timeline-thumb-canvas thumb-canvas"
            data-file-id="${escapeHtml(fileId)}"
            data-page-index="${pageIndex}"
            data-rotation="${rotation}"
          ></canvas>
        </div>
        <div class="timeline-item-main">
          <div class="timeline-item-topline">
            <strong>#${index + 1}</strong>
            <span class="muted">${escapeHtml(metaParts.join(" | "))}</span>
          </div>
          <div class="timeline-file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
        </div>
      </div>
      <div class="timeline-item-tools">
        <div class="timeline-item-tools-row">
          <button
            type="button"
            class="btn small secondary timeline-tile-control"
            data-action="move-plan-left"
            data-plan-index="${index}"
            aria-label="Move output item ${index + 1} left"
            title="Move Left"
            ${canMoveLeft && !isLocked ? "" : "disabled"}
          >
            ${ARROW_LEFT_ICON_HTML}
          </button>
          <button
            type="button"
            class="btn small secondary timeline-tile-control"
            data-action="move-plan-right"
            data-plan-index="${index}"
            aria-label="Move output item ${index + 1} right"
            title="Move Right"
            ${canMoveRight && !isLocked ? "" : "disabled"}
          >
            ${ARROW_RIGHT_ICON_HTML}
          </button>
          <button
            type="button"
            class="btn small secondary timeline-tile-control"
            data-action="toggle-plan-lock"
            data-plan-index="${index}"
            data-lock="${isLocked ? "false" : "true"}"
            aria-label="${lockLabel} output item ${index + 1}"
            title="${lockLabel}"
          >
            ${isLocked ? LOCK_ICON_SOLO_HTML : UNLOCK_ICON_SOLO_HTML}
          </button>
          <button
            type="button"
            class="btn small danger timeline-tile-control"
            data-action="remove-plan-index"
            data-plan-index="${index}"
            aria-label="Remove output item ${index + 1}"
            title="Remove"
            ${isLocked ? "disabled" : ""}
          >
            <svg class="btn-icon btn-icon--solo" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-clear"></use></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderTimeline({ state } = {}) {
  const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
  const files = Array.isArray(state?.files) ? state.files : [];
  const selectedIndices = normalizeSelectedIndices(state?.ui?.selectedOutputPageIndices, docPlan.length);
  const hasSelection = selectedIndices.length > 0;
  const lockedSelectedCount = selectedIndices.filter((index) => docPlan[index]?.locked === true).length;
  const unlockedSelectedIndices = selectedIndices.filter((index) => docPlan[index]?.locked !== true);
  const hasUnlockedSelection = unlockedSelectedIndices.length > 0;
  const isBusy = Boolean(state?.runtime?.busy);
  const canUndo = Boolean(state?.runtime?.history?.canUndo) && !isBusy;
  const canRedo = Boolean(state?.runtime?.history?.canRedo) && !isBusy;
  const nextUndoLabel =
    typeof state?.runtime?.history?.nextUndoLabel === "string" ? state.runtime.history.nextUndoLabel : null;
  const nextRedoLabel =
    typeof state?.runtime?.history?.nextRedoLabel === "string" ? state.runtime.history.nextRedoLabel : null;
  const canExport = docPlan.length > 0 && !isBusy;
  const canSplit = docPlan.length > 0;
  const fileCount = files.length;
  const outputPageCount = docPlan.length;
  const selectedCount = selectedIndices.length;
  const lastError =
    typeof state?.runtime?.lastError === "string" ? state.runtime.lastError.trim() : "";
  const activeJobMessage =
    typeof state?.runtime?.job?.message === "string" ? state.runtime.job.message.trim() : "";
  const statusText = lastError
    ? `Error: ${lastError}`
    : isBusy
      ? activeJobMessage || "Working..."
      : "";
  const statusClass = lastError ? "error-status" : "muted";
  const outputFindMode = normalizeOutputFindMode(state?.ui?.outputFindMode);
  const outputFindSourceFileId =
    typeof state?.ui?.outputFindSourceFileId === "string" ? state.ui.outputFindSourceFileId : "";
  const hasOutputFindSourceFileId = files.some((file) => file?.id === outputFindSourceFileId);
  const safeOutputFindSourceFileId = hasOutputFindSourceFileId ? outputFindSourceFileId : "";
  const sourceFindOptions = files
    .map((file) => {
      const fileId = typeof file?.id === "string" ? file.id : "";
      if (!fileId) {
        return "";
      }
      const fileName = file?.name || file?.originalName || "Unnamed source";
      return `<option value="${escapeHtml(fileId)}"${safeOutputFindSourceFileId === fileId ? " selected" : ""}>${escapeHtml(fileName)}</option>`;
    })
    .filter(Boolean)
    .join("");
  const textQuery = typeof state?.ui?.textQuery === "string" ? state.ui.textQuery : "";
  const normalizedTextQuery = normalizeSearchQuery(textQuery);
  const textMatchQuery = typeof state?.ui?.textMatchQuery === "string" ? state.ui.textMatchQuery : "";
  const normalizedTextMatchQuery = normalizeSearchQuery(textMatchQuery);
  const textMatchCounts =
    state?.ui?.textMatchCounts && typeof state.ui.textMatchCounts === "object"
      ? state.ui.textMatchCounts
      : {};
  const textMatchOccurrences =
    state?.ui?.textMatchOccurrences && typeof state.ui.textMatchOccurrences === "object"
      ? state.ui.textMatchOccurrences
      : {};
  const hasResolvedTextSummary =
    normalizedTextQuery !== "" && normalizedTextQuery === normalizedTextMatchQuery;
  const filesWithTextMatches = Object.values(textMatchCounts).filter((count) => Number.isInteger(count) && count > 0).length;
  const totalTextMatches = Object.values(textMatchOccurrences).reduce(
    (sum, count) => (Number.isInteger(count) ? sum + count : sum),
    0,
  );
  const outputTextSummaryLabel = hasResolvedTextSummary
    ? filesWithTextMatches > 0
      ? `${totalTextMatches} total matches found across ${filesWithTextMatches} file${filesWithTextMatches === 1 ? "" : "s"}.`
      : "No matches found for current query."
    : "";
  const findPlaceholder =
    outputFindMode === "source_page" ? "Source pages: 1,3-5" : "Output positions: 2 or 1-3,8";
  const exportFileName = typeof state?.ui?.exportFileName === "string" ? state.ui.exportFileName : "output.pdf";
  const metadataSummary = formatMetadataSummary(state?.ui?.exportMetadata);
  const watermarkSummary = formatWatermarkSummary(state?.ui?.watermark, selectedIndices.length);
  const headerFooterSummary = formatHeaderFooterSummary(state?.ui?.headerFooter, selectedIndices.length);
  const outputToolsOpen = state?.ui?.outputToolsOpen === true;
  const undoButtonLabel = formatUndoRedoButtonLabel("Undo", nextUndoLabel);
  const redoButtonLabel = formatUndoRedoButtonLabel("Redo", nextRedoLabel);
  const selectedEditActionsHtml = hasSelection
    ? `
      <div class="actions-row mt-12">
        <button
          type="button"
          class="btn small"
          data-action="rotate-selected-left"
          ${hasUnlockedSelection ? "" : 'disabled aria-disabled="true"'}
        >
          ${ROTATE_LEFT_ICON_HTML}Rotate Left
        </button>
        <button
          type="button"
          class="btn small"
          data-action="rotate-selected-right"
          ${hasUnlockedSelection ? "" : 'disabled aria-disabled="true"'}
        >
          ${ROTATE_RIGHT_ICON_HTML}Rotate Right
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-action="lock-selected-output"
          ${hasSelection ? "" : 'disabled aria-disabled="true"'}
        >
          ${LOCK_ICON_HTML}Lock Selected
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-action="unlock-selected-output"
          ${lockedSelectedCount > 0 ? "" : 'disabled aria-disabled="true"'}
        >
          ${UNLOCK_ICON_HTML}Unlock Selected
        </button>
        <button
          type="button"
          class="btn small danger"
          data-action="delete-selected-output"
          ${hasUnlockedSelection ? "" : 'disabled aria-disabled="true"'}
        >
          ${CLEAR_ICON_HTML}Delete Selected
        </button>
      </div>
    `
    : "";

  const planHtml =
    docPlan.length === 0
      ? `
        <div class="muted">No output pages yet.</div>
        <div class="hint">Add pages using "Append to Output".</div>
      `
      : `
        <div class="output-filmstrip" data-output-filmstrip>
          <button
            type="button"
            class="btn small secondary output-filmstrip-nav"
            data-ui-action="output-filmstrip-prev"
            aria-label="Scroll output pages left"
          >
            ◀
          </button>
          <div class="output-filmstrip-viewport" data-output-filmstrip-viewport>
            <div class="timeline-list timeline-list-filmstrip">
              ${docPlan
                .map((pageRef, index) =>
                  renderTimelineItem(pageRef, index, docPlan.length, files, selectedIndices.includes(index)),
                )
                .join("")}
            </div>
          </div>
          <button
            type="button"
            class="btn small secondary output-filmstrip-nav"
            data-ui-action="output-filmstrip-next"
            aria-label="Scroll output pages right"
          >
            ▶
          </button>
        </div>
      `;

  return `
    <div class="timeline-panel">
      ${planHtml}
      <div class="actions-row mt-12">
        <button
          type="button"
          class="btn primary"
          data-action="export-output-pdf"
          ${canExport ? "" : 'disabled aria-disabled="true"'}
        >
          ${DOWNLOAD_ICON_HTML}Export PDF
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-action="add-blank-page"
          ${isBusy ? 'disabled aria-disabled="true"' : ""}
        >
          ${PLUS_ICON_HTML}Add Blank Page
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-action="open-reorder-mode"
          ${canSplit ? "" : 'disabled aria-disabled="true"'}
        >
          Reorder Mode...
        </button>
        <button type="button" class="btn small danger" data-action="clear-output">${CLEAR_ICON_HTML}Clear Output</button>
      </div>
      ${selectedEditActionsHtml}
      <div class="actions-row mt-12">
        <button
          type="button"
          class="btn small secondary"
          data-action="undo"
          ${canUndo ? "" : 'disabled aria-disabled="true"'}
          title="${escapeHtml(undoButtonLabel)}"
        >
          ${escapeHtml(undoButtonLabel)}
        </button>
        <button
          type="button"
          class="btn small secondary"
          data-action="redo"
          ${canRedo ? "" : 'disabled aria-disabled="true"'}
          title="${escapeHtml(redoButtonLabel)}"
        >
          ${escapeHtml(redoButtonLabel)}
        </button>
      </div>

      <details class="details-card mt-12" data-role="output-tools-details" ${outputToolsOpen ? "open" : ""}>
        <summary class="details-summary">
          <span class="details-summary-left">
            <span class="details-summary-title">Advanced Output Tools</span>
          </span>
        </summary>
        <div class="details-body output-tools-body">
          <div class="actions-row">
            <button
              type="button"
              class="btn small secondary"
              data-action="open-export-settings"
              ${isBusy ? 'disabled aria-disabled="true"' : ""}
            >
              Set Metadata...
            </button>
            <button
              type="button"
              class="btn small secondary"
              data-action="open-watermark-settings"
              ${isBusy ? 'disabled aria-disabled="true"' : ""}
            >
              Add Watermark...
            </button>
            <button
              type="button"
              class="btn small secondary"
              data-action="open-header-footer-settings"
              ${isBusy ? 'disabled aria-disabled="true"' : ""}
            >
              Add Header/Footer...
            </button>
          </div>
          <div class="field-inline">
            <label class="field-label" for="export-file-name">Output filename:</label>
            <input
              id="export-file-name"
              type="text"
              class="select field-input"
              value="${escapeHtml(exportFileName)}"
              placeholder="output.pdf"
              data-ui-action="set-export-file-name"
            />
          </div>
          <div class="actions-row">
            <label><strong>Quick Selects:</strong></label>
            <button
              type="button"
              class="btn small secondary"
              data-action="filter-output-all"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              Select All Pages
            </button>
            <button
              type="button"
              class="btn small secondary"
              data-action="filter-output-rotated"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              Select Rotated Only
            </button>
            <button
              type="button"
              class="btn small secondary"
              data-action="filter-output-source-picker"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              Select From Source...
            </button>
          </div>
          <div class="actions-row output-find-row">
            <label for="output-find-range"><strong>Find Page:</strong></label>
            <select
              id="output-find-mode"
              class="select"
              data-ui-action="set-output-find-mode"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
              aria-label="Find mode"
            >
              <option value="output_position" ${outputFindMode === "output_position" ? "selected" : ""}>
                From Output
              </option>
              <option value="source_page" ${outputFindMode === "source_page" ? "selected" : ""}>
                From Source
              </option>
            </select>
            <select
              id="output-find-source-file"
              class="select"
              data-ui-action="set-output-find-source-file"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
              aria-label="Find source file"
              ${outputFindMode === "source_page" ? "" : "hidden"}
            >
              <option value="">Any source</option>
              ${sourceFindOptions}
            </select>
            <input
              id="output-find-range"
              type="text"
              class="select"
              placeholder="${findPlaceholder}"
              data-ui-action="find-output-pages-input"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
              aria-label="Find output pages"
            />
            <button
              type="button"
              class="btn small primary"
              data-action="find-output-pages"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              Go
            </button>
          </div>
          <div class="actions-row output-find-text-row">
            <label for="output-find-text"><strong>Find Text:</strong></label>
            <input
              id="output-find-text"
              type="text"
              class="select"
              placeholder="Find text in output pages"
              value="${escapeHtml(textQuery)}"
              data-ui-action="set-text-query"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            />
          </div>
          <div class="actions-row output-find-text-actions">
            <button
              type="button"
              class="btn small secondary"
              data-action="find-output-text"
              ${canSplit && !isBusy ? "" : 'disabled aria-disabled="true"'}
            >
              Select Matches
            </button>
            <button
              type="button"
              class="btn small secondary"
              data-action="export-output-text-matches"
              ${canSplit && !isBusy ? "" : 'disabled aria-disabled="true"'}
            >
              ${DOWNLOAD_ICON_HTML}Export Matches
            </button>
            <button
              type="button"
              class="btn small danger"
              data-action="keep-output-text-matches"
              ${canSplit && !isBusy ? "" : 'disabled aria-disabled="true"'}
            >
              ${CLEAR_ICON_HTML}Remove Non-Matches
            </button>
            <button
              type="button"
              class="btn small danger"
              data-action="remove-output-text-matches"
              ${canSplit && !isBusy ? "" : 'disabled aria-disabled="true"'}
            >
              ${CLEAR_ICON_HTML}Remove Matches
            </button>
          </div>
          ${
            outputTextSummaryLabel
              ? `<div class="muted">${escapeHtml(outputTextSummaryLabel)}</div>`
              : ""
          }
          <div class="actions-row">
            <button
              type="button"
              class="btn small"
              data-action="extract-selected-output"
              ${hasSelection ? "" : 'disabled aria-disabled="true"'}
            >
              ${DOWNLOAD_ICON_HTML}Extract Selected
            </button>
            <button
              type="button"
              class="btn small"
              data-action="split-output"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              ${DOWNLOAD_ICON_HTML}Split
            </button>
            <button
              type="button"
              class="btn small danger"
              data-action="delete-by-range-output"
              ${canSplit ? "" : 'disabled aria-disabled="true"'}
            >
              ${CLEAR_ICON_HTML}Delete by Range...
            </button>
          </div>
        </div>
      </details>
      <div class="section-subtitle mt-12">Export Details</div>
      <div class="export-details-stack" aria-live="polite">
        <div class="muted">
          Files: ${fileCount} · Output pages: ${outputPageCount}${selectedCount > 0 ? ` · Selected: ${selectedCount}` : ""}
        </div>
        ${
          statusText
            ? `<div class="${statusClass}">${escapeHtml(statusText)}</div>`
            : ""
        }
        <div class="muted">${metadataSummary}</div>
        <div class="muted">${watermarkSummary}</div>
        <div class="muted">${headerFooterSummary}</div>
      </div>
    </div>
  `;
}
