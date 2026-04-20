const TOAST_TYPES = new Set(["info", "success", "warning", "error"]);

let toastContainer = null;

export function initToasts(rootEl) {
  const toastRoot = rootEl ?? document.body;
  if (!toastRoot) {
    return;
  }

  const existing = toastRoot.querySelector(".toast-container");
  if (existing) {
    toastContainer = existing;
    return;
  }

  toastContainer = document.createElement("div");
  toastContainer.className = "toast-container";
  toastContainer.setAttribute("aria-live", "polite");
  toastContainer.setAttribute("aria-atomic", "false");
  toastRoot.appendChild(toastContainer);
}

export function showToast({ type = "info", title = "", message = "", timeoutMs = 3000 } = {}) {
  if (!toastContainer || !toastContainer.isConnected) {
    initToasts(document.body);
  }

  if (!toastContainer) {
    return;
  }

  const normalizedType = TOAST_TYPES.has(type) ? type : "info";
  const toastEl = document.createElement("div");
  toastEl.className = `toast toast--${normalizedType}`;
  toastEl.setAttribute("role", "status");

  toastEl.innerHTML = `
    <div class="toast-title">${title || normalizedType.toUpperCase()}</div>
    <div class="toast-message">${message}</div>
  `;

  toastContainer.appendChild(toastEl);

  window.setTimeout(() => {
    toastEl.remove();
  }, Math.max(500, timeoutMs));
}
