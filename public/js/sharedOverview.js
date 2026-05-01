import {
  setActiveSharedCategory,
  setSharedOverviewQuery,
  setSharedOverviewSortNewest,
  state,
} from "./state.js";
import { escapeHtml, formatTimestamp, renderMarkdown, toProxyUrl } from "./ui.js";

const ALL_CATEGORY = "alles";
const FALLBACK_CATEGORY = "werk";

const categoryLabels = {
  werk: "GEP",
  fysiek: "Fysiek",
  code: "Code",
  persoonlijk: "Persoonlijk",
  someday: "Someday",
};

const categoryAliases = new Map([
  ["gep", "werk"],
  ["werk", "werk"],
  ["lijst", "werk"],
  ["algemeen", "werk"],
  ["fysiek", "fysiek"],
  ["fysieke-taken", "fysiek"],
  ["code", "code"],
  ["persoonlijk", "persoonlijk"],
  ["someday", "someday"],
  ["someday-misschien-later", "someday"],
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
  let currentKey = FALLBACK_CATEGORY;

  for (const entry of entries || []) {
    if (entry.type === "header") {
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
    this.elements.content.querySelectorAll(".overview-card, .empty").forEach((node) => node.remove());
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
    this.renderItemsIntoCard(card, sortEntries(entries));
    this.elements.content.appendChild(card);
  }

  renderAllCategories() {
    this.renderFocusSummary();
    const zones = [
      { key: "claude", title: "Codex kan dit oppakken", categories: ["code"] },
      { key: "jij", title: "Jij zelf", categories: ["werk", "fysiek", "persoonlijk", "someday"] },
    ];

    let hasItems = false;
    for (const zone of zones) {
      const zoneCategories = zone.categories
        .map((key) => this.categories.find((category) => category.key === key))
        .filter(Boolean);
      if (!zoneCategories.some((category) => this.filteredEntries(category.entries).some((entry) => entry.type !== "header"))) {
        continue;
      }

      const header = document.createElement("div");
      header.className = `zone-header zone-${zone.key}`;
      header.textContent = zone.title;
      this.elements.content.appendChild(header);

      for (const category of zoneCategories) {
        const entries = this.filteredEntries(category.entries);
        if (!entries.some((entry) => entry.type !== "header")) continue;

        hasItems = true;
        const card = document.createElement("div");
        card.className = `overview-card shared-overview-card zone-card zone-card-${zone.key}`;
        const title = document.createElement("div");
        title.className = "overview-card-title";
        title.textContent = category.label;
        card.appendChild(title);
        this.renderItemsIntoCard(card, sortEntries(entries));
        this.elements.content.appendChild(card);
      }
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

  renderItemsIntoCard(card, entries) {
    let lastHeaderLevel = 1;

    for (const entry of entries) {
      if (entry.type === "header") {
        lastHeaderLevel = entry.level || 2;
        const header = document.createElement("div");
        header.className = `overview-header-item${lastHeaderLevel >= 3 ? " sub-header" : ""}`;
        header.textContent = entry.text;
        card.appendChild(header);
        continue;
      }

      const row = document.createElement("div");
      row.className = `overview-item shared-overview-item${lastHeaderLevel >= 3 ? " sub-item" : ""}`;

      const circle = document.createElement("div");
      circle.className = "circle shared-readonly-circle";
      circle.setAttribute("aria-hidden", "true");

      const textWrap = document.createElement("div");
      textWrap.className = "item-text";
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

      row.append(circle, textWrap);
      card.appendChild(row);
    }
  }
}
