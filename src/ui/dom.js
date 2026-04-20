import { renderJobPanel } from "./components/progress.js";
import { renderFileList } from "./components/file-list.js";
import { renderPagePreview } from "./components/page-preview.js";
import { renderPageGrid } from "./components/page-grid.js";
import { renderTimeline } from "./components/timeline.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSearchQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFilesMetaSummary(files) {
  const safeFiles = Array.isArray(files) ? files : [];
  const fileCount = safeFiles.length;
  const totalSize = safeFiles.reduce(
    (sum, file) => (Number.isFinite(file?.sizeBytes) ? sum + file.sizeBytes : sum),
    0,
  );
  const totalPages = safeFiles.reduce(
    (sum, file) => (Number.isFinite(file?.pageCount) ? sum + file.pageCount : sum),
    0,
  );

  const parts = [
    `${fileCount} file${fileCount === 1 ? "" : "s"}`,
    `${totalPages} page${totalPages === 1 ? "" : "s"} total`,
  ];
  const sizeText = formatBytes(totalSize);
  if (sizeText) {
    parts.push(sizeText);
  }

  return parts.join(" · ");
}

function normalizeThemePreference(value) {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return "system";
}

function getThemeButtonLabel(state) {
  const rootTheme = document?.documentElement?.getAttribute("data-theme");
  const rootPref = document?.documentElement?.getAttribute("data-theme-pref");
  const stateTheme = state?.ui?.theme;
  const pref = normalizeThemePreference(rootPref || stateTheme || "system");
  const effectiveTheme = rootTheme === "dark" ? "dark" : "light";

  if (pref === "system") {
    return `Theme: System (${effectiveTheme === "dark" ? "Dark" : "Light"})`;
  }

  return `Theme: ${pref === "dark" ? "Dark" : "Light"}`;
}

