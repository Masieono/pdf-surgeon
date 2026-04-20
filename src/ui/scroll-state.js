const sourceFilmstripScrollByFileId = new Map();
let outputFilmstripScrollLeft = 0;
let sourceToolsDetailsOpen = false;

export function captureFocusSnapshot() {
  const appRoot = document.getElementById("app");
  const active = document.activeElement;
  if (!(appRoot instanceof HTMLElement) || !(active instanceof HTMLElement) || !appRoot.contains(active)) {
    return null;
  }

  const id = active.id;
  if (!id) {
    return null;
  }

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    let selectionStart = null;
    let selectionEnd = null;
    let selectionDirection = null;
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
      selectionDirection = active.selectionDirection;
    } catch {
      // Some input types (e.g., number) do not expose text selection APIs.
    }

    return {
      id,
      kind: active instanceof HTMLTextAreaElement ? "textarea" : "input",
      selectionStart,
      selectionEnd,
      selectionDirection,
    };
  }

  if (active instanceof HTMLSelectElement) {
    return { id, kind: "select" };
  }

  return null;
}

export function restoreFocusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id) {
    return;
  }

  const next = document.getElementById(snapshot.id);
  if (!(next instanceof HTMLElement)) {
    return;
  }

  if (
    (snapshot.kind === "input" && !(next instanceof HTMLInputElement)) ||
    (snapshot.kind === "textarea" && !(next instanceof HTMLTextAreaElement)) ||
    (snapshot.kind === "select" && !(next instanceof HTMLSelectElement))
  ) {
    return;
  }

  if (next.hasAttribute("disabled")) {
    return;
  }

  next.focus({ preventScroll: true });

  if (
    (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
    Number.isInteger(snapshot.selectionStart) &&
    Number.isInteger(snapshot.selectionEnd)
  ) {
    try {
      next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection ?? "none");
    } catch {
      // Ignore selection restoration issues for non-textual input types.
    }
  }
}

export function captureSourceFilmstripScrollSnapshot() {
  const viewport = document.querySelector("[data-source-filmstrip-viewport]");
  if (!(viewport instanceof HTMLElement)) {
    return null;
  }

  const strip = viewport.closest(".source-filmstrip");
  const fileId = strip instanceof HTMLElement ? strip.getAttribute("data-file-id") : null;
  if (typeof fileId !== "string" || !fileId) {
    return null;
  }

  return {
    fileId,
    scrollLeft: viewport.scrollLeft,
  };
}

export function persistSourceFilmstripScrollSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.fileId !== "string" || !snapshot.fileId) {
    return;
  }
  const scrollLeft = Number(snapshot.scrollLeft);
  if (!Number.isFinite(scrollLeft) || scrollLeft < 0) {
    return;
  }
  sourceFilmstripScrollByFileId.set(snapshot.fileId, scrollLeft);
}

export function restoreSourceFilmstripScroll(state) {
  const viewport = document.querySelector("[data-source-filmstrip-viewport]");
  if (!(viewport instanceof HTMLElement)) {
    return;
  }

  const selectedFileId = typeof state?.ui?.selectedFileId === "string" ? state.ui.selectedFileId : "";
  if (!selectedFileId) {
    return;
  }

  const saved = sourceFilmstripScrollByFileId.get(selectedFileId);
  if (!Number.isFinite(saved)) {
    return;
  }
  viewport.scrollLeft = Math.max(0, saved);
}

export function captureOutputFilmstripScrollSnapshot() {
  const viewport = document.querySelector("[data-output-filmstrip-viewport]");
  if (!(viewport instanceof HTMLElement)) {
    return null;
  }
  return viewport.scrollLeft;
}

export function persistOutputFilmstripScrollSnapshot(scrollLeft) {
  const parsed = Number(scrollLeft);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  outputFilmstripScrollLeft = parsed;
}

export function restoreOutputFilmstripScroll() {
  const viewport = document.querySelector("[data-output-filmstrip-viewport]");
  if (!(viewport instanceof HTMLElement)) {
    return;
  }
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  viewport.scrollLeft = Math.min(Math.max(0, outputFilmstripScrollLeft), maxScrollLeft);
}

export function captureWindowScrollSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  return {
    x: window.scrollX,
    y: window.scrollY,
  };
}

export function restoreWindowScrollSnapshot(snapshot) {
  if (!snapshot || typeof window === "undefined") {
    return;
  }
  const x = Number(snapshot.x);
  const y = Number(snapshot.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  window.scrollTo({ left: x, top: y, behavior: "auto" });
}

export function captureSourceToolsDetailsOpenSnapshot() {
  const details = document.querySelector('[data-role="source-tools-details"]');
  if (!(details instanceof HTMLDetailsElement)) {
    return null;
  }
  return details.open;
}

export function persistSourceToolsDetailsOpenSnapshot(isOpen) {
  if (typeof isOpen !== "boolean") {
    return;
  }
  sourceToolsDetailsOpen = isOpen;
}

export function restoreSourceToolsDetailsOpenSnapshot() {
  const details = document.querySelector('[data-role="source-tools-details"]');
  if (!(details instanceof HTMLDetailsElement)) {
    return;
  }
  details.open = sourceToolsDetailsOpen;
}
