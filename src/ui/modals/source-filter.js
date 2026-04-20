import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import { escapeHtml } from "../events/helpers.js";

export function openOutputSourceFilterModal({ dispatch, getState, applyOutputSelection }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
  if (docPlan.length === 0) {
    showToast({
      type: "warning",
      title: "Output is empty",
      message: "Add pages to output first.",
      timeoutMs: 2400,
    });
    return;
  }

  const files = Array.isArray(state?.files) ? state.files : [];
  const fileIdsInPlan = new Set(
    docPlan
      .map((pageRef) => (typeof pageRef?.fileId === "string" ? pageRef.fileId : ""))
      .filter(Boolean),
  );
  const sourceEntries = files
    .filter((file) => typeof file?.id === "string" && fileIdsInPlan.has(file.id))
    .map((file) => {
      const pageCountInOutput = docPlan.reduce((count, pageRef) => {
        return count + (pageRef?.fileId === file.id ? 1 : 0);
      }, 0);
      return {
        id: file.id,
        name: file?.name || file?.originalName || "Unnamed source",
        outputPageCount: pageCountInOutput,
      };
    });

  if (sourceEntries.length === 0) {
    showToast({
      type: "warning",
      title: "No sources in output",
      message: "No output pages are linked to imported sources.",
      timeoutMs: 2400,
    });
    return;
  }

  const preselectedSourceId =
    typeof state?.ui?.outputFindSourceFileId === "string" ? state.ui.outputFindSourceFileId : "";
  const optionsHtml = sourceEntries
    .map((entry) => {
      return `
        <label class="option">
          <input
            type="checkbox"
            name="output-source-filter"
            value="${escapeHtml(entry.id)}"
            ${preselectedSourceId && preselectedSourceId === entry.id ? "checked" : ""}
          />
          <span>${escapeHtml(entry.name)} <span class="muted">(${entry.outputPageCount} page${entry.outputPageCount === 1 ? "" : "s"} in output)</span></span>
        </label>
      `;
    })
    .join("");

  showModal({
    title: "Select From Source",
    bodyHtml: `
      <p>Select one or more sources to select matching output pages.</p>
      <div class="source-filter-list">${optionsHtml}</div>
    `,
    primaryText: "Select",
    secondaryText: "Cancel",
    onPrimary: () => {
      const selectedFileIds = Array.from(
        document.querySelectorAll('input[name="output-source-filter"]:checked'),
      )
        .map((el) => (el instanceof HTMLInputElement ? el.value : ""))
        .filter(Boolean);
      if (selectedFileIds.length === 0) {
        showToast({
          type: "warning",
          title: "Select at least one source",
          message: "Choose one or more source files.",
          timeoutMs: 2400,
        });
        return false;
      }

      const selectedSet = new Set(selectedFileIds);
      const matchedOutputIndices = docPlan
        .map((pageRef, index) => ({
          index,
          fileId: typeof pageRef?.fileId === "string" ? pageRef.fileId : "",
        }))
        .filter((entry) => selectedSet.has(entry.fileId))
        .map((entry) => entry.index);

      if (matchedOutputIndices.length === 0) {
        showToast({
          type: "warning",
          title: "No matching output pages",
          message: "No output pages match the selected source(s).",
          timeoutMs: 2600,
        });
        return false;
      }

      applyOutputSelection(matchedOutputIndices);
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            outputFindSourceFileId: selectedFileIds.length === 1 ? selectedFileIds[0] : "",
          },
        },
      });
      return true;
    },
    onSecondary: () => true,
  });
}
