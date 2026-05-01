import {
  setActiveSharedCategory,
  setSharedOverviewData,
  setSharedOverviewQuery,
  setSharedOverviewSortNewest,
  state,
} from "./state.js";
import { apiFetch } from "./api.js";
import { escapeHtml, formatTimestamp, renderMarkdown, showToast, toProxyUrl } from "./ui.js";

const gripSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';

const ALL_CATEGORY = "alles";
const categoryLabels = {
  huis: "Huis",
  tuin: "Tuin",
  afspraken: "Afspraken",
  boodschappen: "Boodschappen",
  "nog-niet-gesorteerd": "Nog niet gesorteerd",
  later: "Later",
};

const categoryAliases = new Map([
  ["huis", "huis"],
  ["klussen", "huis"],
  ["onderhoud", "huis"],
  ["fysiek", "huis"],
  ["fysieke-taken", "huis"],
  ["tuin", "tuin"],
  ["afspraken", "afspraken"],
  ["planning", "afspraken"],
  ["persoonlijk", "afspraken"],
  ["boodschappen", "boodschappen"],
  ["kopen", "boodschappen"],
  ["nog-niet-gesorteerd", "nog-niet-gesorteerd"],
  ["nieuw", "nog-niet-gesorteerd"],
  ["inbox", "nog-niet-gesorteerd"],
  ["later", "later"],
  ["someday", "later"],
  ["someday-misschien-later", "later"],
  ["lijst", "huis"],
  ["algemeen", "huis"],
]);

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function categoryKeyForHeader(text) {
  return categoryAliases.get(slugify(text)) || null;
}

function sortEntries(entries) {
  if (!state.sharedOverviewSortNewest) return entries;
  return entries
    .filter((entry) => entry.type !== "header")
    .sort((left, right) => (right.timestamp || "").localeCompare(left.timestamp || ""));
}

