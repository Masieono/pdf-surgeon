import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import { escapeHtml } from "../events/helpers.js";

export function openExportMetadataModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const metadata = state?.ui?.exportMetadata ?? {};
  const initialTitle = escapeHtml(metadata.title ?? "");
  const initialAuthor = escapeHtml(metadata.author ?? "");
  const initialSubject = escapeHtml(metadata.subject ?? "");
  const initialKeywords = escapeHtml(metadata.keywords ?? "");

  showModal({
    title: "Set Metadata",
    bodyHtml: `
      <div class="field-inline">
        <label for="export-meta-title">Title</label>
        <input id="export-meta-title" type="text" class="select" value="${initialTitle}" />
      </div>
      <div class="field-inline">
        <label for="export-meta-author">Author</label>
        <input id="export-meta-author" type="text" class="select" value="${initialAuthor}" />
      </div>
      <div class="field-inline">
        <label for="export-meta-subject">Subject</label>
        <input id="export-meta-subject" type="text" class="select" value="${initialSubject}" />
      </div>
      <div class="field-inline">
        <label for="export-meta-keywords">Keywords</label>
        <input
          id="export-meta-keywords"
          type="text"
          class="select"
          value="${initialKeywords}"
          placeholder="invoice, quarterly, 2026"
        />
      </div>
      <div class="hint">Keywords are comma-separated.</div>
    `,
    primaryText: "Save",
    secondaryText: "Cancel",
    onPrimary: () => {
      const titleEl = document.getElementById("export-meta-title");
      const authorEl = document.getElementById("export-meta-author");
      const subjectEl = document.getElementById("export-meta-subject");
      const keywordsEl = document.getElementById("export-meta-keywords");

      const nextMetadata = {
        title: titleEl instanceof HTMLInputElement ? titleEl.value : "",
        author: authorEl instanceof HTMLInputElement ? authorEl.value : "",
        subject: subjectEl instanceof HTMLInputElement ? subjectEl.value : "",
        keywords: keywordsEl instanceof HTMLInputElement ? keywordsEl.value : "",
      };

      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            exportMetadata: nextMetadata,
          },
        },
      });

      showToast({
        type: "success",
        title: "Saved",
        message: "Metadata saved",
        timeoutMs: 1800,
      });
      return true;
    },
    onSecondary: () => true,
  });
}
