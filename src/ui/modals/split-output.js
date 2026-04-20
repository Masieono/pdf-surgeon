import { exportPdfFromPageRefs } from "../../formats/pdf/pdflib-export.js";
import { parseRangeGroups } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  buildDownloadNamePlan,
  createJobId,
  downloadPdfBytes,
  toErrorMessage,
} from "../events/helpers.js";

export function openSplitOutputModal({ dispatch, getState }) {
  if (typeof getState !== "function") {
    return;
  }

  const initialState = getState();
  const initialDocPlan = Array.isArray(initialState?.docPlan) ? initialState.docPlan : [];
  if (initialDocPlan.length === 0) {
    return;
  }

  showModal({
    title: "Split Output",
    bodyHtml: `
      <p>Create multiple PDFs from the current output order.</p>
      <div class="actions-row">
        <label>
          <input id="split-mode-ranges" type="radio" name="split-mode" value="ranges" checked />
          Split by ranges
        </label>
      </div>
      <input
        id="split-ranges-input"
        type="text"
        class="select"
        placeholder="1-3,5,7-9"
      />
      <div class="hint">Use semicolons to separate groups, e.g. 1-3;4-6;7-9. Ranges are based on current output order.</div>
      <div class="actions-row">
        <label>
          <input id="split-mode-per-page" type="radio" name="split-mode" value="per-page" />
          One file per page
        </label>
      </div>
    `,
    primaryText: "Split & Download",
    secondaryText: "Cancel",
    onPrimary: () => {
      const state = getState();
      const docPlan = Array.isArray(state?.docPlan) ? state.docPlan : [];
      const files = Array.isArray(state?.files) ? state.files : [];
      const namePlan = buildDownloadNamePlan(state);
      const isBusy = Boolean(state?.runtime?.busy);

      if (isBusy) {
        showToast({
          type: "warning",
          title: "Export busy",
          message: "Please wait for the current export job to finish.",
          timeoutMs: 2400,
        });
        return false;
      }

      if (docPlan.length === 0) {
        showToast({
          type: "warning",
          title: "Nothing to split",
          message: "Output plan is empty.",
          timeoutMs: 2400,
        });
        return false;
      }

      const perPageEl = document.getElementById("split-mode-per-page");
      const rangesEl = document.getElementById("split-ranges-input");
      const onePerPage = perPageEl instanceof HTMLInputElement && perPageEl.checked;
      const rangesInput = rangesEl instanceof HTMLInputElement ? rangesEl.value : "";

      let groups;
      try {
        if (onePerPage) {
          groups = docPlan.map((_, index) => [index]);
        } else {
          groups = parseRangeGroups(rangesInput, docPlan.length);
          if (groups.length === 0) {
            throw new Error("Enter at least one range group.");
          }
        }
      } catch (error) {
        showToast({
          type: "error",
          title: "Invalid split ranges",
          message: toErrorMessage(error, "Unable to parse split ranges"),
          timeoutMs: 3200,
        });
        return false;
      }

      if (onePerPage) {
        showToast({
          type: "warning",
          title: "Multiple downloads",
          message: `${groups.length} PDF downloads will start.`,
          timeoutMs: 2600,
        });
      }

      if (namePlan.inputAdjusted) {
        showToast({
          type: "warning",
          title: "Filename adjusted",
          message: `Using "${namePlan.adjustedInputName}" as the output filename base.`,
          timeoutMs: 3200,
        });
      }

      const jobId = createJobId();
      const total = groups.length;

      void (async () => {
        try {
          if (dispatch) {
            dispatch({
              type: "RUNTIME_BUSY_SET",
              payload: { busy: true },
            });
            dispatch({ type: "RUNTIME_ERROR_CLEAR" });
            dispatch({
              type: "RUNTIME_JOB_SET",
              payload: {
                job: {
                  id: jobId,
                  type: "export_pdf",
                  stage: "exporting",
                  progress: { done: 0, total },
                  etaSeconds: null,
                  canCancel: false,
                  message: "Preparing split exports...",
                },
              },
            });
          }

          for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
            const group = groups[groupIndex];
            const pageRefs = group
              .map((index) => {
                const pageRef = docPlan[index];
                if (!pageRef || typeof pageRef.fileId !== "string") {
                  return null;
                }
                return {
                  fileId: pageRef.fileId,
                  pageIndex: pageRef.pageIndex,
                  rotation: pageRef.rotation,
                  sourceOutputIndex: index,
                };
              })
              .filter(Boolean);

            if (pageRefs.length === 0) {
              throw new Error(`Split group ${groupIndex + 1} contains no valid pages.`);
            }

            const fileName = namePlan.splitName(groupIndex, onePerPage);
            const bytes = await exportPdfFromPageRefs({
              files,
              pageRefs,
              meta: state?.ui?.exportMetadata,
              watermark: {
                ...(state?.ui?.watermark ?? {}),
                selectedOutputPageIndices: state?.ui?.selectedOutputPageIndices,
              },
              headerFooter: {
                ...(state?.ui?.headerFooter ?? {}),
                selectedOutputPageIndices: state?.ui?.selectedOutputPageIndices,
                outputPageCount: docPlan.length,
                outputFileName: fileName,
              },
            });
            downloadPdfBytes(bytes, fileName);

            if (dispatch) {
              dispatch({
                type: "RUNTIME_JOB_SET",
                payload: {
                  job: {
                    id: jobId,
                    type: "export_pdf",
                    stage: "exporting",
                    progress: { done: groupIndex + 1, total },
                    etaSeconds: null,
                    canCancel: false,
                    message: `Exported ${groupIndex + 1} of ${total}`,
                  },
                },
              });
            }
          }

          showToast({
            type: "success",
            title: "Split complete",
            message: `Downloaded ${total} PDF file${total === 1 ? "" : "s"}.`,
            timeoutMs: 2400,
          });
        } catch (error) {
          const message = toErrorMessage(error, "Failed to split output");
          if (dispatch) {
            dispatch({
              type: "RUNTIME_ERROR_SET",
              payload: { error: message },
            });
          }
          showToast({
            type: "error",
            title: "Split failed",
            message,
            timeoutMs: 3200,
          });
        } finally {
          if (dispatch) {
            dispatch({ type: "RUNTIME_JOB_CLEAR" });
            dispatch({
              type: "RUNTIME_BUSY_SET",
              payload: { busy: false },
            });
          }
        }
      })();

      return true;
    },
    onSecondary: () => true,
  });
}