function itemMatchesQueryWithSection(item, query, section) {
  if (!query) return true;
  const haystack = [
    section,
    item.text,
    ...(item.contexts || []).map((context) => context.text),
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function groupedSharedEntries(entries) {
  const categories = Object.fromEntries(
    Object.keys(categoryLabels).map((key) => [key, { key, label: categoryLabels[key], entries: [] }])
  );
  let currentKey = "huis";

  for (const entry of entries || []) {
    if (entry.type === "header") {
      if ((entry.level || 1) === 1) continue;
      const categoryKey = (entry.level || 2) <= 2 ? categoryKeyForHeader(entry.text) : null;
      if (categoryKey) {
        currentKey = categoryKey;
        continue;
      }
      categories[currentKey].entries.push(entry);
      continue;
    }

    categories[currentKey].entries.push(entry);
  }

  return Object.values(categories);
}

function itemsWithSection(category) {
  const rows = [];
  let section = "";
  for (const entry of category.entries || []) {
    if (entry.type === "header") {
      section = entry.text;
      continue;
    }
    rows.push({ category: category.key, entry, section });
  }
  return rows;
}

function isUrgent(row) {
  const text = `${row.section} ${row.entry.text}`.toLowerCase();
  return text.includes("urgent") || text.includes("🔴");
}

function isRecent(row) {
  const match = row.entry.timestamp?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const itemDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  const ageMs = Date.now() - itemDate.getTime();
  return ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000;
}

export class SharedOverviewController {
  constructor(config) {
    this.elements = config;
    this.categories = [];
    this.dragState = null;
    this.pendingDrag = null;
    this.input = config.input;
    this.sendButton = config.sendButton;
    this.onDraftChange = config.onDraftChange || (() => {});
  }

  bind() {
    this.elements.searchInput.value = state.sharedOverviewQuery;
    this.elements.searchInput.addEventListener("input", () => {
      setSharedOverviewQuery(this.elements.searchInput.value.trim());
      this.render();
    });

    this.updateSortButton();
    this.elements.sortButton.addEventListener("click", () => {
      setSharedOverviewSortNewest(!state.sharedOverviewSortNewest);
      this.updateSortButton();
      this.render();
    });

    this.elements.content.addEventListener("pointerdown", (event) => {
      let handle = event.target.closest(".drag-handle, .shared-drag-btn");
      const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
      if (!handle && isTouch && !event.target.closest("button, a, input, textarea, img")) {
        handle = event.target.closest(".shared-overview-item");
      }
      if (handle) this.queueDrag(event, handle);
    });
    this.elements.content.addEventListener("pointermove", (event) => {
      if (this.pendingDrag) this.updatePendingDrag(event);
      if (this.dragState) this.moveDrag(event);
    });
    this.elements.content.addEventListener("pointerup", () => {
      this.cancelPendingDrag();
      if (this.dragState) this.endDrag();
    });
    this.elements.content.addEventListener("pointercancel", () => {
      this.cancelPendingDrag();
      this.cancelDrag();
    });

    if (this.input) {
      this.input.placeholder = "Nieuw Anna/Bram item...";
      this.input.rows = 1;
      this.autoResizeInput();
      this.input.addEventListener("input", () => {
        this.onDraftChange(this.input.value);
        this.autoResizeInput();
      });
      this.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.submitCurrentInput();
        }
      });
    }
    if (this.sendButton) {
      this.sendButton.addEventListener("click", () => this.submitCurrentInput());
    }
  }

  updateSortButton() {
    this.elements.sortButton.classList.toggle("active", state.sharedOverviewSortNewest);
    this.elements.sortButton.title = state.sharedOverviewSortNewest ? "Standaard volgorde" : "Sorteer op nieuwste";
    this.elements.sortButton.setAttribute(
      "aria-label",
      state.sharedOverviewSortNewest ? "Standaard volgorde gedeeld overzicht" : "Sorteer gedeeld overzicht op nieuwste"
    );
  }

  renderCategoryTabs() {
    this.elements.categoryTabs.replaceChildren();

    const tabs = [
      { key: ALL_CATEGORY, label: "Alles" },
      ...Object.entries(categoryLabels).map(([key, label]) => ({ key, label })),
    ];

    if (!tabs.some((tab) => tab.key === state.activeSharedCategory)) {
      setActiveSharedCategory(ALL_CATEGORY);
    }

    for (const tab of tabs) {
      const button = document.createElement("button");
      button.className = "cat-tab";
      button.type = "button";
      button.dataset.cat = tab.key;
      button.textContent = tab.label;
      button.classList.toggle("active", tab.key === state.activeSharedCategory);
      button.addEventListener("click", () => {
        setActiveSharedCategory(tab.key);
        this.render();
      });
      this.elements.categoryTabs.appendChild(button);
    }
  }

  autoResizeInput() {
    if (!this.input) return;
    if (!this.input.value.trim()) {
      this.input.style.height = "";
      return;
    }
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight, 160)}px`;
  }

  filteredEntries(entries) {
    const query = state.sharedOverviewQuery;
    if (!query) return entries;

    const filtered = [];
    let pendingHeaders = [];
    let currentSection = "";

    for (const entry of entries) {
      if (entry.type === "header") {
        currentSection = entry.text;
        pendingHeaders = (entry.level || 2) <= 2 ? [entry] : [...pendingHeaders, entry];
        continue;
      }

      if (itemMatchesQueryWithSection(entry, query, currentSection)) {
        filtered.push(...pendingHeaders, entry);
        pendingHeaders = [];
      }
    }

    return filtered;
  }

  render() {
    this.categories = groupedSharedEntries(state.sharedOverviewData || []);
    this.renderCategoryTabs();
    this.elements.content.querySelectorAll(".focus-summary, .overview-card, .empty, .zone-header").forEach((node) => node.remove());
    this.elements.loading.classList.add("hidden");

    if (state.activeSharedCategory === ALL_CATEGORY) {
      this.renderAllCategories();
      return;
    }

    const category = this.categories.find((item) => item.key === state.activeSharedCategory);
    const entries = this.filteredEntries(category?.entries || []);
    if (!entries.some((entry) => entry.type !== "header")) {
      this.renderEmpty();
      return;
    }

    const card = document.createElement("div");
    card.className = "overview-card shared-overview-card";
    card.dataset.category = category.key;
    this.renderItemsIntoCard(card, sortEntries(entries), category.key);
    this.elements.content.appendChild(card);
  }

  renderAllCategories() {
    this.renderFocusSummary();
    let hasItems = false;
    for (const category of this.categories) {
      const entries = this.filteredEntries(category.entries);
      if (!entries.some((entry) => entry.type !== "header")) continue;

      hasItems = true;
      const card = document.createElement("div");
      card.className = "overview-card shared-overview-card zone-card zone-card-jij";
      card.dataset.category = category.key;
      const title = document.createElement("div");
      title.className = "overview-card-title";
      title.textContent = category.label;
      card.appendChild(title);
      this.renderItemsIntoCard(card, sortEntries(entries), category.key);
      this.elements.content.appendChild(card);
    }

    if (!hasItems) this.renderEmpty();
  }

  renderFocusSummary() {
    const rows = this.categories.flatMap((category) => itemsWithSection(category));
    const urgent = rows.filter(isUrgent).length;
    const recent = rows.filter(isRecent).length;
    const total = rows.length;

    const summary = document.createElement("div");
    summary.className = "focus-summary";
    summary.innerHTML = `
      <button type="button" class="focus-chip focus-chip-urgent">
        <span class="focus-value">${urgent}</span>
        <span class="focus-label">urgent</span>
      </button>
      <button type="button" class="focus-chip focus-chip-recent">
        <span class="focus-value">${recent}</span>
        <span class="focus-label">recent</span>
      </button>
      <button type="button" class="focus-chip focus-chip-all active">
        <span class="focus-value">${total}</span>
        <span class="focus-label">open</span>
      </button>
    `;
    this.elements.content.appendChild(summary);
  }

  renderEmpty() {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nog geen gesorteerde Anna/Bram-items";
    this.elements.content.appendChild(empty);
  }

  renderItemsIntoCard(card, entries, category) {
    let lastHeaderLevel = 1;
    let lastHeaderText = "";

    for (const entry of entries) {
      if (entry.type === "header") {
        lastHeaderText = entry.text;
        lastHeaderLevel = entry.level || 2;
        if (lastHeaderLevel >= 3) {
          continue;
        }
        const header = document.createElement("div");
        header.className = "overview-header-item";
        header.textContent = entry.text;
        header.dataset.category = category;
        header.dataset.section = entry.text;
        card.appendChild(header);
        continue;
      }

      const row = document.createElement("div");
      row.className = "overview-item shared-overview-item";
      row.dataset.matchKey = entry.matchKey;
      row.dataset.category = category;
      row.dataset.section = lastHeaderText;

      const handle = document.createElement("div");
      handle.className = "drag-handle";
      handle.innerHTML = gripSvg;
      if (state.sharedOverviewSortNewest || state.sharedOverviewQuery) {
        handle.classList.add("hidden");
      }

      const circle = document.createElement("button");
      circle.className = "circle";
      circle.type = "button";
      circle.title = "Markeer als klaar";
      circle.setAttribute("aria-label", `Markeer als klaar: ${entry.text}`);
      circle.addEventListener("click", () => this.markDone(entry, row));

      const textWrap = document.createElement("div");
      textWrap.className = "item-text";
      textWrap.title = "Klik om te bewerken";
      const main = document.createElement("span");
      main.className = "item-main";
      main.innerHTML = renderMarkdown(entry.text, toProxyUrl);
      if (entry.timestamp) {
        main.innerHTML += ` <span class="item-date">&middot; ${escapeHtml(formatTimestamp(entry.timestamp))}</span>`;
      }
      textWrap.appendChild(main);

      const contexts = document.createElement("div");
      contexts.className = "overview-contexts";
      (entry.contexts || []).forEach((context) => {
        const node = document.createElement("div");
        node.className = "inbox-context";
        node.innerHTML = `${escapeHtml(context.text)}${context.timestamp ? ` <span class="timestamp">${escapeHtml(formatTimestamp(context.timestamp))}</span>` : ""}`;
        contexts.appendChild(node);
      });
      textWrap.appendChild(contexts);
      textWrap.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, textarea, img")) return;
        this.openEdit(entry, row);
      });

      const more = document.createElement("button");
      more.className = "more-btn shared-drag-btn";
      more.type = "button";
      more.innerHTML = "&#8942;";
      more.title = "Sleep om te herschikken";
      more.setAttribute("aria-label", `Sleep om te herschikken: ${entry.text}`);

      row.append(handle, circle, textWrap, more);
      card.appendChild(row);
    }
  }

  async submitCurrentInput() {
    const text = this.input?.value.trim();
    if (!text) return;
    if (this.sendButton) this.sendButton.disabled = true;
    if (this.input) this.input.disabled = true;
    try {
      const data = await apiFetch("/api/shared", {
        method: "POST",
        body: JSON.stringify({ target: "overview", item: text }),
      });
      setSharedOverviewData(data.overview || []);
      if (this.input) {
        this.input.value = "";
        this.input.style.height = "";
      }
      this.onDraftChange("");
      setActiveSharedCategory("nog-niet-gesorteerd");
      this.render();
    } catch (error) {
      showToast(error.message || "Opslaan mislukt", "error");
    } finally {
      if (this.sendButton) this.sendButton.disabled = false;
      if (this.input) {
        this.input.disabled = false;
        this.input.focus();
      }
    }
  }

  openEdit(entry, row) {
    const existing = row.querySelector(".edit-input-wrap");
    if (existing) {
      existing.remove();
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "edit-input-wrap";
    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.value = entry.text;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Opslaan";

    const submit = async () => {
      const value = textarea.value.trim();
      if (!value || value === entry.text) {
        wrap.remove();
        return;
      }
      textarea.disabled = true;
      save.disabled = true;
      try {
        const data = await apiFetch("/api/shared", {
          method: "PATCH",
          body: JSON.stringify({
            action: "edit",
            matchKey: entry.matchKey,
            newText: value,
          }),
        });
        setSharedOverviewData(data.overview || []);
        this.render();
      } catch (error) {
        showToast(error.message || "Bewerken mislukt", "error");
        textarea.disabled = false;
        save.disabled = false;
      }
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
      if (event.key === "Escape") wrap.remove();
    });
    save.addEventListener("click", submit);

    wrap.append(textarea, save);
    row.querySelector(".item-text").appendChild(wrap);
    textarea.focus();
  }

  async markDone(entry, row) {
    row.classList.add("completed");
    try {
      const data = await apiFetch("/api/shared", {
        method: "PATCH",
        body: JSON.stringify({
          action: "done",
          matchKey: entry.matchKey,
        }),
      });
      setSharedOverviewData(data.overview || []);
      row.style.opacity = "0";
      setTimeout(() => this.render(), 220);
    } catch (error) {
      row.classList.remove("completed");
      showToast(error.message || "Afvinken mislukt", "error");
    }
  }

  queueDrag(event, handle) {
    const row = handle.closest(".overview-item");
    const card = row?.closest(".overview-card");
    if (!row || !card || event.button !== 0 || state.sharedOverviewSortNewest || state.sharedOverviewQuery) {
      return;
    }

    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    if (!isTouch) {
      this.startDrag(event, handle);
      return;
    }

    this.cancelPendingDrag();
    this.pendingDrag = {
      handle,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        const pending = this.pendingDrag;
        this.pendingDrag = null;
        this.startDrag({
          button: 0,
          clientX: pending.x,
          clientY: pending.y,
          pointerId: pending.pointerId,
          preventDefault() {},
        }, pending.handle);
      }, isTouch ? 180 : 0),
    };
  }

  updatePendingDrag(event) {
    const pending = this.pendingDrag;
    if (!pending || event.pointerId !== pending.pointerId) return;
    const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (moved > 9) {
      this.cancelPendingDrag();
    }
  }

  cancelPendingDrag() {
    if (!this.pendingDrag) return;
    window.clearTimeout(this.pendingDrag.timer);
    this.pendingDrag = null;
  }

  startDrag(event, handle) {
    const row = handle.closest(".overview-item");
    const card = row?.closest(".overview-card");
    if (!row || !card || event.button !== 0 || state.sharedOverviewSortNewest || state.sharedOverviewQuery) {
      return;
    }

    event.preventDefault();
    row.setPointerCapture?.(event.pointerId);
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = row.querySelector(".item-main")?.textContent || "";
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY - 16}px`;
    document.body.appendChild(ghost);

    row.classList.add("dragging");
    this.dragState = {
      row,
      ghost,
      pointerId: event.pointerId,
      indicator: null,
      drop: null,
      matchKey: row.dataset.matchKey,
    };
  }

  moveDrag(event) {
    const { ghost, row } = this.dragState;
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY - 16}px`;
    this.dragState.indicator?.remove();
    this.dragState.indicator = null;
    this.dragState.drop = null;

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const card = element?.closest(".overview-card");
    const targetCategory = card?.dataset.category;
    if (!card || !targetCategory) return;

    const anchors = [...card.querySelectorAll(".overview-header-item, .overview-item")].filter((node) => node !== row);
    if (anchors.length === 0) return;

    let anchor = anchors[anchors.length - 1];
    let placement = "after";
    for (const candidate of anchors) {
      const rect = candidate.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        anchor = candidate;
        placement = "before";
        break;
      }
    }

    const indicator = document.createElement("div");
    indicator.className = "drop-indicator";

    let drop;
    if (anchor.classList.contains("overview-header-item")) {
      anchor.after(indicator);
      drop = {
        targetHeader: anchor.dataset.section || "",
        beforeMatchKey: null,
        position: "start",
      };
    } else if (placement === "before") {
      anchor.before(indicator);
      drop = {
        targetHeader: anchor.dataset.section || "",
        beforeMatchKey: anchor.dataset.matchKey,
        position: "before",
      };
    } else {
      anchor.after(indicator);
      const items = [...card.querySelectorAll(".overview-item")].filter((item) => item !== row);
      const anchorIndex = items.indexOf(anchor);
      const nextItem = items.slice(anchorIndex + 1).find((item) => item.dataset.section === anchor.dataset.section);
      drop = {
        targetHeader: anchor.dataset.section || "",
        beforeMatchKey: nextItem?.dataset.matchKey || null,
        position: nextItem ? "before" : "end",
      };
    }

    this.dragState.indicator = indicator;
    this.dragState.drop = drop;
  }

  async endDrag() {
    const { row, ghost, indicator, drop, matchKey } = this.dragState;
    row.classList.remove("dragging");
    ghost.remove();
    if (!drop || !indicator) {
      indicator?.remove();
      this.dragState = null;
      return;
    }
    indicator.replaceWith(row);
    this.dragState = null;

    try {
      const data = await apiFetch("/api/shared", {
        method: "PATCH",
        body: JSON.stringify({
          action: "organize",
          matchKey,
          targetHeader: drop.targetHeader,
          beforeMatchKey: drop.beforeMatchKey,
          position: drop.position,
        }),
      });
      setSharedOverviewData(data.overview || []);
      this.render();
    } catch (error) {
      showToast(error.message || "Herschikken mislukt", "error");
      this.render();
    }
  }

  cancelDrag() {
    if (!this.dragState) return;
    this.dragState.row.classList.remove("dragging");
    this.dragState.ghost.remove();
    this.dragState.indicator?.remove();
    this.dragState = null;
  }
}
