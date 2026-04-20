import { DEFAULT_HEADER_FOOTER } from "../../config.js";
import { parsePageRanges } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  clamp,
  escapeHtml,
  normalizeOutputSelection,
  toErrorMessage,
} from "../events/helpers.js";

function normalizePosition(value, fallback = "bottom_center") {
  switch (value) {
    case "top_left":
    case "top_center":
    case "top_right":
    case "bottom_left":
    case "bottom_center":
    case "bottom_right":
      return value;
    default:
      return fallback;
  }
}

function normalizeTarget(value) {
  if (value === "selected_output_pages") {
    return "selected_output_pages";
  }
  if (value === "range_output_pages") {
    return "range_output_pages";
  }
  return "all_output_pages";
}

export function openHeaderFooterModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const docPlanLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
  const selectedIndices = normalizeOutputSelection(state?.ui?.selectedOutputPageIndices, docPlanLength);
  const headerFooter =
    state?.ui?.headerFooter && typeof state.ui.headerFooter === "object"
      ? state.ui.headerFooter
      : {};
  const initialHeaderText = escapeHtml(
    typeof headerFooter.headerText === "string" ? headerFooter.headerText : "",
  );
  const initialFooterText = escapeHtml(
    typeof headerFooter.footerText === "string" ? headerFooter.footerText : "",
  );
  const initialPageNumberFormat = escapeHtml(
    typeof headerFooter.pageNumberFormat === "string" && headerFooter.pageNumberFormat.trim()
      ? headerFooter.pageNumberFormat
      : DEFAULT_HEADER_FOOTER.pageNumberFormat,
  );
  const initialHeaderPosition = normalizePosition(
    headerFooter.headerPosition,
    DEFAULT_HEADER_FOOTER.headerPosition,
  );
  const initialFooterPosition = normalizePosition(
    headerFooter.footerPosition,
    DEFAULT_HEADER_FOOTER.footerPosition,
  );
  const initialPageNumberPosition = normalizePosition(
    headerFooter.pageNumberPosition,
    DEFAULT_HEADER_FOOTER.pageNumberPosition,
  );
  const initialTarget = normalizeTarget(headerFooter.target);
  const initialRangeInput = escapeHtml(
    typeof headerFooter.rangeInput === "string" ? headerFooter.rangeInput : "",
  );
  const initialOpacityPercent = Math.round(
    clamp(
      Number.isFinite(Number(headerFooter.opacity))
        ? Number(headerFooter.opacity)
        : DEFAULT_HEADER_FOOTER.opacity,
      0.05,
      1,
    ) * 100,
  );
  const initialFontSizePt = Math.round(
    clamp(
      Number.isFinite(Number(headerFooter.fontSizePt))
        ? Number(headerFooter.fontSizePt)
        : DEFAULT_HEADER_FOOTER.fontSizePt,
      6,
      48,
    ),
  );
  const initialMarginPt = Math.round(
    clamp(
      Number.isFinite(Number(headerFooter.marginPt))
        ? Number(headerFooter.marginPt)
        : DEFAULT_HEADER_FOOTER.marginPt,
      8,
      72,
    ),
  );
  const initialPageNumbersEnabled = headerFooter.pageNumbersEnabled === true;

  showModal({
    title: "Add Header/Footer",
    bodyHtml: `
      <div class="field-inline">
        <label for="hf-target">Pages</label>
        <select id="hf-target" class="select">
          <option value="all_output_pages" ${initialTarget === "all_output_pages" ? "selected" : ""}>
            All output pages
          </option>
          <option value="selected_output_pages" ${initialTarget === "selected_output_pages" ? "selected" : ""}>
            Selected output pages (${selectedIndices.length})
          </option>
          <option value="range_output_pages" ${initialTarget === "range_output_pages" ? "selected" : ""}>
            Range...
          </option>
        </select>
      </div>
      <div class="field-inline" id="hf-range-row" hidden>
        <label for="hf-range-input">Range</label>
        <input
          id="hf-range-input"
          type="text"
          class="select"
          placeholder="1-3,5,7-9"
          value="${initialRangeInput}"
        />
      </div>
      <div class="actions-row hf-text-row">
        <label for="hf-header-text">Header</label>
        <input
          id="hf-header-text"
          type="text"
          class="select hf-text-input"
          placeholder="Optional header text"
          value="${initialHeaderText}"
        />
        <select id="hf-header-position" class="select hf-position-select">
          <option value="top_left" ${initialHeaderPosition === "top_left" ? "selected" : ""}>Top-left</option>
          <option value="top_center" ${initialHeaderPosition === "top_center" ? "selected" : ""}>Top-center</option>
          <option value="top_right" ${initialHeaderPosition === "top_right" ? "selected" : ""}>Top-right</option>
        </select>
      </div>
      <div class="actions-row hf-text-row">
        <label for="hf-footer-text">Footer</label>
        <input
          id="hf-footer-text"
          type="text"
          class="select hf-text-input"
          placeholder="Optional footer text"
          value="${initialFooterText}"
        />
        <select id="hf-footer-position" class="select hf-position-select">
          <option value="bottom_left" ${initialFooterPosition === "bottom_left" ? "selected" : ""}>Bottom-left</option>
          <option value="bottom_center" ${initialFooterPosition === "bottom_center" ? "selected" : ""}>Bottom-center</option>
          <option value="bottom_right" ${initialFooterPosition === "bottom_right" ? "selected" : ""}>Bottom-right</option>
        </select>
      </div>
      <div class="actions-row">
        <label>
          <input
            id="hf-page-numbers-enabled"
            type="checkbox"
            ${initialPageNumbersEnabled ? "checked" : ""}
          />
          Include page numbers
        </label>
      </div>
      <div id="hf-page-number-controls" class="hf-page-number-controls">
        <div class="actions-row hf-text-row">
          <label for="hf-page-number-format">Number format</label>
          <input
            id="hf-page-number-format"
            type="text"
            class="select hf-text-input"
            value="${initialPageNumberFormat}"
            placeholder="Page {page} of {total}"
          />
        </div>
        <div class="actions-row hf-text-row">
          <label for="hf-page-number-position">Number position</label>
          <select id="hf-page-number-position" class="select hf-position-select">
            <option value="top_left" ${initialPageNumberPosition === "top_left" ? "selected" : ""}>Top-left</option>
            <option value="top_center" ${initialPageNumberPosition === "top_center" ? "selected" : ""}>Top-center</option>
            <option value="top_right" ${initialPageNumberPosition === "top_right" ? "selected" : ""}>Top-right</option>
            <option value="bottom_left" ${initialPageNumberPosition === "bottom_left" ? "selected" : ""}>Bottom-left</option>
            <option value="bottom_center" ${initialPageNumberPosition === "bottom_center" ? "selected" : ""}>Bottom-center</option>
            <option value="bottom_right" ${initialPageNumberPosition === "bottom_right" ? "selected" : ""}>Bottom-right</option>
          </select>
        </div>
      </div>
      <div class="hf-metric-row">
        <div class="hf-metric-group">
          <label for="hf-font-size">Font</label>
          <input
            id="hf-font-size"
            type="number"
            class="select hf-metric-input"
            min="6"
            max="48"
            step="1"
            value="${initialFontSizePt}"
          />
        </div>
        <div class="hf-metric-group">
          <label for="hf-opacity">Opacity</label>
          <input
            id="hf-opacity"
            type="number"
            class="select hf-metric-input"
            min="5"
            max="100"
            step="1"
            value="${initialOpacityPercent}"
          />
        </div>
        <div class="hf-metric-group">
          <label for="hf-margin">Margin</label>
          <input
            id="hf-margin"
            type="number"
            class="select hf-metric-input"
            min="8"
            max="72"
            step="1"
            value="${initialMarginPt}"
          />
        </div>
      </div>
      <div class="hint">Tokens: {page}, {total}, {input_filename}, {output_filename}</div>
    `,
    primaryText: "Save",
    secondaryText: "Cancel",
    onPrimary: () => {
      const targetEl = document.getElementById("hf-target");
      const rangeEl = document.getElementById("hf-range-input");
      const headerTextEl = document.getElementById("hf-header-text");
      const footerTextEl = document.getElementById("hf-footer-text");
      const headerPositionEl = document.getElementById("hf-header-position");
      const footerPositionEl = document.getElementById("hf-footer-position");
      const pageNumbersEnabledEl = document.getElementById("hf-page-numbers-enabled");
      const pageNumberFormatEl = document.getElementById("hf-page-number-format");
      const pageNumberPositionEl = document.getElementById("hf-page-number-position");
      const opacityEl = document.getElementById("hf-opacity");
      const fontSizeEl = document.getElementById("hf-font-size");
      const marginEl = document.getElementById("hf-margin");

      const target = normalizeTarget(targetEl instanceof HTMLSelectElement ? targetEl.value : "");
      const rangeInput = rangeEl instanceof HTMLInputElement ? rangeEl.value.trim() : "";
      const headerText = headerTextEl instanceof HTMLInputElement ? headerTextEl.value.trim() : "";
      const footerText = footerTextEl instanceof HTMLInputElement ? footerTextEl.value.trim() : "";
      const headerPosition = normalizePosition(
        headerPositionEl instanceof HTMLSelectElement ? headerPositionEl.value : "",
        DEFAULT_HEADER_FOOTER.headerPosition,
      );
      const footerPosition = normalizePosition(
        footerPositionEl instanceof HTMLSelectElement ? footerPositionEl.value : "",
        DEFAULT_HEADER_FOOTER.footerPosition,
      );
      const pageNumbersEnabled =
        pageNumbersEnabledEl instanceof HTMLInputElement ? pageNumbersEnabledEl.checked : false;
      const pageNumberFormatRaw =
        pageNumberFormatEl instanceof HTMLInputElement ? pageNumberFormatEl.value.trim() : "";
      const pageNumberFormat = pageNumberFormatRaw || DEFAULT_HEADER_FOOTER.pageNumberFormat;
      const pageNumberPosition = normalizePosition(
        pageNumberPositionEl instanceof HTMLSelectElement ? pageNumberPositionEl.value : "",
        DEFAULT_HEADER_FOOTER.pageNumberPosition,
      );
      const opacityPercentRaw = Number.parseInt(
        opacityEl instanceof HTMLInputElement ? opacityEl.value : "",
        10,
      );
      const opacityPercent = Number.isInteger(opacityPercentRaw)
        ? clamp(opacityPercentRaw, 5, 100)
        : Math.round(DEFAULT_HEADER_FOOTER.opacity * 100);
      const fontSizePtRaw = Number.parseInt(
        fontSizeEl instanceof HTMLInputElement ? fontSizeEl.value : "",
        10,
      );
      const fontSizePt = Number.isInteger(fontSizePtRaw)
        ? clamp(fontSizePtRaw, 6, 48)
        : DEFAULT_HEADER_FOOTER.fontSizePt;
      const marginPtRaw = Number.parseInt(
        marginEl instanceof HTMLInputElement ? marginEl.value : "",
        10,
      );
      const marginPt = Number.isInteger(marginPtRaw)
        ? clamp(marginPtRaw, 8, 72)
        : DEFAULT_HEADER_FOOTER.marginPt;
      const enabled = headerText.length > 0 || footerText.length > 0 || pageNumbersEnabled;

      if (target === "selected_output_pages" && selectedIndices.length === 0) {
        showToast({
          type: "warning",
          title: "No selected output pages",
          message: "Select output pages first, or switch to all output pages.",
          timeoutMs: 3000,
        });
        return false;
      }

      if (target === "range_output_pages") {
        if (!rangeInput) {
          showToast({
            type: "warning",
            title: "Range required",
            message: "Enter an output page range.",
            timeoutMs: 3000,
          });
          return false;
        }
        try {
          const indices = parsePageRanges(rangeInput, docPlanLength);
          if (indices.length === 0) {
            showToast({
              type: "warning",
              title: "No pages matched",
              message: "The range did not match any output pages.",
              timeoutMs: 3000,
            });
            return false;
          }
        } catch (error) {
          showToast({
            type: "error",
            title: "Invalid range",
            message: toErrorMessage(error, "Unable to parse output range"),
            timeoutMs: 3200,
          });
          return false;
        }
      }

      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            headerFooter: {
              enabled,
              headerText,
              footerText,
              headerPosition,
              footerPosition,
              pageNumbersEnabled,
              pageNumberFormat,
              pageNumberPosition,
              target,
              rangeInput,
              opacity: opacityPercent / 100,
              fontSizePt,
              marginPt,
            },
          },
        },
      });

      showToast({
        type: "success",
        title: "Saved",
        message: enabled ? "Header/footer settings saved." : "Header/footer cleared.",
        timeoutMs: 2000,
      });
      return true;
    },
    onSecondary: () => true,
  });

  const targetEl = document.getElementById("hf-target");
  const rangeRowEl = document.getElementById("hf-range-row");
  const rangeEl = document.getElementById("hf-range-input");
  const pageNumbersEnabledEl = document.getElementById("hf-page-numbers-enabled");
  const pageNumberControlsEl = document.getElementById("hf-page-number-controls");
  const pageNumberFormatEl = document.getElementById("hf-page-number-format");
  const pageNumberPositionEl = document.getElementById("hf-page-number-position");

  const syncTargetUi = () => {
    const target = normalizeTarget(targetEl instanceof HTMLSelectElement ? targetEl.value : "");
    const isRange = target === "range_output_pages";
    if (rangeRowEl instanceof HTMLElement) {
      rangeRowEl.hidden = !isRange;
    }
    if (rangeEl instanceof HTMLInputElement) {
      rangeEl.disabled = !isRange;
    }
  };

  const syncPageNumbersUi = () => {
    const enabled =
      pageNumbersEnabledEl instanceof HTMLInputElement && pageNumbersEnabledEl.checked;
    if (pageNumberControlsEl instanceof HTMLElement) {
      pageNumberControlsEl.hidden = !enabled;
    }
    if (pageNumberFormatEl instanceof HTMLInputElement) {
      pageNumberFormatEl.disabled = !enabled;
    }
    if (pageNumberPositionEl instanceof HTMLSelectElement) {
      pageNumberPositionEl.disabled = !enabled;
    }
  };

  if (targetEl instanceof HTMLSelectElement) {
    targetEl.addEventListener("change", syncTargetUi);
  }
  if (pageNumbersEnabledEl instanceof HTMLInputElement) {
    pageNumbersEnabledEl.addEventListener("change", syncPageNumbersUi);
  }
  syncTargetUi();
  syncPageNumbersUi();
}
