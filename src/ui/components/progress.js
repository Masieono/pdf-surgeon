const JOB_TITLES = {
  export_pdf: "PDF Export",
  other: "Background Job",
};

const CLEAR_ICON_HTML = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 16 16"><use href="#i-clear"></use></svg>';

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatEta(etaSeconds) {
  if (!Number.isFinite(etaSeconds) || etaSeconds == null) {
    return "";
  }

  const total = Math.max(0, Math.floor(etaSeconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function renderJobPanel(job) {
  if (!job) {
    return "";
  }

  const title = JOB_TITLES[job.type] ?? JOB_TITLES.other;
  const stage = escapeHtml(job.stage || "Working");
  const message = escapeHtml(job.message || "Processing...");
  const done = Number.isFinite(job.progress?.done) ? Math.max(0, job.progress.done) : 0;
  const hasTotal = Number.isFinite(job.progress?.total) && job.progress.total > 0;
  const total = hasTotal ? job.progress.total : null;
  const safeDone = hasTotal ? Math.min(done, total) : done;
  const percent = hasTotal ? Math.round((safeDone / total) * 100) : null;
  const eta = formatEta(job.etaSeconds);

  return `
    <article class="job-panel" aria-live="polite">
      <div class="job-header">
        <h4 class="job-title">${escapeHtml(title)}</h4>
        ${job.canCancel ? `<button type="button" class="btn small danger" data-ui-action="cancel-job">${CLEAR_ICON_HTML}Cancel</button>` : ""}
      </div>
      <div class="job-stage">${stage}</div>
      <div class="job-message">${message}</div>
      <div class="job-progress">
        <div class="job-progress-track ${hasTotal ? "" : "job-progress-track--indeterminate"}">
          <span class="job-progress-fill" ${hasTotal ? `style="width: ${percent}%;"` : ""}></span>
        </div>
      </div>
      <div class="job-meta">
        <span>${hasTotal ? `${safeDone} / ${total}` : `${safeDone} completed`}</span>
        <span>${eta ? `ETA ${eta}` : ""}</span>
      </div>
    </article>
  `;
}
