import { apiFetch } from "./api.js";
import { setActiveCategory, setOverviewData, setOverviewQuery, setSortNewest, state } from "./state.js";
import { showToast, escapeHtml, formatTimestamp, renderMarkdown, toProxyUrl } from "./ui.js";

const gripSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
const moveSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const contextSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

const categoryLabels = {
  werk: "GEP",
  fysiek: "Fysiek",
  code: "Code",
  persoonlijk: "Persoonlijk",
  someday: "Someday",
};

function makeIconButton(className, icon, title, onClick) {
  const button = document.createElement("button");
  button.className = className;
  button.innerHTML = icon;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function itemMatchesQuery(item, query) {
  if (!query) return true;
  const haystack = [item.text, ...(item.contexts || []).map((context) => context.text)].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortEntries(entries) {
  if (!state.sortNewest) return entries;
  const onlyItems = entries.filter((entry) => entry.type !== "header");
  onlyItems.sort((left, right) => (right.timestamp || "").localeCompare(left.timestamp || ""));
  return onlyItems;
}

function reorderEntriesByMove(entries, matchKey, targetHeader, beforeMatchKey, position = "end") {
  const moved = entries.find((entry) => entry.type === "item" && entry.matchKey === matchKey);
  if (!moved) return entries;

  const withoutMoved = entries.filter((entry) => entry !== moved);
  let insertIndex = withoutMoved.length;

  if (beforeMatchKey) {
    const beforeIndex = withoutMoved.findIndex((entry) => entry.type === "item" && entry.matchKey === beforeMatchKey);
    if (beforeIndex !== -1) insertIndex = beforeIndex;
  } else if (targetHeader) {
    const headerIndex = withoutMoved.findIndex((entry) => (
      entry.type === "header" &&
      entry.text.toLowerCase() === targetHeader.toLowerCase()
    ));
    if (headerIndex !== -1) {
      if (position === "start") {
        insertIndex = headerIndex + 1;
      } else {
        const headerLevel = withoutMoved[headerIndex].level || 2;
        insertIndex = withoutMoved.length;
        for (let index = headerIndex + 1; index < withoutMoved.length; index += 1) {
          const entry = withoutMoved[index];
          if (entry.type === "header" && (entry.level || 2) <= headerLevel) {
            insertIndex = index;
            break;
          }
        }
      }
    }
  }

  withoutMoved.splice(insertIndex, 0, moved);
  return withoutMoved;
}

function moveEntryBetweenCategories(data, fromCategory, toCategory, matchKey, targetHeader, beforeMatchKey, position) {
  const next = { ...data };
  const sourceEntries = [...(next[fromCategory] || [])];
  const moved = sourceEntries.find((entry) => entry.type === "item" && entry.matchKey === matchKey);
  if (!moved) return next;

  next[fromCategory] = sourceEntries.filter((entry) => entry !== moved);
  next[toCategory] = reorderEntriesByMove([...(next[toCategory] || []), moved], matchKey, targetHeader, beforeMatchKey, position);
  return next;
}

export class OverviewController {
  constructor(config) {
    this.elements = config;
    this.dragState = null;
  }

  bind() {
    this.elements.categoryTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        setActiveCategory(tab.dataset.cat);
        this.render();
      });
    });

    this.elements.sortButton.classList.toggle("active", state.sortNewest);
    this.elements.sortButton.addEventListener("click", () => {
      setSortNewest(!state.sortNewest);
      this.elements.sortButton.classList.toggle("active", state.sortNewest);
      this.elements.sortButton.title = state.sortNewest ? "Standaard volgorde" : "Sorteer op nieuwste";
      this.render();
    });

    this.elements.searchInput.value = state.overviewQuery;
    this.elements.searchInput.addEventListener("input", () => {
      setOverviewQuery(this.elements.searchInput.value.trim());
      this.render();
    });

    this.elements.content.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".drag-handle");
      if (handle) this.startDrag(event, handle);
    });
    this.elements.content.addEventListener("pointermove", (event) => {
      if (this.dragState) this.moveDrag(event);
    });
    this.elements.content.addEventListener("pointerup", () => {
      if (this.dragState) this.endDrag();
    });
    this.elements.content.addEventListener("pointercancel", () => this.cancelDrag());
  }

  setMeta(message) {
    const time = new Intl.DateTimeFormat("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()).replace(/\u200e/g, "");
    this.elements.meta.textContent = `${time} · ${message}`;
  }

  async load({ silent = false } = {}) {
    if (Object.keys(state.overviewData).length === 0) {
      this.elements.loading.classList.remove("hidden");
    }
    try {
      const data = await apiFetch("/api/overview");
      setOverviewData(data.categories || {});
      this.elements.loading.classList.add("hidden");
      this.render();
      if (!silent) this.setMeta("Overzicht ververst");
    } catch (error) {
      if (Object.keys(state.overviewData).length === 0) {
        this.elements.loading.textContent = "Laden mislukt";
      }
      throw error;
    }
  }

  render() {
    this.elements.categoryTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.cat === state.activeCategory));
    this.elements.content.querySelectorAll(".overview-card, .empty, .zone-header").forEach((node) => node.remove());

    if (state.activeCategory === "alles") {
      this.renderAllCategories();
      return;
    }

    const entries = this.filteredEntries(state.activeCategory);
    if (!entries.some((entry) => entry.type !== "header")) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      this.elements.content.appendChild(empty);
      return;
    }

    const card = document.createElement("div");
    card.className = "overview-card";
    card.dataset.category = state.activeCategory;
    this.renderItemsIntoCard(card, sortEntries(entries), state.activeCategory);
    this.elements.content.appendChild(card);
  }

  filteredEntries(category) {
    const entries = state.overviewData[category] || [];
    const query = state.overviewQuery;
    if (!query) return entries;
    return entries.filter((entry) => entry.type === "header" || itemMatchesQuery(entry, query));
  }

  renderAllCategories() {
    const zones = [
      { key: "claude", title: "Claude Code kan oppakken", categories: ["code"] },
      { key: "jij", title: "Jij zelf", categories: ["werk", "fysiek", "persoonlijk", "someday"] },
    ];

    let hasItems = false;
    for (const zone of zones) {
      const zoneEntries = zone.categories.map((category) => [category, this.filteredEntries(category)]);
      if (!zoneEntries.some(([, entries]) => entries.some((entry) => entry.type !== "header"))) continue;

      const header = document.createElement("div");
      header.className = `zone-header zone-${zone.key}`;
      header.textContent = zone.title;
      this.elements.content.appendChild(header);

      for (const [category, entries] of zoneEntries) {
        if (!entries.some((entry) => entry.type !== "header")) continue;
        hasItems = true;
        const card = document.createElement("div");
        card.className = `overview-card zone-card zone-card-${zone.key}`;
        card.dataset.category = category;
        const title = document.createElement("div");
        title.className = "overview-card-title";
        title.textContent = categoryLabels[category] || category;
        card.appendChild(title);
        this.renderItemsIntoCard(card, sortEntries(entries), category);
        this.elements.content.appendChild(card);
      }
    }

    if (!hasItems) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      this.elements.content.appendChild(empty);
    }
  }

  renderItemsIntoCard(card, entries, category) {
    let lastHeaderLevel = 1;
    let lastHeaderText = "";
    entries.forEach((entry) => {
      if (entry.type === "header") {
        lastHeaderLevel = entry.level || 2;
        lastHeaderText = entry.text;
        const header = document.createElement("div");
        header.className = `overview-header-item${lastHeaderLevel >= 3 ? " sub-header" : ""}`;
        header.textContent = entry.text;
        header.dataset.category = category;
        header.dataset.section = entry.text;
        card.appendChild(header);
        return;
      }

      const row = document.createElement("div");
      row.className = `overview-item${lastHeaderLevel >= 3 ? " sub-item" : ""}${entry.isClaudeItem ? " claude-item" : ""}`;
      row.dataset.matchKey = entry.matchKey;
      row.dataset.category = category;
      row.dataset.section = lastHeaderText;

      const handle = document.createElement("div");
      handle.className = "drag-handle";
      handle.innerHTML = gripSvg;
      if (state.sortNewest || state.overviewQuery || category === "code") {
        handle.classList.add("hidden");
      }

      const circle = document.createElement("div");
      circle.className = "circle";
      circle.title = "Markeer als klaar";
      circle.addEventListener("click", () => this.markDone(category, entry, row));

      const textWrap = document.createElement("div");
      textWrap.className = "item-text";
      const main = document.createElement("span");
      main.className = "item-main";
      main.innerHTML = renderMarkdown(entry.text, toProxyUrl);
      if (entry.timestamp) {
        main.innerHTML += ` <span class="item-date">&middot; ${escapeHtml(formatTimestamp(entry.timestamp))}</span>`;
      }
      main.querySelectorAll(".inbox-img[data-lightbox]").forEach((image) => {
        image.addEventListener("click", () => this.elements.lightbox.open(image.src));
      });
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

      const actions = document.createElement("div");
      actions.className = "item-actions";
      actions.appendChild(makeIconButton("edit-btn", editSvg, "Bewerken", () => this.openEdit(entry, row)));
      actions.appendChild(makeIconButton("context-btn", contextSvg, "Context toevoegen", () => this.openContext(entry, row)));
      actions.appendChild(this.makeMoveMenu(category, entry, row));
      actions.appendChild(makeIconButton("copy-btn", copySvg, "Kopiëren", () => {
        navigator.clipboard.writeText(entry.text);
        showToast("Gekopieerd");
      }));

      const more = document.createElement("button");
      more.className = "more-btn";
      more.innerHTML = "&#8942;";
      more.title = "Acties";
      more.setAttribute("aria-label", "Acties");
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = actions.classList.contains("open");
        document.querySelectorAll(".item-actions.open").forEach((node) => node.classList.remove("open"));
        actions.classList.toggle("open", !wasOpen);
      });

      row.append(handle, circle, textWrap, more, actions);
      card.appendChild(row);
    });
  }

  async markDone(category, entry, row) {
    row.classList.add("completed");
    try {
      await apiFetch("/api/overview", {
        method: "POST",
        body: JSON.stringify({ category, matchKey: entry.matchKey }),
      });
      state.overviewData[category] = (state.overviewData[category] || []).filter((item) => item.matchKey !== entry.matchKey);
      setOverviewData({ ...state.overviewData });
      row.style.opacity = "0";
      setTimeout(() => this.render(), 220);
    } catch (error) {
      row.classList.remove("completed");
      showToast(error.message || "Afvinken mislukt", "error");
    }
  }

  openContext(entry, row) {
    const existing = row.querySelector(".context-input-wrap");
    if (existing) {
      existing.remove();
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "context-input-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Context toevoegen...";
    const button = document.createElement("button");
    button.className = "context-send-btn";
    button.textContent = "Toevoegen";

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      input.disabled = true;
      button.disabled = true;
      try {
        const data = await apiFetch("/api/overview", {
          method: "PATCH",
          body: JSON.stringify({
            category: row.dataset.category,
            matchKey: entry.matchKey,
            context: value,
          }),
        });
        entry.contexts.push(data.context);
        setOverviewData({ ...state.overviewData });
        this.render();
      } catch (error) {
        showToast(error.message || "Context toevoegen mislukt", "error");
        input.disabled = false;
        button.disabled = false;
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") wrap.remove();
    });
    button.addEventListener("click", submit);

    wrap.append(input, button);
    row.querySelector(".item-text").appendChild(wrap);
    input.focus();
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
        await apiFetch("/api/overview", {
          method: "PATCH",
          body: JSON.stringify({
            category: row.dataset.category,
            matchKey: entry.matchKey,
            newText: value,
          }),
        });
        entry.text = value;
        setOverviewData({ ...state.overviewData });
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

  makeMoveMenu(category, entry, row) {
    const wrap = document.createElement("div");
    wrap.className = "move-wrap";
    const button = makeIconButton("move-btn", moveSvg, "Verplaatsen", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".move-menu").forEach((node) => node.classList.add("hidden"));
      menu.classList.toggle("hidden");
    });
    const menu = document.createElement("div");
    menu.className = "move-menu hidden";

    Object.entries(categoryLabels).forEach(([target, label]) => {
      if (target === category) return;
      const option = document.createElement("button");
      option.className = "move-option";
      option.textContent = label;
      option.addEventListener("click", async () => {
        menu.classList.add("hidden");
        try {
          await apiFetch("/api/overview", {
            method: "PUT",
            body: JSON.stringify({
              fromCategory: category,
              toCategory: target,
              matchKey: entry.matchKey,
            }),
          });
          state.overviewData[category] = (state.overviewData[category] || []).filter((item) => item.matchKey !== entry.matchKey);
          state.overviewData[target] = [...(state.overviewData[target] || []), entry];
          setOverviewData({ ...state.overviewData });
          this.render();
        } catch (error) {
          showToast(error.message || "Verplaatsen mislukt", "error");
        }
      });
      menu.appendChild(option);
    });

    wrap.append(button, menu);
    return wrap;
  }

  startDrag(event, handle) {
    const row = handle.closest(".overview-item");
    const card = row?.closest(".overview-card");
    if (!row || !card || event.button !== 0 || state.sortNewest || state.overviewQuery || row.dataset.category === "code") {
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
      sourceCard: card,
      ghost,
      pointerId: event.pointerId,
      indicator: null,
      drop: null,
      sourceCategory: row.dataset.category,
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
    if (!card || !targetCategory || targetCategory === "code") return;

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
        targetCategory,
        targetHeader: anchor.dataset.section || "",
        beforeMatchKey: null,
        position: "start",
      };
    } else if (placement === "before") {
      anchor.before(indicator);
      drop = {
        targetCategory,
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
        targetCategory,
        targetHeader: anchor.dataset.section || "",
        beforeMatchKey: nextItem?.dataset.matchKey || null,
        position: nextItem ? "before" : "end",
      };
    }

    this.dragState.indicator = indicator;
    this.dragState.drop = drop;
  }

  async endDrag() {
    const { row, ghost, indicator, drop, sourceCategory, matchKey } = this.dragState;
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
      await apiFetch("/api/overview", {
        method: "PATCH",
        body: JSON.stringify({
          action: "organize",
          fromCategory: sourceCategory,
          toCategory: drop.targetCategory,
          matchKey,
          targetHeader: drop.targetHeader,
          beforeMatchKey: drop.beforeMatchKey,
          position: drop.position,
        }),
      });
      if (sourceCategory === drop.targetCategory) {
        state.overviewData[sourceCategory] = reorderEntriesByMove(
          [...(state.overviewData[sourceCategory] || [])],
          matchKey,
          drop.targetHeader,
          drop.beforeMatchKey,
          drop.position
        );
        setOverviewData({ ...state.overviewData });
      } else {
        setOverviewData(moveEntryBetweenCategories(
          state.overviewData,
          sourceCategory,
          drop.targetCategory,
          matchKey,
          drop.targetHeader,
          drop.beforeMatchKey,
          drop.position
        ));
      }
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
