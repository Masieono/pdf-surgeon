import { parsePageRanges } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  getUnlockedOutputIndices,
  normalizeOutputSelection,
  toErrorMessage,
} from "../events/helpers.js";

export function openDeleteSelectedModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const selectedIndices = normalizeOutputSelection(
    state?.ui?.selectedOutputPageIndices,
    Array.isArray(state?.docPlan) ? state.docPlan.length : 0,
  );
  const unlockedIndices = getUnlockedOutputIndices(state, selectedIndices);

  if (unlockedIndices.length === 0) {
    if (selectedIndices.length > 0) {
      showToast({
        type: "warning",
        title: "Pages are locked",
        message: "Unlock selected output pages before deleting.",
        timeoutMs: 2400,
      });
    }
    return;
  }

  showModal({
    title: "Delete Selected",
    bodyHtml: `<p>Delete ${unlockedIndices.length} selected output page(s)?</p>`,
    primaryText: "Delete",
    secondaryText: "Cancel",
    onPrimary: () => {
      dispatch({
        type: "DOCPLAN_DELETE_SELECTED",
        payload: { indices: unlockedIndices },
      });
      return true;
    },
    onSecondary: () => true,
  });
}

export function openDeleteByRangeModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
  if (docPlan.length === 0) {
    return;
  }

  showModal({
    title: "Delete by Range",
    bodyHtml: `
      <p>Delete pages from output by range string.</p>
      <input
        id="delete-range-input"
        type="text"
        class="select"
        placeholder="1-3,5,7-9"
      />
      <div class="hint">Ranges refer to current output order.</div>
    `,
    primaryText: "Delete",
    secondaryText: "Cancel",
    onPrimary: () => {
      const latestState = getState();
      const latestDocPlan = Array.isArray(latestState?.docPlan) ? latestState.docPlan : [];
      const inputEl = document.getElementById("delete-range-input");
      const value = inputEl instanceof HTMLInputElement ? inputEl.value : "";

      try {
        const indices = parsePageRanges(value, latestDocPlan.length);
        if (indices.length === 0) {
          throw new Error("Enter at least one page or range.");
        }

        dispatch({
          type: "DOCPLAN_DELETE_SELECTED",
          payload: { indices },
        });
        return true;
      } catch (error) {
        showToast({
          type: "error",
          title: "Invalid range",
          message: toErrorMessage(error, "Unable to parse range"),
          timeoutMs: 3000,
        });
        return false;
      }
    },
    onSecondary: () => true,
  });
}