export function renderAppShell(state = {}) {
  const appRoot = document.getElementById("app");
  if (!appRoot) {
    return;
  }

  const manifestVersion =
    Number.isFinite(state?.manifestVersion) && state.manifestVersion > 0
      ? Math.floor(state.manifestVersion)
      : 1;
  const fileCount = Array.isArray(state.files) ? state.files.length : 0;
  const hasFiles = fileCount > 0;
  const isBusy = Boolean(state.runtime?.busy);
  const filesMetaSummary = hasFiles ? getFilesMetaSummary(state.files) : "";
  const selectedFileId = state.ui?.selectedFileId ?? null;
  const selectedFile = Array.isArray(state.files)
    ? state.files.find((file) => file?.id === selectedFileId) ?? null
    : null;
  const textQuery = typeof state.ui?.textQuery === "string" ? state.ui.textQuery : "";
  const normalizedTextQuery = normalizeSearchQuery(textQuery);
  const textMatchQuery = typeof state.ui?.textMatchQuery === "string" ? state.ui.textMatchQuery : "";
  const textMatchCounts =
    state.ui?.textMatchCounts && typeof state.ui.textMatchCounts === "object"
      ? state.ui.textMatchCounts
      : {};
  const textMatchOccurrences =
    state.ui?.textMatchOccurrences && typeof state.ui.textMatchOccurrences === "object"
      ? state.ui.textMatchOccurrences
      : {};
  const textSearchDetectedFiles =
    state.ui?.textSearchDetectedFiles && typeof state.ui.textSearchDetectedFiles === "object"
      ? state.ui.textSearchDetectedFiles
      : {};
  const availableFileIds = new Set(
    Array.isArray(state.files)
      ? state.files
          .filter((file) => typeof file?.id === "string" && file.id)
          .map((file) => file.id)
      : [],
  );
  const hasDetectedTextFiles = Object.entries(textSearchDetectedFiles).some(
    ([fileId, hasText]) => availableFileIds.has(fileId) && hasText === true,
  );
  const hasResolvedTextCounts = normalizedTextQuery !== "" && normalizedTextQuery === textMatchQuery;
  const selectedFileMatchCount =
    selectedFile?.id && hasResolvedTextCounts && Number.isInteger(textMatchCounts[selectedFile.id])
      ? textMatchCounts[selectedFile.id]
      : null;
  const selectedFileMatchOccurrences =
    selectedFile?.id && hasResolvedTextCounts && Number.isInteger(textMatchOccurrences[selectedFile.id])
      ? textMatchOccurrences[selectedFile.id]
      : null;
  const selectedFileMatchLabel =
    selectedFileMatchCount == null || selectedFileMatchOccurrences == null
      ? ""
      : `${selectedFileMatchOccurrences} total matches found over ${selectedFileMatchCount} page${selectedFileMatchCount === 1 ? "" : "s"} in selected file`;
  const filesHtml = hasFiles
    ? renderFileList(state.files, state.ui?.selectedFileId ?? null, {
        showAppendToOutput: true,
        showTextMatchCounts: hasResolvedTextCounts,
        textMatchCounts,
        textMatchOccurrences,
      })
    : "";
  const hasSelectedSourceFile = Boolean(selectedFile?.id);
  const selectedSourcePageCount =
    Number.isFinite(selectedFile?.pageCount) && selectedFile.pageCount > 0 ? selectedFile.pageCount : 0;
  const showAdvancedSourceTools =
    hasSelectedSourceFile && !(selectedFile?.sourceType === "image" && selectedSourcePageCount <= 1);
  const sourcePageControlsHtml = hasSelectedSourceFile ? renderPagePreview(state) : "";
  const sourceGridHtml = hasSelectedSourceFile ? renderPageGrid({ file: selectedFile, state }) : "";
  const sourceEmptyHtml = hasSelectedSourceFile
    ? ""
    : '<div class="source-empty-row muted">No source selected. Select a file from Import to review pages.</div>';
  const timelineHtml = renderTimeline({ state });
  const jobPanelHtml = state.runtime?.job ? renderJobPanel(state.runtime.job) : "";
  const themeButtonLabel = getThemeButtonLabel(state);
  appRoot.innerHTML = `
    <div class="app">
      <div class="card">
        <div class="topbar">
          <div class="title-row">
            <div>
              <h1 class="app-title">PDF Surgeon</h1>
              <p class="app-subtitle">Merge, split, extract and reorder PDF pages.</p>
            </div>
            <div class="settings">
              <button
                type="button"
                class="icon-btn"
                data-ui-action="toggle-settings-menu"
                aria-label="Settings"
                aria-haspopup="menu"
                aria-expanded="false"
              >
                <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M12 16a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2"></path>
                </svg>
              </button>

              <div class="settings-menu" role="menu" data-role="settings-menu" hidden>
                <button type="button" class="btn secondary small" role="menuitem" data-ui-action="toggle-theme">
                  <span class="btn-label">${escapeHtml(themeButtonLabel)}</span>
                </button>
                <button type="button" class="btn secondary small danger" role="menuitem" data-ui-action="clear-project">
                  Factory Reset
                </button>

                <div class="settings-divider"></div>
                <div class="settings-meta">
                  Version ${manifestVersion}
                  <span><br>Vibe coded entirely with Codex 5.3</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="section-flow">
          <div class="section">
            <div class="section-head">
              <div class="section-title">Import</div>
            </div>
            <div class="dropzone" data-dropzone data-ui-action="choose-files">
              <div class="dropzone-row">
                <div class="dropzone-text">
                  Drop PDF or image files here
                  <small class="muted">Supported: PDF, PNG, JPG, WEBP. Files stay local in your browser.</small>
                </div>
                <div class="btn-group">
                  <button type="button" class="btn primary" data-ui-action="choose-files">Choose files</button>
                </div>
              </div>
              <input
                id="file-input"
                type="file"
                hidden
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              />
            </div>
            ${hasFiles ? `<div class="imported-files-meta muted">${filesMetaSummary}</div>${filesHtml}` : ""}
          </div>

          <div class="section" data-preview-stage="review">
            <div class="section-head">
              <div class="section-title">Review Sources</div>
            </div>
            <div class="divider"></div>
            ${sourceEmptyHtml}
            ${sourceGridHtml}
            ${sourcePageControlsHtml}
            ${
              showAdvancedSourceTools
                ? `
            <details class="details-card mt-12" data-role="source-tools-details">
              <summary class="details-summary">
                <span class="details-summary-left">
                  <span class="details-summary-title">Advanced Source Tools</span>
                </span>
              </summary>
              <div class="details-body source-tools-body">
                <div class="actions-row">
                  <button
                    type="button"
                    class="btn small secondary"
                    data-action="append-selected-file-range"
                    ${selectedFile?.id ? "" : 'disabled aria-disabled="true"'}
                  >
                    Append Range...
                  </button>
                  <span class="hint">Append page ranges from the selected source file.</span>
                </div>
                ${
                  hasDetectedTextFiles
                    ? `
                <div class="actions-row">
                  <input
                    id="source-text-query"
                    type="text"
                    class="select"
                    placeholder="Find text in source pages"
                    value="${escapeHtml(textQuery)}"
                    data-ui-action="set-text-query"
                  />
                  <button
                    type="button"
                    class="btn small secondary"
                    data-action="find-source-text"
                    ${!isBusy ? "" : 'disabled aria-disabled="true"'}
                  >
                    Find Text
                  </button>
                  <button
                    type="button"
                    class="btn small"
                    data-action="append-source-text-matches"
                    ${selectedFile?.id && !isBusy ? "" : 'disabled aria-disabled="true"'}
                  >
                    Append Matches
                  </button>
                </div>
                ${
                  selectedFileMatchLabel
                    ? `<div class="muted">${escapeHtml(selectedFileMatchLabel)}</div>`
                    : normalizedTextQuery && hasResolvedTextCounts
                      ? '<div class="muted">No matches in selected file.</div>'
                      : ""
                }`
                    : '<div class="muted">No text-searchable imported files detected.</div>'
                }
              </div>
            </details>`
                : ""
            }
          </div>

          <div class="section">
            <div class="section-head">
              <div class="section-title">Output</div>
            </div>
            <div class="divider"></div>
            ${timelineHtml}
          </div>

          ${
            jobPanelHtml
              ? `
          <div class="section">
            <div class="section-head">
              <div class="section-title">Active Job</div>
              <div class="section-hint">Current background operation</div>
            </div>
            <div class="divider"></div>
            ${jobPanelHtml}
          </div>`
              : ""
          }
        </div>
      </div>
    </div>
    <div id="toast-root"></div>
    <div id="modal-root"></div>
  `;
}
