export const storageKeys = {
  activeCategory: "braindump_active_category",
  sortNewest: "braindump_sort_newest",
  overviewQuery: "braindump_overview_query",
  overviewCache: "braindump_overview_cache_v2",
  installDismissed: "braindump_install_dismissed",
  sharedLastVisited: "braindump_shared_last_visited_v2",
  sharedLastSeenTs: "braindump_shared_last_seen_ts_v2",
  personalDraft: "braindump_draft_personal",
  sharedDraft: "braindump_draft_shared",
  gepDraft: "braindump_draft_gep",
};

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota failures.
  }
}

export const state = {
  role: null,
  expiry: null,
  activeTab: "inbox",
  activeCategory: localStorage.getItem(storageKeys.activeCategory) || "alles",
  sortNewest: localStorage.getItem(storageKeys.sortNewest) === "1",
  overviewQuery: localStorage.getItem(storageKeys.overviewQuery) || "",
  overviewData: readJson(storageKeys.overviewCache, {}),
  feedData: {
    personal: [],
    shared: [],
    gep: [],
  },
  drafts: {
    personal: localStorage.getItem(storageKeys.personalDraft) || "",
    shared: localStorage.getItem(storageKeys.sharedDraft) || "",
    gep: localStorage.getItem(storageKeys.gepDraft) || "",
  },
  feedLoaded: {
    personal: false,
    shared: false,
    gep: false,
  },
  pendingFiles: [],
  deferredInstallPrompt: null,
};

export function setRole(role) {
  state.role = role;
}

export function setExpiry(expiry) {
  state.expiry = expiry;
}

export function setActiveCategory(value) {
  state.activeCategory = value;
  localStorage.setItem(storageKeys.activeCategory, value);
}

export function setSortNewest(value) {
  state.sortNewest = value;
  localStorage.setItem(storageKeys.sortNewest, value ? "1" : "0");
}

export function setOverviewQuery(value) {
  state.overviewQuery = value;
  localStorage.setItem(storageKeys.overviewQuery, value);
}

export function setOverviewData(data) {
  state.overviewData = data;
  writeJson(storageKeys.overviewCache, data);
}

export function clearOverviewCache() {
  state.overviewData = {};
  localStorage.removeItem(storageKeys.overviewCache);
}

export function setFeedData(space, items) {
  state.feedData[space] = items;
  state.feedLoaded[space] = true;
}

export function setDraft(space, value) {
  state.drafts[space] = value;
  const key = storageKeys[`${space}Draft`];
  if (key) localStorage.setItem(key, value);
}

export function resetSessionState() {
  state.role = null;
  state.expiry = null;
  state.activeTab = "inbox";
  state.feedData = { personal: [], shared: [], gep: [] };
  state.feedLoaded = { personal: false, shared: false, gep: false };
  state.pendingFiles = [];
  clearOverviewCache();
}
