import { renderThumbnailToCanvas } from "../../formats/pdf/pdfjs-renderer.js";
import { showModal } from "../components/modals.js";
import { showToast } from "../components/toasts.js";
import {
  clamp,
  escapeHtml,
  getFileDisplayName,
  isSameDocPlanOrder,
} from "../events/helpers.js";

export function openReorderModal({ dispatch, getState }) {
  if (!dispatch || typeof getState !== "function") {
    return;
  }

  const stateAtStart = getState();
  const originalPlan = Array.isArray(stateAtStart?.docPlan)
    ? stateAtStart.docPlan.map((pageRef) => ({ ...pageRef }))
    : [];

  if (originalPlan.length <= 1) {
    showToast({
      type: "warning",
      title: "Not enough pages",
      message: "Add at least two output pages to reorder.",
      timeoutMs: 2200,
    });
    return;
  }

  let workingPlan = originalPlan.map((pageRef) => ({ ...pageRef }));
  let draggingFromIndex = null;
  let draggingSelectionIndices = null;
  let lastSelectedIndex = null;
  let boxSelectMode = false;
  const selectedSet = new Set();
  const modalListenerAbort = new AbortController();
  const lassoState = {
    active: false,
    startX: 0,
    startY: 0,
  };

  showModal({
    title: "Reorder Output",
    dialogClassName: "reorder-dialog",
    bodyHtml: `
            <div class="reorder-modal">
              <div class="actions-row">
                <button type="button" class="btn small secondary" id="reorder-clear-selection">Clear Selection</button>
                <button type="button" class="btn small secondary" id="reorder-box-select-toggle" aria-pressed="false">Box Select: Off</button>
                <div class="reorder-move-actions" id="reorder-move-actions" hidden>
                  <button type="button" class="btn small secondary" id="reorder-move-start">Move to Start</button>
                  <button type="button" class="btn small secondary" id="reorder-move-left">Move Left</button>
                  <button type="button" class="btn small secondary" id="reorder-move-right">Move Right</button>
                  <button type="button" class="btn small secondary" id="reorder-move-end">Move to End</button>
                </div>
                <div class="reorder-size-controls">
                  <button type="button" class="btn small secondary" id="reorder-size-down" aria-label="Smaller tiles">-</button>
                  <span id="reorder-size-label" class="muted reorder-size-label">Tiles: 100%</span>
                  <button type="button" class="btn small secondary" id="reorder-size-up" aria-label="Larger tiles">+</button>
                </div>
              </div>
              <div class="hint">Drag tiles to reorder pages. Use Box Select for lasso-style selection. Move target is 1-based output position.</div>
              <div class="reorder-modal-grid-wrap" id="reorder-modal-grid-wrap">
                <div id="reorder-modal-grid" class="reorder-modal-grid"></div>
                <div id="reorder-lasso" class="reorder-lasso" hidden></div>
              </div>
            </div>
          `,
    primaryText: "Apply Order",
    secondaryText: "Cancel",
    onPrimary: () => {
      if (isSameDocPlanOrder(workingPlan, originalPlan)) {
        return true;
      }

      dispatch({
        type: "DOCPLAN_SET",
        payload: { docPlan: workingPlan.map((pageRef) => ({ ...pageRef })) },
      });
      dispatch({
        type: "UI_SET",
        payload: {
          patch: {
            activeView: "output",
            selectedOutputPageIndices: [],
            lastSelectedOutputIndex: null,
            outputCursorIndex: workingPlan.length,
          },
        },
      });
      return true;
    },
    onSecondary: () => true,
    onClose: () => {
      modalListenerAbort.abort();
    },
  });

  const gridEl = document.getElementById("reorder-modal-grid");
  const gridWrapEl = document.getElementById("reorder-modal-grid-wrap");
  const lassoEl = document.getElementById("reorder-lasso");
  const clearSelectionBtn = document.getElementById("reorder-clear-selection");
  const boxSelectToggleBtn = document.getElementById("reorder-box-select-toggle");
  const moveActionsEl = document.getElementById("reorder-move-actions");
  const moveStartBtn = document.getElementById("reorder-move-start");
  const moveLeftBtn = document.getElementById("reorder-move-left");
  const moveRightBtn = document.getElementById("reorder-move-right");
  const moveEndBtn = document.getElementById("reorder-move-end");
  const sizeDownBtn = document.getElementById("reorder-size-down");
  const sizeUpBtn = document.getElementById("reorder-size-up");
  const sizeLabelEl = document.getElementById("reorder-size-label");
  if (
    !(gridEl instanceof HTMLElement) ||
    !(gridWrapEl instanceof HTMLElement) ||
    !(lassoEl instanceof HTMLElement)
  ) {
    return;
  }
  const DEFAULT_REORDER_TILE_SIZE = 144;
  const MIN_REORDER_TILE_SIZE = 96;
  const MAX_REORDER_TILE_SIZE = 192;
  const REORDER_TILE_SIZE_STEP = 12;
  let reorderTileSize = DEFAULT_REORDER_TILE_SIZE;

  const applyReorderTileSize = () => {
    gridEl.style.setProperty("--reorder-tile-size", `${reorderTileSize}px`);
  };

  const getSelectedIndices = () =>
    Array.from(selectedSet).sort((a, b) => a - b);

  const applyTileSelectionClasses = () => {
    for (const tile of gridEl.querySelectorAll(".reorder-modal-tile")) {
      if (!(tile instanceof HTMLElement)) {
        continue;
      }
      const index = Number.parseInt(tile.dataset.index || "", 10);
      tile.classList.toggle("selected", Number.isInteger(index) && selectedSet.has(index));
    }
  };

  const clearDropIndicators = () => {
    for (const tile of gridEl.querySelectorAll(".reorder-modal-tile.drop-before, .reorder-modal-tile.drop-after")) {
      tile.classList.remove("drop-before", "drop-after");
    }
  };

  const setDropIndicator = (tile, clientX) => {
    if (!(tile instanceof HTMLElement)) {
      return;
    }
    clearDropIndicators();
    const rect = tile.getBoundingClientRect();
    const insertAfter = clientX >= rect.left + rect.width / 2;
    tile.classList.add(insertAfter ? "drop-after" : "drop-before");
  };

  const getDropTargetFromIndicator = () => {
    const tile = gridEl.querySelector(".reorder-modal-tile.drop-before, .reorder-modal-tile.drop-after");
    if (!(tile instanceof HTMLElement)) {
      return null;
    }
    const index = Number.parseInt(tile.dataset.index || "", 10);
    if (!Number.isInteger(index)) {
      return null;
    }
    const insertAfter = tile.classList.contains("drop-after");
    return {
      index,
      insertAfter,
    };
  };

  const syncModalTools = () => {
    const selectedCount = selectedSet.size;
    if (clearSelectionBtn instanceof HTMLButtonElement) {
      clearSelectionBtn.disabled = selectedCount === 0;
    }
    if (moveActionsEl instanceof HTMLElement) {
      moveActionsEl.hidden = selectedCount === 0;
    }
    if (moveStartBtn instanceof HTMLButtonElement) {
      moveStartBtn.disabled = selectedCount === 0;
    }
    if (moveLeftBtn instanceof HTMLButtonElement) {
      moveLeftBtn.disabled = selectedCount === 0;
    }
    if (moveRightBtn instanceof HTMLButtonElement) {
      moveRightBtn.disabled = selectedCount === 0;
    }
    if (moveEndBtn instanceof HTMLButtonElement) {
      moveEndBtn.disabled = selectedCount === 0;
    }
    if (boxSelectToggleBtn instanceof HTMLButtonElement) {
      boxSelectToggleBtn.setAttribute("aria-pressed", boxSelectMode ? "true" : "false");
      boxSelectToggleBtn.textContent = boxSelectMode ? "Box Select: On" : "Box Select: Off";
    }
    if (sizeDownBtn instanceof HTMLButtonElement) {
      sizeDownBtn.disabled = reorderTileSize <= MIN_REORDER_TILE_SIZE;
    }
    if (sizeUpBtn instanceof HTMLButtonElement) {
      sizeUpBtn.disabled = reorderTileSize >= MAX_REORDER_TILE_SIZE;
    }
    if (sizeLabelEl instanceof HTMLElement) {
      const pct = Math.round((reorderTileSize / DEFAULT_REORDER_TILE_SIZE) * 100);
      sizeLabelEl.textContent = `Tiles: ${pct}%`;
    }
  };

  const moveWorkingItem = (fromIndex, toIndexRaw) => {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= workingPlan.length) {
      return;
    }
    const toIndex = clamp(toIndexRaw, 0, workingPlan.length);
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) {
      return;
    }
    const [moved] = workingPlan.splice(fromIndex, 1);
    if (!moved) {
      return;
    }
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    workingPlan.splice(clamp(insertAt, 0, workingPlan.length), 0, moved);
  };

  const moveAndReselect = (fromIndex, toIndexRaw) => {
    moveWorkingItem(fromIndex, toIndexRaw);
    const nextSelectedIndex = clamp(toIndexRaw, 0, Math.max(0, workingPlan.length - 1));
    selectedSet.clear();
    selectedSet.add(nextSelectedIndex);
    lastSelectedIndex = nextSelectedIndex;
    draggingFromIndex = null;
    draggingSelectionIndices = null;
    renderReorderGrid();
  };

  const moveSelectedBlockAndReselect = (indices, toIndexRaw) => {
    const selectedIndices = Array.from(
      new Set(
        Array.isArray(indices)
          ? indices.filter((index) => Number.isInteger(index) && index >= 0 && index < workingPlan.length)
          : [],
      ),
    ).sort((a, b) => a - b);
    if (selectedIndices.length === 0) {
      return;
    }

    const selectedIndexSet = new Set(selectedIndices);
    const selectedItems = selectedIndices.map((index) => workingPlan[index]).filter(Boolean);
    const remainingItems = workingPlan.filter((_, index) => !selectedIndexSet.has(index));
    const beforeCount = selectedIndices.filter((index) => index < toIndexRaw).length;
    const insertAt = clamp(toIndexRaw - beforeCount, 0, remainingItems.length);
    const nextPlan = [
      ...remainingItems.slice(0, insertAt),
      ...selectedItems,
      ...remainingItems.slice(insertAt),
    ];

    if (isSameDocPlanOrder(nextPlan, workingPlan)) {
      draggingFromIndex = null;
      draggingSelectionIndices = null;
      return;
    }

    workingPlan = nextPlan;
    selectedSet.clear();
    for (let offset = 0; offset < selectedItems.length; offset += 1) {
      selectedSet.add(insertAt + offset);
    }
    lastSelectedIndex = insertAt + selectedItems.length - 1;
    draggingFromIndex = null;
    draggingSelectionIndices = null;
    renderReorderGrid();
  };

  const moveSelectedToEdge = (toEnd) => {
    const selectedIndices = getSelectedIndices();
    if (selectedIndices.length === 0) {
      return;
    }

    const selectedIndexSet = new Set(selectedIndices);
    const selectedItems = selectedIndices.map((index) => workingPlan[index]).filter(Boolean);
    const remainingItems = workingPlan.filter((_, index) => !selectedIndexSet.has(index));
    const insertAt = toEnd ? remainingItems.length : 0;
    workingPlan = toEnd
      ? [...remainingItems, ...selectedItems]
      : [...selectedItems, ...remainingItems];

    selectedSet.clear();
    for (let offset = 0; offset < selectedItems.length; offset += 1) {
      selectedSet.add(insertAt + offset);
    }
    lastSelectedIndex = insertAt + selectedItems.length - 1;
  };

  const moveSelectedByDelta = (delta) => {
    const selectedIndices = getSelectedIndices();
    if (selectedIndices.length === 0) {
      return;
    }
    if (delta < 0) {
      for (let index = 1; index < workingPlan.length; index += 1) {
        if (!selectedSet.has(index) || selectedSet.has(index - 1)) {
          continue;
        }
        const temp = workingPlan[index - 1];
        workingPlan[index - 1] = workingPlan[index];
        workingPlan[index] = temp;
        selectedSet.delete(index);
        selectedSet.add(index - 1);
      }
    } else if (delta > 0) {
      for (let index = workingPlan.length - 2; index >= 0; index -= 1) {
        if (!selectedSet.has(index) || selectedSet.has(index + 1)) {
          continue;
        }
        const temp = workingPlan[index + 1];
        workingPlan[index + 1] = workingPlan[index];
        workingPlan[index] = temp;
        selectedSet.delete(index);
        selectedSet.add(index + 1);
      }
    }
    const nextSelection = getSelectedIndices();
    lastSelectedIndex = nextSelection.length > 0 ? nextSelection[nextSelection.length - 1] : null;
  };

  const setSingleSelection = (index) => {
    selectedSet.clear();
    selectedSet.add(index);
    lastSelectedIndex = index;
  };

  const toggleSelection = (index) => {
    if (selectedSet.has(index)) {
      selectedSet.delete(index);
    } else {
      selectedSet.add(index);
    }
    lastSelectedIndex = index;
  };

  const selectRange = (index) => {
    const anchor = Number.isInteger(lastSelectedIndex) ? lastSelectedIndex : index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    selectedSet.clear();
    for (let current = start; current <= end; current += 1) {
      selectedSet.add(current);
    }
    lastSelectedIndex = index;
  };

  const beginLasso = (startClientX, startClientY) => {
    const rect = gridEl.getBoundingClientRect();
    lassoState.active = true;
    lassoState.startX = startClientX - rect.left + gridEl.scrollLeft;
    lassoState.startY = startClientY - rect.top + gridEl.scrollTop;
    lassoEl.hidden = false;
    lassoEl.style.left = `${lassoState.startX}px`;
    lassoEl.style.top = `${lassoState.startY}px`;
    lassoEl.style.width = "0px";
    lassoEl.style.height = "0px";
  };

  const updateLasso = (clientX, clientY) => {
    if (!lassoState.active) {
      return;
    }
    const rect = gridEl.getBoundingClientRect();
    const currentX = clientX - rect.left + gridEl.scrollLeft;
    const currentY = clientY - rect.top + gridEl.scrollTop;
    const left = Math.min(lassoState.startX, currentX);
    const top = Math.min(lassoState.startY, currentY);
    const width = Math.abs(currentX - lassoState.startX);
    const height = Math.abs(currentY - lassoState.startY);

    lassoEl.style.left = `${left}px`;
    lassoEl.style.top = `${top}px`;
    lassoEl.style.width = `${width}px`;
    lassoEl.style.height = `${height}px`;

    const selectedNow = new Set();
    for (const tile of gridEl.querySelectorAll(".reorder-modal-tile")) {
      if (!(tile instanceof HTMLElement)) {
        continue;
      }
      const index = Number.parseInt(tile.dataset.index || "", 10);
      if (!Number.isInteger(index)) {
        continue;
      }
      const tileRect = tile.getBoundingClientRect();
      const tileLeft = tileRect.left - rect.left + gridEl.scrollLeft;
      const tileTop = tileRect.top - rect.top + gridEl.scrollTop;
      const tileRight = tileLeft + tileRect.width;
      const tileBottom = tileTop + tileRect.height;
      const intersects =
        tileRight >= left &&
        tileLeft <= left + width &&
        tileBottom >= top &&
        tileTop <= top + height;
      if (intersects) {
        selectedNow.add(index);
      }
    }

    selectedSet.clear();
    for (const index of selectedNow) {
      selectedSet.add(index);
    }
    applyTileSelectionClasses();
    syncModalTools();
  };

  const endLasso = () => {
    if (!lassoState.active) {
      return;
    }
    lassoState.active = false;
    lassoEl.hidden = true;
    lassoEl.style.width = "0px";
    lassoEl.style.height = "0px";
  };

  const renderReorderGrid = () => {
    applyReorderTileSize();
    gridEl.innerHTML = workingPlan
      .map((pageRef, index) => {
        const fileName = escapeHtml(getFileDisplayName(stateAtStart, pageRef?.fileId));
        const pageIndex = Number.isFinite(pageRef?.pageIndex) ? pageRef.pageIndex : 0;
        const rotation = Number.isFinite(pageRef?.rotation) ? pageRef.rotation : 0;
        const locked = pageRef?.locked === true;
        return `
                <div
                  class="reorder-modal-tile"
                  data-index="${index}"
                  data-locked="${locked ? "true" : "false"}"
                  draggable="${!locked && !boxSelectMode ? "true" : "false"}"
                >
                  <canvas
                    class="reorder-modal-canvas"
                    data-file-id="${escapeHtml(pageRef?.fileId || "")}"
                    data-page-index="${pageIndex}"
                    data-rotation="${rotation}"
                  ></canvas>
                  <div class="reorder-modal-meta">
                    <strong>#${index + 1}</strong> · Page ${pageIndex + 1}${rotation ? ` · ⟳ ${rotation}°` : ""}${locked ? " · Locked" : ""}
                  </div>
                  <div class="reorder-modal-meta muted" title="${fileName}">${fileName}</div>
                </div>
              `;
      })
      .join("");

    clearDropIndicators();
    for (const tile of gridEl.querySelectorAll(".reorder-modal-tile")) {
      if (!(tile instanceof HTMLElement)) {
        continue;
      }

      tile.addEventListener("click", (clickEvent) => {
        const index = Number.parseInt(tile.dataset.index || "", 10);
        if (!Number.isInteger(index)) {
          return;
        }
        if (clickEvent.shiftKey) {
          selectRange(index);
        } else if (clickEvent.ctrlKey || clickEvent.metaKey) {
          toggleSelection(index);
        } else {
          setSingleSelection(index);
        }
        applyTileSelectionClasses();
        syncModalTools();
      }, { signal: modalListenerAbort.signal });

      tile.addEventListener("dragstart", (dragEvent) => {
        const fromIndex = Number.parseInt(tile.dataset.index || "", 10);
        if (!Number.isInteger(fromIndex)) {
          dragEvent.preventDefault();
          return;
        }

        if (!selectedSet.has(fromIndex)) {
          setSingleSelection(fromIndex);
          applyTileSelectionClasses();
          syncModalTools();
        }

        const currentSelection = getSelectedIndices();
        draggingFromIndex = fromIndex;
        draggingSelectionIndices = currentSelection.length > 0 ? currentSelection : [fromIndex];
        tile.classList.add("dragging");
        if (dragEvent.dataTransfer) {
          dragEvent.dataTransfer.effectAllowed = "move";
          dragEvent.dataTransfer.setData("text/plain", String(fromIndex));
        }
      }, { signal: modalListenerAbort.signal });

      tile.addEventListener("dragend", () => {
        draggingFromIndex = null;
        draggingSelectionIndices = null;
        tile.classList.remove("dragging");
        clearDropIndicators();
      }, { signal: modalListenerAbort.signal });

      tile.addEventListener("dragover", (dragEvent) => {
        if (!Number.isInteger(draggingFromIndex)) {
          return;
        }
        dragEvent.preventDefault();
        setDropIndicator(tile, dragEvent.clientX);
        if (dragEvent.dataTransfer) {
          dragEvent.dataTransfer.dropEffect = "move";
        }
      }, { signal: modalListenerAbort.signal });

      tile.addEventListener("dragleave", (dragEvent) => {
        const related = dragEvent.relatedTarget;
        if (related instanceof Node && tile.contains(related)) {
          return;
        }
        tile.classList.remove("drop-before", "drop-after");
      }, { signal: modalListenerAbort.signal });

      tile.addEventListener("drop", (dropEvent) => {
        dropEvent.preventDefault();
        dropEvent.stopPropagation();
        if (!Number.isInteger(draggingFromIndex)) {
          return;
        }
        const targetIndex = Number.parseInt(tile.dataset.index || "", 10);
        if (!Number.isInteger(targetIndex)) {
          return;
        }

        const rect = tile.getBoundingClientRect();
        const insertAfter = dropEvent.clientX >= rect.left + rect.width / 2;
        const toIndex = targetIndex + (insertAfter ? 1 : 0);
        if (Array.isArray(draggingSelectionIndices) && draggingSelectionIndices.length > 1) {
          moveSelectedBlockAndReselect(draggingSelectionIndices, toIndex);
        } else {
          moveAndReselect(draggingFromIndex, toIndex);
        }
      }, { signal: modalListenerAbort.signal });
    }

    for (const canvas of gridEl.querySelectorAll(".reorder-modal-canvas")) {
      if (!(canvas instanceof HTMLCanvasElement)) {
        continue;
      }
      const fileId = canvas.dataset.fileId;
      const pageIndex = Number.parseInt(canvas.dataset.pageIndex || "", 10);
      const rotation = Number.parseInt(canvas.dataset.rotation || "0", 10) || 0;
      if (!fileId || !Number.isInteger(pageIndex)) {
        continue;
      }
      const measuredWidth = Math.round(canvas.getBoundingClientRect().width);
      const thumbWidthPx = clamp(
        measuredWidth > 0 ? measuredWidth : reorderTileSize - 16,
        48,
        MAX_REORDER_TILE_SIZE,
      );
      void renderThumbnailToCanvas({
        fileId,
        pageIndex,
        thumbWidthPx,
        rotation,
        canvas,
      }).catch(() => {
        // Ignore per-tile render failures in reorder modal.
      });
    }

    applyTileSelectionClasses();
    syncModalTools();
  };

  if (clearSelectionBtn instanceof HTMLButtonElement) {
    clearSelectionBtn.addEventListener("click", () => {
      selectedSet.clear();
      lastSelectedIndex = null;
      applyTileSelectionClasses();
      syncModalTools();
    }, { signal: modalListenerAbort.signal });
  }

  if (boxSelectToggleBtn instanceof HTMLButtonElement) {
    boxSelectToggleBtn.addEventListener("click", () => {
      boxSelectMode = !boxSelectMode;
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (moveStartBtn instanceof HTMLButtonElement) {
    moveStartBtn.addEventListener("click", () => {
      moveSelectedToEdge(false);
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (moveEndBtn instanceof HTMLButtonElement) {
    moveEndBtn.addEventListener("click", () => {
      moveSelectedToEdge(true);
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (moveLeftBtn instanceof HTMLButtonElement) {
    moveLeftBtn.addEventListener("click", () => {
      moveSelectedByDelta(-1);
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (moveRightBtn instanceof HTMLButtonElement) {
    moveRightBtn.addEventListener("click", () => {
      moveSelectedByDelta(1);
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (sizeDownBtn instanceof HTMLButtonElement) {
    sizeDownBtn.addEventListener("click", () => {
      reorderTileSize = clamp(
        reorderTileSize - REORDER_TILE_SIZE_STEP,
        MIN_REORDER_TILE_SIZE,
        MAX_REORDER_TILE_SIZE,
      );
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  if (sizeUpBtn instanceof HTMLButtonElement) {
    sizeUpBtn.addEventListener("click", () => {
      reorderTileSize = clamp(
        reorderTileSize + REORDER_TILE_SIZE_STEP,
        MIN_REORDER_TILE_SIZE,
        MAX_REORDER_TILE_SIZE,
      );
      renderReorderGrid();
    }, { signal: modalListenerAbort.signal });
  }

  gridEl.addEventListener("dragover", (dragEvent) => {
    if (!Number.isInteger(draggingFromIndex)) {
      return;
    }
    dragEvent.preventDefault();
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = "move";
    }
    const targetElement = dragEvent.target instanceof Element ? dragEvent.target.closest(".reorder-modal-tile") : null;
    if (targetElement instanceof HTMLElement) {
      setDropIndicator(targetElement, dragEvent.clientX);
      return;
    }
    const tiles = Array.from(gridEl.querySelectorAll(".reorder-modal-tile")).filter((tile) => tile instanceof HTMLElement);
    if (tiles.length === 0) {
      return;
    }
    const firstTile = tiles[0];
    const lastTile = tiles[tiles.length - 1];
    if (!(firstTile instanceof HTMLElement) || !(lastTile instanceof HTMLElement)) {
      return;
    }
    const firstRect = firstTile.getBoundingClientRect();
    const lastRect = lastTile.getBoundingClientRect();
    if (dragEvent.clientY <= firstRect.top || dragEvent.clientX <= firstRect.left) {
      setDropIndicator(firstTile, firstRect.left - 1);
      return;
    }
    if (dragEvent.clientY >= lastRect.bottom || dragEvent.clientX >= lastRect.right) {
      setDropIndicator(lastTile, lastRect.right + 1);
    }
  }, { signal: modalListenerAbort.signal });

  gridEl.addEventListener("dragleave", (dragEvent) => {
    const related = dragEvent.relatedTarget;
    if (related instanceof Node && gridEl.contains(related)) {
      return;
    }
    clearDropIndicators();
  }, { signal: modalListenerAbort.signal });

  gridEl.addEventListener("drop", (dropEvent) => {
    if (!Number.isInteger(draggingFromIndex)) {
      return;
    }
    const dropTarget = getDropTargetFromIndicator();
    clearDropIndicators();
    if (!dropTarget) {
      return;
    }
    dropEvent.preventDefault();
    const toIndex = dropTarget.index + (dropTarget.insertAfter ? 1 : 0);
    if (Array.isArray(draggingSelectionIndices) && draggingSelectionIndices.length > 1) {
      moveSelectedBlockAndReselect(draggingSelectionIndices, toIndex);
    } else {
      moveAndReselect(draggingFromIndex, toIndex);
    }
  }, { signal: modalListenerAbort.signal });

  gridEl.addEventListener("pointerdown", (pointerEvent) => {
    if (!boxSelectMode || pointerEvent.button !== 0) {
      return;
    }
    beginLasso(pointerEvent.clientX, pointerEvent.clientY);
    pointerEvent.preventDefault();
  }, { signal: modalListenerAbort.signal });

  document.addEventListener("pointermove", (pointerEvent) => {
    if (!boxSelectMode || !lassoState.active) {
      return;
    }
    updateLasso(pointerEvent.clientX, pointerEvent.clientY);
  }, { signal: modalListenerAbort.signal });

  document.addEventListener("pointerup", () => {
    endLasso();
  }, { signal: modalListenerAbort.signal });

  syncModalTools();
  renderReorderGrid();
}
