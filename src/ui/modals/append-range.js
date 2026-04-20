import { parsePageRanges } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import { escapeHtml, getFileById, getFileDisplayName, toErrorMessage } from "../events/helpers.js";

export function openAppendFileRangeModal({ dispatch, getState }, fileId, initialRange = "") {
  if (!dispatch || typeof getState !== "function" || typeof fileId !== "string" || !fileId) {
    return;
  }

  const state = getState();
  const file = getFileById(state, fileId);
  const pageCount = Number.isFinite(file?.pageCount) ? file.pageCount : 0;
  if (pageCount <= 0) {
    showToast({
      type: "warning",
      title: "No pages",
      message: "This file has no available pages to append.",
      timeoutMs: 2600,
    });
    return;
  }

  const prefilled = typeof initialRange === "string" ? initialRange.trim() : "";
  showModal({
    title: "Append Range to Output",
    bodyHtml: `
      <p>Append pages from <strong>${getFileDisplayName(state, fileId)}</strong> by range.</p>
      <input
        id="append-file-range-input"
        type="text"
        class="select"
        placeholder="1-3,5,7-"
        value="${escapeHtml(prefilled)}"
      />
      <div class="hint">File has ${pageCount} page(s). Ranges are 1-based.</div>
    `,
    primaryText: "Append",
    secondaryText: "Cancel",
    onPrimary: () => {
      const inputEl = document.getElementById("append-file-range-input");
      const rawRange = inputEl instanceof HTMLInputElement ? inputEl.value.trim() : "";
      let pageIndices = [];
      try {
        pageIndices = parsePageRanges(rawRange, pageCount);
      } catch (error) {
        showToast({
          type: "error",
          title: "Invalid range",
          message: toErrorMessage(error, "Invalid page range"),
          timeoutMs: 2800,
        });
        return false;
      }

      if (pageIndices.length === 0) {
        showToast({
          type: "warning",
          title: "No pages matched",
          message: "Enter at least one in-range page.",
          timeoutMs: 2600,
        });
        return false;
      }

      dispatch({
        type: "DOCPLAN_APPEND_FILE_RANGE",
        payload: {
          fileId,
          pageIndices,
        },
      });
      return true;
    },
    onSecondary: () => true,
  });
}
