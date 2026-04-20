import { DEFAULT_WATERMARK } from "../../config.js";
import { parsePageRanges } from "../../formats/pdf/page-ranges.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  DEFAULT_WATERMARK_TEXT,
  clamp,
  convertImageFileToPngDataUrl,
  defaultRotationForWatermarkPosition,
  drawWatermarkOnCanvas,
  escapeHtml,
  normalizeOutputSelection,
  normalizeWatermarkFontSizePct,
  normalizeWatermarkImageFit,
  normalizeWatermarkMode,
  normalizeWatermarkPosition,
  normalizeWatermarkSizeMode,
  normalizeWatermarkState,
  normalizeWatermarkTarget,
  toErrorMessage,
} from "../events/helpers.js";

export function openWatermarkModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const state = getState();
  const docPlanLength = Array.isArray(state?.docPlan) ? state.docPlan.length : 0;
  const selectedIndices = normalizeOutputSelection(state?.ui?.selectedOutputPageIndices, docPlanLength);
  const watermark = normalizeWatermarkState(state?.ui?.watermark, docPlanLength);
  const initialText = escapeHtml(watermark.text || DEFAULT_WATERMARK_TEXT);
  const initialOpacityPercent = Math.round((Number(watermark.opacity) || DEFAULT_WATERMARK.opacity) * 100);
  const initialFontSizePct = normalizeWatermarkFontSizePct(watermark.fontSizePct);
  const initialRotationDegRaw = Number(watermark.rotationDeg);
  const initialRotationDeg = Number.isFinite(initialRotationDegRaw)
    ? clamp(initialRotationDegRaw, -180, 180)
    : defaultRotationForWatermarkPosition(watermark.position);
  const initialRangeInput = escapeHtml(watermark.rangeInput || "");
  let currentImageDataUrl = watermark.imageDataUrl || "";
  let currentImageName = watermark.imageName || "";

  showModal({
    title: "Add Watermark",
    bodyHtml: `
            <div class="field-inline">
              <label for="watermark-mode">Type</label>
              <select id="watermark-mode" class="select">
                <option value="text" ${watermark.mode === "text" ? "selected" : ""}>Text</option>
                <option value="image" ${watermark.mode === "image" ? "selected" : ""}>Image</option>
              </select>
            </div>
            <div class="field-inline" id="watermark-text-row">
              <label for="watermark-text">Text</label>
              <input
                id="watermark-text"
                type="text"
                class="select"
                placeholder="CONFIDENTIAL"
                value="${initialText}"
              />
            </div>
            <div class="field-inline">
              <label for="watermark-target">Pages</label>
              <select id="watermark-target" class="select">
                <option value="all_output_pages" ${watermark.target === "all_output_pages" ? "selected" : ""}>
                  All output pages
                </option>
                <option value="odd_output_pages" ${watermark.target === "odd_output_pages" ? "selected" : ""}>
                  Odd output pages
                </option>
                <option value="even_output_pages" ${watermark.target === "even_output_pages" ? "selected" : ""}>
                  Even output pages
                </option>
                <option value="selected_output_pages" ${watermark.target === "selected_output_pages" ? "selected" : ""}>
                  Selected output pages (${selectedIndices.length})
                </option>
                <option value="range_output_pages" ${watermark.target === "range_output_pages" ? "selected" : ""}>
                  Range...
                </option>
              </select>
            </div>
            <div class="field-inline" id="watermark-range-row" hidden>
              <label for="watermark-range-input">Range</label>
              <input
                id="watermark-range-input"
                type="text"
                class="select"
                placeholder="1-3,5,7-9"
                value="${initialRangeInput}"
              />
              <span class="hint">Ranges use current output order (1-based).</span>
            </div>
            <div class="field-inline">
              <label for="watermark-position">Position</label>
              <select id="watermark-position" class="select">
                <option value="diagonal_center" ${watermark.position === "diagonal_center" ? "selected" : ""}>
                  Diagonal center
                </option>
                <option value="center" ${watermark.position === "center" ? "selected" : ""}>Center</option>
                <option value="bottom_right" ${watermark.position === "bottom_right" ? "selected" : ""}>
                  Bottom-right
                </option>
              </select>
            </div>
            <div class="field-inline" id="watermark-image-row">
              <label for="watermark-image-file">Image</label>
              <input
                id="watermark-image-file"
                type="file"
                class="select"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              />
              <span id="watermark-image-name" class="hint">
                ${escapeHtml(currentImageName || "No image selected")}
              </span>
            </div>
            <div class="field-inline" id="watermark-image-fit-row">
              <label for="watermark-image-fit">Image fit</label>
              <select id="watermark-image-fit" class="select">
                <option value="contain" ${watermark.imageFit === "contain" ? "selected" : ""}>
                  Contain
                </option>
                <option value="cover" ${watermark.imageFit === "cover" ? "selected" : ""}>
                  Cover
                </option>
              </select>
            </div>
            <div class="field-inline">
              <label for="watermark-opacity">Opacity (%)</label>
              <input
                id="watermark-opacity"
                type="number"
                class="select"
                min="5"
                max="100"
                step="1"
                value="${clamp(initialOpacityPercent, 5, 100)}"
              />
            </div>
            <div class="field-inline">
              <label for="watermark-rotation">Rotation (deg)</label>
              <input
                id="watermark-rotation"
                type="number"
                class="select"
                min="-180"
                max="180"
                step="1"
                value="${Math.round(initialRotationDeg)}"
              />
            </div>
            <div class="field-inline" id="watermark-font-size-row">
              <label for="watermark-font-size">Font size (%)</label>
              <select id="watermark-size-mode" class="select">
                <option value="manual" ${watermark.sizeMode === "manual" ? "selected" : ""}>
                  Manual
                </option>
                <option value="max_fit" ${watermark.sizeMode === "max_fit" ? "selected" : ""}>
                  Maximize (fit page)
                </option>
              </select>
              <input
                id="watermark-font-size"
                type="number"
                class="select"
                min="4"
                max="40"
                step="1"
                value="${Math.round(initialFontSizePct)}"
                ${watermark.sizeMode === "max_fit" ? "disabled" : ""}
              />
            </div>
            <div class="field-inline">
              <label>Preview</label>
              <canvas
                id="watermark-modal-preview"
                width="320"
                height="180"
                style="width:100%;max-width:320px;height:auto;border:1px solid var(--border-soft);border-radius:10px;background:#fff;display:block;"
              ></canvas>
            </div>
            <div id="watermark-modal-preview-hint" class="hint"></div>
          `,
    primaryText: "Save",
    secondaryText: "Cancel",
    onPrimary: () => {
      const modeEl = document.getElementById("watermark-mode");
      const textEl = document.getElementById("watermark-text");
      const targetEl = document.getElementById("watermark-target");
      const rangeEl = document.getElementById("watermark-range-input");
      const positionEl = document.getElementById("watermark-position");
      const imageFitEl = document.getElementById("watermark-image-fit");
      const opacityEl = document.getElementById("watermark-opacity");
      const rotationEl = document.getElementById("watermark-rotation");
      const sizeModeEl = document.getElementById("watermark-size-mode");
      const fontSizeEl = document.getElementById("watermark-font-size");

      const mode = normalizeWatermarkMode(modeEl instanceof HTMLSelectElement ? modeEl.value : "");
      const rawText = textEl instanceof HTMLInputElement ? textEl.value.trim() : "";
      const text = mode === "text" ? rawText || DEFAULT_WATERMARK_TEXT : rawText;
      const target = normalizeWatermarkTarget(targetEl instanceof HTMLSelectElement ? targetEl.value : "");
      const rangeInput = rangeEl instanceof HTMLInputElement ? rangeEl.value.trim() : "";
      const position = normalizeWatermarkPosition(
        positionEl instanceof HTMLSelectElement ? positionEl.value : "",
      );
      const imageFit = normalizeWatermarkImageFit(
        imageFitEl instanceof HTMLSelectElement ? imageFitEl.value : "",
      );
      const opacityPercentRaw = Number.parseInt(
        opacityEl instanceof HTMLInputElement ? opacityEl.value : "",
        10,
      );
      const opacityPercent = Number.isInteger(opacityPercentRaw)
        ? clamp(opacityPercentRaw, 5, 100)
        : Math.round(DEFAULT_WATERMARK.opacity * 100);
      const rotationRaw = Number.parseInt(
        rotationEl instanceof HTMLInputElement ? rotationEl.value : "",
        10,
      );
      const rotationDeg = Number.isInteger(rotationRaw)
        ? clamp(rotationRaw, -180, 180)
        : defaultRotationForWatermarkPosition(position);
      const fontSizeRaw = Number.parseInt(
        fontSizeEl instanceof HTMLInputElement ? fontSizeEl.value : "",
        10,
      );
      const fontSizePct = normalizeWatermarkFontSizePct(fontSizeRaw);
      const sizeMode = normalizeWatermarkSizeMode(
        sizeModeEl instanceof HTMLSelectElement ? sizeModeEl.value : "",
      );
      const enabled = mode === "image" ? currentImageDataUrl.length > 0 : text.trim().length > 0;

      if (enabled && mode === "image" && currentImageDataUrl.length === 0) {
        showToast({
          type: "warning",
          title: "Image required",
          message: "Select an image watermark file first.",
          timeoutMs: 3200,
        });
        return false;
      }

      if (enabled && target === "selected_output_pages" && selectedIndices.length === 0) {
        showToast({
          type: "warning",
          title: "No selected output pages",
          message: "Select output pages first, or switch target to all output pages.",
          timeoutMs: 3200,
        });
        return false;
      }

      if (enabled && target === "range_output_pages") {
        if (!rangeInput) {
          showToast({
            type: "warning",
            title: "Range required",
            message: "Enter an output page range for watermark targeting.",
            timeoutMs: 3200,
          });
          return false;
        }

        try {
          const indices = parsePageRanges(rangeInput, docPlanLength);
          if (indices.length === 0) {
            showToast({
              type: "warning",
              title: "No pages matched",
              message: "The watermark range did not match any output pages.",
              timeoutMs: 3200,
            });
            return false;
          }
        } catch (error) {
          showToast({
            type: "error",
            title: "Invalid watermark range",
            message: toErrorMessage(error, "Unable to parse watermark range"),
            timeoutMs: 3200,
          });
          return false;
        }
      }

      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            watermark: {
              enabled,
              mode,
              text,
              target,
              rangeInput,
              position,
              opacity: opacityPercent / 100,
              rotationDeg,
              sizeMode,
              fontSizePct,
              imageDataUrl: currentImageDataUrl,
              imageName: currentImageName,
              imageFit,
            },
          },
        },
      });

      showToast({
        type: "success",
        title: "Watermark saved",
        message: enabled ? "Watermark will be applied on export." : "Watermark cleared.",
        timeoutMs: 2000,
      });
      return true;
    },
    onSecondary: () => true,
  });

  const modeEl = document.getElementById("watermark-mode");
  const textEl = document.getElementById("watermark-text");
  const targetEl = document.getElementById("watermark-target");
  const rangeEl = document.getElementById("watermark-range-input");
  const rangeRowEl = document.getElementById("watermark-range-row");
  const positionEl = document.getElementById("watermark-position");
  const textRowEl = document.getElementById("watermark-text-row");
  const imageRowEl = document.getElementById("watermark-image-row");
  const imageFileEl = document.getElementById("watermark-image-file");
  const imageNameEl = document.getElementById("watermark-image-name");
  const imageFitRowEl = document.getElementById("watermark-image-fit-row");
  const imageFitEl = document.getElementById("watermark-image-fit");
  const opacityEl = document.getElementById("watermark-opacity");
  const rotationEl = document.getElementById("watermark-rotation");
  const sizeModeEl = document.getElementById("watermark-size-mode");
  const fontSizeRowEl = document.getElementById("watermark-font-size-row");
  const fontSizeEl = document.getElementById("watermark-font-size");
  const previewCanvas = document.getElementById("watermark-modal-preview");
  const previewHintEl = document.getElementById("watermark-modal-preview-hint");
  let previewVersion = 0;
  let lastWatermarkMode = normalizeWatermarkMode(
    modeEl instanceof HTMLSelectElement ? modeEl.value : watermark.mode,
  );

  const drawPreviewBackground = () => {
    if (!(previewCanvas instanceof HTMLCanvasElement)) {
      return;
    }
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, previewCanvas.width - 1, previewCanvas.height - 1);
    ctx.restore();
  };

  const syncWatermarkModalPreview = () => {
    const runVersion = ++previewVersion;
    if (!(previewCanvas instanceof HTMLCanvasElement)) {
      return;
    }

    const mode = normalizeWatermarkMode(modeEl instanceof HTMLSelectElement ? modeEl.value : "");
    const rawText = textEl instanceof HTMLInputElement ? textEl.value.trim() : "";
    const text = mode === "text" ? rawText || DEFAULT_WATERMARK_TEXT : rawText;
    const target = normalizeWatermarkTarget(targetEl instanceof HTMLSelectElement ? targetEl.value : "");
    const rangeInput = rangeEl instanceof HTMLInputElement ? rangeEl.value.trim() : "";
    const position = normalizeWatermarkPosition(
      positionEl instanceof HTMLSelectElement ? positionEl.value : "",
    );
    const imageFit = normalizeWatermarkImageFit(
      imageFitEl instanceof HTMLSelectElement ? imageFitEl.value : "",
    );
    const opacityPercentRaw = Number.parseInt(
      opacityEl instanceof HTMLInputElement ? opacityEl.value : "",
      10,
    );
    const opacityPercent = Number.isInteger(opacityPercentRaw)
      ? clamp(opacityPercentRaw, 5, 100)
      : Math.round(DEFAULT_WATERMARK.opacity * 100);
    const rotationRaw = Number.parseInt(
      rotationEl instanceof HTMLInputElement ? rotationEl.value : "",
      10,
    );
    const rotationDeg = Number.isInteger(rotationRaw)
      ? clamp(rotationRaw, -180, 180)
      : defaultRotationForWatermarkPosition(position);
    const fontSizeRaw = Number.parseInt(
      fontSizeEl instanceof HTMLInputElement ? fontSizeEl.value : "",
      10,
    );
    const fontSizePct = normalizeWatermarkFontSizePct(fontSizeRaw);
    const sizeMode = normalizeWatermarkSizeMode(
      sizeModeEl instanceof HTMLSelectElement ? sizeModeEl.value : "",
    );

    const previewWatermark = normalizeWatermarkState(
      {
        enabled: mode === "image" ? currentImageDataUrl.length > 0 : text.trim().length > 0,
        mode,
        text,
        target,
        rangeInput,
        position,
        opacity: opacityPercent / 100,
        rotationDeg,
        sizeMode,
        fontSizePct,
        imageDataUrl: currentImageDataUrl,
        imageName: currentImageName,
        imageFit,
      },
      docPlanLength,
    );

    void (async () => {
      try {
        if (!previewWatermark.enabled) {
          drawPreviewBackground();
        } else {
          await drawWatermarkOnCanvas(previewCanvas, previewWatermark, { drawBackground: true });
        }

        if (runVersion !== previewVersion) {
          return;
        }

        if (previewHintEl instanceof HTMLElement) {
          if (mode === "image" && !currentImageDataUrl) {
            previewHintEl.textContent = "Select a PNG/JPG/WEBP image watermark (max 2 MB).";
          } else if (mode === "text" && rawText.length === 0) {
            previewHintEl.textContent = `No text provided; defaulting to "${DEFAULT_WATERMARK_TEXT}".`;
          } else if (target === "range_output_pages" && rangeInput) {
            previewHintEl.textContent = "Preview updates live. Range targeting applies on timeline/export.";
          } else {
            previewHintEl.textContent = "Preview updates live as you edit.";
          }
        }
      } catch (error) {
        if (runVersion !== previewVersion) {
          return;
        }
        drawPreviewBackground();
        if (previewHintEl instanceof HTMLElement) {
          previewHintEl.textContent = toErrorMessage(error, "Failed to render watermark preview");
        }
      }
    })();
  };

  const syncWatermarkRotationFromPosition = () => {
    if (!(rotationEl instanceof HTMLInputElement) || !(positionEl instanceof HTMLSelectElement)) {
      return;
    }
    const position = normalizeWatermarkPosition(positionEl.value);
    rotationEl.value = String(defaultRotationForWatermarkPosition(position));
  };

  const syncWatermarkSizeModeUi = () => {
    if (
      !(sizeModeEl instanceof HTMLSelectElement) ||
      !(fontSizeEl instanceof HTMLInputElement)
    ) {
      return;
    }
    const mode = normalizeWatermarkMode(modeEl instanceof HTMLSelectElement ? modeEl.value : "");
    const sizeMode = normalizeWatermarkSizeMode(sizeModeEl.value);
    fontSizeEl.disabled = mode !== "text" || sizeMode === "max_fit";
  };

  const syncWatermarkModeUi = (options = {}) => {
    const applyImageDefaults = options && options.applyImageDefaults === true;
    const mode = normalizeWatermarkMode(modeEl instanceof HTMLSelectElement ? modeEl.value : "");
    const isTextMode = mode === "text";
    if (
      applyImageDefaults &&
      !isTextMode &&
      positionEl instanceof HTMLSelectElement &&
      rotationEl instanceof HTMLInputElement &&
      imageFitEl instanceof HTMLSelectElement
    ) {
      positionEl.value = "center";
      rotationEl.value = "0";
      imageFitEl.value = "cover";
    }
    if (textRowEl instanceof HTMLElement) {
      textRowEl.hidden = !isTextMode;
    }
    if (imageRowEl instanceof HTMLElement) {
      imageRowEl.hidden = isTextMode;
    }
    if (imageFitRowEl instanceof HTMLElement) {
      imageFitRowEl.hidden = isTextMode;
    }
    if (fontSizeRowEl instanceof HTMLElement) {
      fontSizeRowEl.hidden = !isTextMode;
    }
    if (textEl instanceof HTMLInputElement) {
      textEl.disabled = !isTextMode;
    }
    if (sizeModeEl instanceof HTMLSelectElement) {
      sizeModeEl.disabled = !isTextMode;
    }
    if (fontSizeEl instanceof HTMLInputElement) {
      fontSizeEl.disabled = !isTextMode || normalizeWatermarkSizeMode(sizeModeEl?.value) === "max_fit";
    }
    if (imageFileEl instanceof HTMLInputElement) {
      imageFileEl.disabled = isTextMode;
    }
    if (imageFitEl instanceof HTMLSelectElement) {
      imageFitEl.disabled = isTextMode;
    }
  };

  const syncWatermarkTargetUi = () => {
    const target = normalizeWatermarkTarget(targetEl instanceof HTMLSelectElement ? targetEl.value : "");
    const isRange = target === "range_output_pages";
    if (rangeRowEl instanceof HTMLElement) {
      rangeRowEl.hidden = !isRange;
    }
    if (rangeEl instanceof HTMLInputElement) {
      rangeEl.disabled = !isRange;
    }
  };

  for (const element of [
    modeEl,
    textEl,
    targetEl,
    rangeEl,
    positionEl,
    opacityEl,
    rotationEl,
    sizeModeEl,
    fontSizeEl,
    imageFitEl,
  ]) {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      element.addEventListener("input", syncWatermarkModalPreview);
      element.addEventListener("change", syncWatermarkModalPreview);
    }
  }
  if (positionEl instanceof HTMLSelectElement) {
    positionEl.addEventListener("change", () => {
      syncWatermarkRotationFromPosition();
      syncWatermarkModalPreview();
    });
  }
  if (sizeModeEl instanceof HTMLSelectElement) {
    sizeModeEl.addEventListener("change", syncWatermarkSizeModeUi);
  }
  if (modeEl instanceof HTMLSelectElement) {
    modeEl.addEventListener("change", () => {
      const nextMode = normalizeWatermarkMode(modeEl.value);
      const switchedToImage = nextMode === "image" && lastWatermarkMode !== "image";
      syncWatermarkModeUi({ applyImageDefaults: switchedToImage });
      lastWatermarkMode = nextMode;
      syncWatermarkModalPreview();
    });
  }
  if (targetEl instanceof HTMLSelectElement) {
    targetEl.addEventListener("change", syncWatermarkTargetUi);
  }
  if (imageFileEl instanceof HTMLInputElement) {
    imageFileEl.addEventListener("change", () => {
      const file = imageFileEl.files && imageFileEl.files.length > 0 ? imageFileEl.files[0] : null;
      if (!(file instanceof File)) {
        return;
      }

      void (async () => {
        try {
          const dataUrl = await convertImageFileToPngDataUrl(file);
          currentImageDataUrl = dataUrl;
          currentImageName = file.name || "Watermark image";
          if (imageNameEl instanceof HTMLElement) {
            imageNameEl.textContent = currentImageName;
          }
          syncWatermarkModalPreview();
        } catch (error) {
          showToast({
            type: "error",
            title: "Image watermark",
            message: toErrorMessage(error, "Failed to load watermark image"),
            timeoutMs: 3200,
          });
        }
      })();
    });
  }
  syncWatermarkModeUi();
  syncWatermarkTargetUi();
  syncWatermarkSizeModeUi();
  syncWatermarkModalPreview();
}
