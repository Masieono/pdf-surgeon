let modalRoot = null;
let activeModal = null;
let activeModalOnClose = null;
let escapeListener = null;
let previousFocus = null;
let trapListener = null;

function handleEscape(event) {
  if (event.key === "Escape" && activeModal) {
    closeModal();
  }
}

function focusFirstPrimary(dialogEl) {
  const primaryBtn = dialogEl.querySelector("[data-modal-primary]");
  if (primaryBtn) {
    primaryBtn.focus();
  }
}

function setupFocusTrap(dialogEl) {
  trapListener = (event) => {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = dialogEl.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  dialogEl.addEventListener("keydown", trapListener);
}

function clearFocusTrap(dialogEl) {
  if (dialogEl && trapListener) {
    dialogEl.removeEventListener("keydown", trapListener);
  }
  trapListener = null;
}

export function initModals(rootEl) {
  modalRoot = rootEl ?? document.body;
}

export function showModal({
  title = "Modal",
  bodyHtml = "",
  primaryText = "OK",
  secondaryText = "Cancel",
  dialogClassName = "",
  onPrimary,
  onSecondary,
  onClose,
} = {}) {
  if (!modalRoot) {
    initModals(document.body);
  }

  closeModal();
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const hasSecondary = Boolean(secondaryText);
  const wrapper = document.createElement("div");
  wrapper.className = "modal-backdrop";

  wrapper.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title" class="modal-title">${title}</h2>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        ${hasSecondary ? '<button type="button" class="btn secondary" data-modal-secondary></button>' : ""}
        <button type="button" class="btn primary" data-modal-primary></button>
      </div>
    </div>
  `;

  const primaryBtn = wrapper.querySelector("[data-modal-primary]");
  const secondaryBtn = wrapper.querySelector("[data-modal-secondary]");
  const dialogEl = wrapper.querySelector(".modal-dialog");
  if (dialogEl && typeof dialogClassName === "string" && dialogClassName.trim()) {
    for (const className of dialogClassName.split(/\s+/)) {
      if (className) {
        dialogEl.classList.add(className);
      }
    }
  }

  if (primaryBtn) {
    primaryBtn.textContent = primaryText;
    primaryBtn.addEventListener("click", () => {
      const shouldClose = onPrimary ? onPrimary() !== false : true;
      if (shouldClose) {
        closeModal();
      }
    });
  }

  if (secondaryBtn) {
    secondaryBtn.textContent = secondaryText;
    secondaryBtn.addEventListener("click", () => {
      const shouldClose = onSecondary ? onSecondary() !== false : true;
      if (shouldClose) {
        closeModal();
      }
    });
  }

  if (hasSecondary) {
    wrapper.addEventListener("click", (event) => {
      if (event.target === wrapper) {
        const shouldClose = onSecondary ? onSecondary() !== false : true;
        if (shouldClose) {
          closeModal();
        }
      }
    });
  }

  if (dialogEl) {
    setupFocusTrap(dialogEl);
  }

  modalRoot.appendChild(wrapper);
  activeModal = wrapper;
  activeModalOnClose = typeof onClose === "function" ? onClose : null;

  escapeListener = handleEscape;
  document.addEventListener("keydown", escapeListener);

  if (dialogEl) {
    focusFirstPrimary(dialogEl);
  }
}

export function closeModal() {
  if (!activeModal) {
    return;
  }

  const onClose = activeModalOnClose;
  activeModalOnClose = null;
  const dialogEl = activeModal.querySelector(".modal-dialog");
  clearFocusTrap(dialogEl);

  activeModal.remove();
  activeModal = null;

  if (escapeListener) {
    document.removeEventListener("keydown", escapeListener);
    escapeListener = null;
  }

  if (previousFocus) {
    previousFocus.focus();
    previousFocus = null;
  }

  if (typeof onClose === "function") {
    try {
      onClose();
    } catch {
      // Ignore cleanup failures from modal consumers.
    }
  }
}
