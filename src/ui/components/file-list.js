function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CLEAR_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-clear"></use></svg>';
const PLUS_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-plus"></use></svg>';

function formatSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "Unknown size";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileTypeLabel(file) {
  const source = typeof file?.originalName === "string" && file.originalName
    ? file.originalName
    : typeof file?.name === "string"
      ? file.name
      : "";

  const match = source.match(/\.([a-z0-9]+)$/i);
  if (match?.[1]) {
    return `.${match[1].toUpperCase()}`;
  }

  if (file?.sourceType === "image") {
    return ".IMAGE";
  }
  return ".PDF";
}

function getFileMatchMeta(fileId, options) {
  if (!options?.showTextMatchCounts || typeof fileId !== "string" || !fileId) {
    return null;
  }
  const counts = options.textMatchCounts && typeof options.textMatchCounts === "object"
    ? options.textMatchCounts
    : {};
  const occurrences = options.textMatchOccurrences && typeof options.textMatchOccurrences === "object"
    ? options.textMatchOccurrences
    : {};

  const pageMatches = Number.isInteger(counts[fileId]) ? counts[fileId] : null;
  const totalHits = Number.isInteger(occurrences[fileId]) ? occurrences[fileId] : null;
  if (pageMatches == null || totalHits == null) {
    return null;
  }

  return `${totalHits} hit${totalHits === 1 ? "" : "s"} on ${pageMatches} page${pageMatches === 1 ? "" : "s"}`;
}

function renderFileRow(file, selectedFileId, showAppendToOutput, options) {
  const name = escapeHtml(file?.name || file?.originalName || "Untitled file");
  const fileId = escapeHtml(file?.id || "");
  const rawFileId = typeof file?.id === "string" ? file.id : "";
  const pageCount = Number.isFinite(file?.pageCount) ? `${file.pageCount} pages` : "Pages unknown";
  const sizeText = formatSize(file?.sizeBytes);
  const fileTypeLabel = getFileTypeLabel(file);
  const isSelected = file?.id && file.id === selectedFileId;
  const metaParts = [pageCount, sizeText, fileTypeLabel];
  const matchMeta = getFileMatchMeta(rawFileId, options);
  if (matchMeta) {
    metaParts.push(matchMeta);
  }
  const metaText = escapeHtml(metaParts.join(" | "));

  return `
    <div
      class="options${isSelected ? " selected" : ""}"
      data-ui-action="select-file"
      data-file-id="${fileId}"
      role="button"
      tabindex="0"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <div class="actions-row">
        <div class="file-row-main">
          <div><strong>${name}</strong></div>
          <div class="muted file-row-meta">${metaText}</div>
        </div>
        <div class="btn-group file-row-actions">
          ${
            showAppendToOutput
              ? `<button type="button" class="btn small primary" data-action="append-to-output" data-file-id="${fileId}">
            ${PLUS_ICON_HTML}Append to Output
          </button>`
              : ""
          }
          <button type="button" class="btn small secondary" data-action="insert-file-advanced" data-file-id="${fileId}">
            Insert...
          </button>
          <button type="button" class="btn small danger" data-ui-action="remove-file" data-file-id="${fileId}">
            ${CLEAR_ICON_HTML}Remove
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderFileList(files, selectedFileId = null, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return '<div class="muted">No files imported yet.</div>';
  }

  const showAppendToOutput = options.showAppendToOutput !== false;
  return files
    .map((file) => renderFileRow(file, selectedFileId, showAppendToOutput, options))
    .join("");
}
