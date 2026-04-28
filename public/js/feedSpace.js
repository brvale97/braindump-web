import { apiFetch } from "./api.js";
import { showToast, confirmDialog, escapeHtml, formatTimestamp, toProxyUrl } from "./ui.js";

const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const deleteSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const contextSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

function makeButton(className, icon, title, onClick) {
  const button = document.createElement("button");
  button.className = className;
  button.innerHTML = icon;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

export class FeedSpaceController {
  constructor(config) {
    this.config = config;
    this.items = [];
    this.input = config.input;
    this.sendButton = config.sendButton;
    this.refreshButton = config.refreshButton;
    this.meta = config.meta;
    this.loading = config.loading;
    this.feed = config.feed;
    this.onDraftChange = config.onDraftChange || (() => {});
    this.onLoaded = config.onLoaded || (() => {});
  }

  bind() {
    if (this.input) {
      this.input.value = this.config.initialDraft || "";
      this.input.addEventListener("input", () => this.onDraftChange(this.input.value));
      if (!this.config.externalComposer) {
        this.input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.submitCurrentInput();
          }
        });
      }
    }

    if (this.sendButton && !this.config.externalComposer) {
      this.sendButton.addEventListener("click", () => this.submitCurrentInput());
    }

    if (this.refreshButton) {
      this.refreshButton.addEventListener("click", () => this.load());
    }
  }

  setMeta(message) {
    if (!this.meta) return;
    const time = new Intl.DateTimeFormat("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()).replace(/\u200e/g, "");
    this.meta.textContent = `${time} · ${message}`;
  }

  async load({ noCache = false, silent = false } = {}) {
    if (this.loading) this.loading.classList.remove("hidden");
    try {
      const suffix = noCache ? "?nocache=1" : "";
      const data = await apiFetch(`${this.config.endpoint}${suffix}`);
      this.items = data.items || [];
      this.render();
      this.onLoaded(this.items);
      if (!silent) this.setMeta(this.config.messages.refreshed);
      if (this.loading) this.loading.classList.add("hidden");
      return this.items;
    } catch (error) {
      if (this.loading) this.loading.textContent = "Laden mislukt";
      throw error;
    }
  }

  render() {
    const distanceFromBottom = Math.max(0, this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight);
    const stickToBottom = distanceFromBottom < 80;

    this.feed.querySelectorAll(".inbox-item").forEach((item) => item.remove());
    this.feed.querySelector(".empty")?.remove();

    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = this.config.messages.empty;
      this.feed.appendChild(empty);
      return;
    }

    this.items.forEach((item) => this.feed.appendChild(this.renderItem(item)));
    if (stickToBottom) this.feed.scrollTop = this.feed.scrollHeight;
  }

  renderItem(item) {
    const element = document.createElement("div");
    element.className = "inbox-item";
    element.dataset.matchKey = item.matchKey;

    const content = document.createElement("div");
    content.className = "inbox-item-content";

    if (item.author) {
      const badge = document.createElement("span");
      badge.className = `author-badge author-${item.author.toLowerCase()}`;
      badge.textContent = item.author;
      content.appendChild(badge);
    }

    if (item.attachment?.isImage) {
      const image = document.createElement("img");
      image.className = "inbox-img";
      image.src = toProxyUrl(item.attachment.url);
      image.alt = item.attachment.label;
      image.addEventListener("click", () => this.config.lightbox.open(image.src));
      content.appendChild(image);

      if (item.attachment.caption) {
        const caption = document.createElement("span");
        caption.className = "item-caption";
        caption.textContent = item.attachment.caption;
        content.appendChild(caption);
      }
    } else if (item.attachment) {
      const link = document.createElement("a");
      link.href = item.attachment.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = item.attachment.label;
      content.appendChild(link);
      if (item.attachment.caption) {
        const caption = document.createElement("span");
        caption.className = "item-caption";
        caption.textContent = item.attachment.caption;
        content.appendChild(caption);
      }
    } else {
      const text = document.createElement("span");
      text.className = "inbox-text";
      text.textContent = item.text;
      content.appendChild(text);
    }

    if (item.timestamp) {
      const timestamp = document.createElement("span");
      timestamp.className = "timestamp";
      timestamp.textContent = formatTimestamp(item.timestamp);
      content.appendChild(timestamp);
    }

    const contexts = document.createElement("div");
    contexts.className = "inbox-contexts";
    for (const context of item.contexts || []) {
      const row = document.createElement("div");
      row.className = "inbox-context";
      let inner = "";
      if (context.author) {
        inner += `<span class="author-badge author-${context.author.toLowerCase()}">${escapeHtml(context.author)}</span> `;
      }
      inner += escapeHtml(context.text);
      if (context.timestamp) {
        inner += ` <span class="timestamp">${escapeHtml(formatTimestamp(context.timestamp))}</span>`;
      }
      row.innerHTML = inner;
      contexts.appendChild(row);
    }
    content.appendChild(contexts);

    const actions = document.createElement("div");
    actions.className = "inbox-item-actions";
    actions.appendChild(makeButton("context-btn", contextSvg, "Context toevoegen", () => this.openContextEditor(item, element)));
    if (this.config.editable) {
      actions.appendChild(makeButton("edit-btn", editSvg, "Bewerken", () => this.openEditEditor(item, element)));
    }
    actions.appendChild(makeButton("copy-btn", copySvg, "Kopiëren", () => {
      navigator.clipboard.writeText(item.text);
      showToast("Gekopieerd");
    }));
    actions.appendChild(makeButton("delete-btn", deleteSvg, "Verwijderen", async () => {
      if (!(await confirmDialog("Dit item verwijderen?"))) return;
      await this.deleteItem(item.matchKey);
    }));

    element.appendChild(content);
    element.appendChild(actions);
    return element;
  }

  async deleteItem(matchKey) {
    const previous = [...this.items];
    this.items = this.items.filter((item) => item.matchKey !== matchKey);
    this.render();
    try {
      await apiFetch(this.config.endpoint, {
        method: "DELETE",
        body: JSON.stringify({ matchKey }),
      });
      showToast("Item verwijderd");
    } catch (error) {
      this.items = previous;
      this.render();
      showToast(error.message || "Verwijderen mislukt", "error");
    }
  }

  async submitCurrentInput() {
    const text = this.input?.value.trim();
    if (!text) return;
    this.sendButton.disabled = true;
    this.input.disabled = true;
    try {
      const data = await apiFetch(this.config.endpoint, {
        method: "POST",
        body: JSON.stringify({ item: text }),
      });
      if (data.item) {
        this.items.unshift(data.item);
        this.render();
      } else {
        await this.load({ silent: true });
      }
      this.input.value = "";
      this.onDraftChange("");
      this.setMeta(this.config.messages.sent);
    } catch (error) {
      showToast(error.message || "Opslaan mislukt", "error");
    } finally {
      this.sendButton.disabled = false;
      this.input.disabled = false;
      this.input.focus();
    }
  }

  prependItem(item) {
    this.items.unshift(item);
    this.render();
  }

  openContextEditor(item, element) {
    const existing = element.querySelector(".context-input-wrap");
    if (existing) {
      existing.remove();
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "context-input-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Context toevoegen...";
    const send = document.createElement("button");
    send.className = "context-send-btn";
    send.textContent = "Toevoegen";

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      input.disabled = true;
      send.disabled = true;
      try {
        const data = await apiFetch(this.config.endpoint, {
          method: "PATCH",
          body: JSON.stringify({ matchKey: item.matchKey, context: value }),
        });
        item.contexts.push(data.context);
        this.render();
        this.setMeta(this.config.messages.contextAdded);
      } catch (error) {
        showToast(error.message || "Context toevoegen mislukt", "error");
        input.disabled = false;
        send.disabled = false;
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") wrap.remove();
    });
    send.addEventListener("click", submit);

    wrap.append(input, send);
    element.querySelector(".inbox-item-content").appendChild(wrap);
    input.focus();
  }

  openEditEditor(item, element) {
    if (!this.config.editable || item.attachment) return;
    const content = element.querySelector(".inbox-item-content");
    if (element.classList.contains("editing")) {
      this.render();
      return;
    }

    element.classList.add("editing");
    const editWrap = document.createElement("div");
    editWrap.className = "edit-wrap";
    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = item.text;
    const row = document.createElement("div");
    row.className = "edit-btn-row";
    const save = document.createElement("button");
    save.className = "edit-save-btn";
    save.textContent = "Opslaan";
    const cancel = document.createElement("button");
    cancel.className = "edit-cancel-btn";
    cancel.textContent = "Annuleren";

    const cancelEdit = () => this.render();
    const submit = async () => {
      const value = textarea.value.trim();
      if (!value || value === item.text) {
        cancelEdit();
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      try {
        const data = await apiFetch(this.config.endpoint, {
          method: "PUT",
          body: JSON.stringify({ matchKey: item.matchKey, newText: value }),
        });
        item.text = data.item?.text || value;
        if (data.item?.matchKey) item.matchKey = data.item.matchKey;
        this.render();
        this.setMeta(this.config.messages.edited);
      } catch (error) {
        showToast(error.message || "Bewerken mislukt", "error");
        save.disabled = false;
        cancel.disabled = false;
        textarea.disabled = false;
      }
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
      if (event.key === "Escape") cancelEdit();
    });
    save.addEventListener("click", submit);
    cancel.addEventListener("click", cancelEdit);

    row.append(save, cancel);
    editWrap.append(textarea, row);
    content.innerHTML = "";
    content.appendChild(editWrap);
    textarea.focus();
  }
}
