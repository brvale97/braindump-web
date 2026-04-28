let toastContainer = null;
let confirmState = null;

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

export function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  const isoMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (isoMatch) {
    const [, year, month, day, time = ""] = isoMatch;
    return `${day}-${month}-${year}${time ? ` ${time}` : ""}`;
  }
  return timestamp;
}

export function showToast(message, tone = "success", duration = 3500) {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

function ensureConfirmModal() {
  if (confirmState) return confirmState;

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay hidden";
  overlay.innerHTML = `
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Weet je het zeker?</h2>
      <p class="confirm-message"></p>
      <div class="confirm-actions">
        <button type="button" class="confirm-cancel">Annuleren</button>
        <button type="button" class="confirm-ok">Doorgaan</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".confirm-modal");
  const message = overlay.querySelector(".confirm-message");
  const cancelBtn = overlay.querySelector(".confirm-cancel");
  const okBtn = overlay.querySelector(".confirm-ok");

  let resolver = null;
  let lastFocused = null;

  function close(result) {
    overlay.classList.add("hidden");
    document.body.classList.remove("modal-open");
    if (lastFocused) lastFocused.focus();
    if (resolver) resolver(result);
    resolver = null;
  }

  cancelBtn.addEventListener("click", () => close(false));
  okBtn.addEventListener("click", () => close(true));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close(false);
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close(false);
    if (event.key === "Tab") {
      const focusables = [cancelBtn, okBtn];
      const current = focusables.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        okBtn.focus();
      } else if (!event.shiftKey && current === focusables.length - 1) {
        event.preventDefault();
        cancelBtn.focus();
      }
    }
  });

  confirmState = {
    overlay,
    modal,
    message,
    cancelBtn,
    okBtn,
    open(text) {
      lastFocused = document.activeElement;
      message.textContent = text;
      overlay.classList.remove("hidden");
      document.body.classList.add("modal-open");
      cancelBtn.focus();
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
  };

  return confirmState;
}

export function confirmDialog(text) {
  return ensureConfirmModal().open(text);
}

export function initLightbox({ lightbox, image }) {
  function close() {
    lightbox.classList.remove("open");
    image.src = "";
  }

  lightbox.addEventListener("click", () => close());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return {
    open(src) {
      image.src = src;
      lightbox.classList.add("open");
    },
    close,
  };
}

export function renderMarkdown(text, toProxyUrl) {
  const imgExts = /\.(jpe?g|png|gif|webp|svg)$/i;
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (match, label, url) => {
      if (imgExts.test(label) || imgExts.test(url)) {
        const proxyUrl = toProxyUrl(url);
        return `<img class="inbox-img" data-lightbox="true" src="${escapeHtml(proxyUrl)}" alt="${escapeHtml(label)}">`;
      }
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    });
}

export function toProxyUrl(githubUrl) {
  if (!githubUrl) return githubUrl;
  const blobMatch = githubUrl.match(/\/blob\/[^/]+\/(.+)$/);
  if (blobMatch) return `/api/image?path=${encodeURIComponent(blobMatch[1])}`;
  const rawMatch = githubUrl.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
  if (rawMatch) return `/api/image?path=${encodeURIComponent(rawMatch[1])}`;
  return githubUrl;
}
