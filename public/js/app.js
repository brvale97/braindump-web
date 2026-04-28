import { apiFetch, getSession, login, logout, setUnauthorizedHandler } from "./api.js";
import {
  resetSessionState,
  setDraft,
  setExpiry,
  setFeedData,
  setRole,
  state,
  storageKeys,
} from "./state.js";
import { autoResize, initLightbox, showToast } from "./ui.js";
import { FeedSpaceController } from "./feedSpace.js";
import { OverviewController } from "./overview.js";
import { UploadsController } from "./uploads.js";
import { SettingsController } from "./settings.js";
import { initPwa } from "./pwa.js";

const ACTIVE_POLL_MS = 60000;
const BACKGROUND_POLL_MS = 180000;

const elements = {
  loginScreen: document.getElementById("login-screen"),
  appScreen: document.getElementById("app-screen"),
  pinInput: document.getElementById("pin-input"),
  pinSubmit: document.getElementById("pin-submit"),
  pinError: document.getElementById("pin-error"),
  tabs: [...document.querySelectorAll(".tab")],
  tabContents: [...document.querySelectorAll(".tab-content")],
  logoutButton: document.getElementById("logout-btn"),
  personal: {
    feed: document.getElementById("inbox-feed"),
    loading: document.getElementById("inbox-loading"),
    input: document.getElementById("inbox-input"),
    meta: document.getElementById("inbox-meta"),
    sendButton: document.getElementById("inbox-send"),
    refreshButton: document.getElementById("inbox-refresh-btn"),
    attachButton: document.getElementById("attach-btn"),
    preview: document.getElementById("upload-preview"),
    dropZone: document.getElementById("tab-inbox"),
    fileInput: document.getElementById("file-input"),
  },
  shared: {
    feed: document.getElementById("shared-feed"),
    loading: document.getElementById("shared-loading"),
    input: document.getElementById("shared-input"),
    meta: document.getElementById("shared-meta"),
    sendButton: document.getElementById("shared-send"),
    refreshButton: document.getElementById("shared-refresh-btn"),
    tab: document.querySelector('.tab[data-tab="shared"]'),
  },
  gep: {
    feed: document.getElementById("gep-feed"),
    loading: document.getElementById("gep-loading"),
    input: document.getElementById("gep-input"),
    meta: document.getElementById("gep-meta"),
    sendButton: document.getElementById("gep-send"),
    refreshButton: document.getElementById("gep-refresh-btn"),
  },
  overview: {
    meta: document.getElementById("overview-meta"),
    content: document.getElementById("overview-content"),
    loading: document.getElementById("overview-loading"),
    refreshButton: document.getElementById("refresh-btn"),
    sortButton: document.getElementById("sort-btn"),
    searchInput: document.getElementById("overview-search"),
    categoryTabs: [...document.querySelectorAll(".cat-tab")],
  },
  settings: {
    settingsButton: document.getElementById("settings-btn"),
    modal: document.getElementById("settings-modal"),
    closeButton: document.getElementById("settings-close"),
    input: document.getElementById("groq-key-input"),
    saveButton: document.getElementById("groq-key-save"),
    status: document.getElementById("groq-key-status"),
    micButton: document.getElementById("mic-btn"),
  },
  pwa: {
    banner: document.getElementById("install-banner"),
    installButton: document.getElementById("install-btn"),
    dismissButton: document.getElementById("install-dismiss"),
  },
  lightbox: initLightbox({
    lightbox: document.getElementById("lightbox"),
    image: document.getElementById("lightbox-img"),
  }),
};

const personalController = new FeedSpaceController({
  endpoint: "/api/inbox",
  feed: elements.personal.feed,
  loading: elements.personal.loading,
  input: elements.personal.input,
  meta: elements.personal.meta,
  refreshButton: elements.personal.refreshButton,
  editable: true,
  externalComposer: true,
  lightbox: elements.lightbox,
  initialDraft: state.drafts.personal,
  onDraftChange: (value) => setDraft("personal", value),
  onLoaded: (items) => setFeedData("personal", items),
  messages: {
    empty: "Inbox is leeg",
    refreshed: "Inbox ververst",
    sent: "Snel gedumpt naar inbox",
    edited: "Item bijgewerkt",
    contextAdded: "Context toegevoegd",
  },
});

const sharedController = new FeedSpaceController({
  endpoint: "/api/shared",
  feed: elements.shared.feed,
  loading: elements.shared.loading,
  input: elements.shared.input,
  meta: elements.shared.meta,
  refreshButton: elements.shared.refreshButton,
  sendButton: elements.shared.sendButton,
  editable: false,
  lightbox: elements.lightbox,
  initialDraft: state.drafts.shared,
  onDraftChange: (value) => setDraft("shared", value),
  onLoaded: (items) => {
    setFeedData("shared", items);
    updateSharedNotification(items);
  },
  messages: {
    empty: "Gedeelde lijst is leeg",
    refreshed: "Gedeelde lijst ververst",
    sent: "Snel gedumpt naar gedeelde lijst",
    contextAdded: "Context toegevoegd",
  },
});

const gepController = new FeedSpaceController({
  endpoint: "/api/gep",
  feed: elements.gep.feed,
  loading: elements.gep.loading,
  input: elements.gep.input,
  meta: elements.gep.meta,
  refreshButton: elements.gep.refreshButton,
  sendButton: elements.gep.sendButton,
  editable: false,
  lightbox: elements.lightbox,
  initialDraft: state.drafts.gep,
  onDraftChange: (value) => setDraft("gep", value),
  onLoaded: (items) => setFeedData("gep", items),
  messages: {
    empty: "GeP inbox is leeg",
    refreshed: "GeP ververst",
    sent: "Snel gedumpt naar GeP",
    contextAdded: "Context toegevoegd",
  },
});

const overviewController = new OverviewController({
  ...elements.overview,
  lightbox: elements.lightbox,
});

const settingsController = new SettingsController({
  ...elements.settings,
  inboxInput: elements.personal.input,
});

const uploadsController = new UploadsController({
  personalController,
  fileInput: elements.personal.fileInput,
  attachButton: elements.personal.attachButton,
  preview: elements.personal.preview,
  dropZone: elements.personal.dropZone,
  textarea: elements.personal.input,
});

let activePollTimer = null;
let backgroundPollTimer = null;

function latestSharedTimestamp(items) {
  return items.reduce((latest, item) => (
    item.timestamp && item.timestamp > latest ? item.timestamp : latest
  ), "");
}

function updateSharedNotification(items = state.feedData.shared) {
  if (state.role !== "bram") {
    elements.shared.tab.classList.remove("has-notification");
    return;
  }

  const latest = latestSharedTimestamp(items);
  const seen = localStorage.getItem(storageKeys.sharedLastSeenTs) || "";
  const isViewingShared = state.activeTab === "shared";
  if (isViewingShared && latest) {
    localStorage.setItem(storageKeys.sharedLastSeenTs, latest);
    elements.shared.tab.classList.remove("has-notification");
    return;
  }

  elements.shared.tab.classList.toggle("has-notification", !!latest && latest > seen);
}

function setActiveTab(tab) {
  state.activeTab = tab;
  elements.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  elements.tabContents.forEach((node) => node.classList.add("hidden"));
  document.getElementById(`tab-${tab}`).classList.remove("hidden");
  if (tab === "shared") updateSharedNotification();
}

function showLogin() {
  elements.loginScreen.classList.remove("hidden");
  elements.appScreen.classList.add("hidden");
  elements.pinInput.value = "";
  elements.pinError.classList.add("hidden");
  elements.pinInput.focus();
  stopPolling();
}

async function showApp(role) {
  setRole(role);
  elements.loginScreen.classList.add("hidden");
  elements.appScreen.classList.remove("hidden");

  const inboxTab = document.querySelector('.tab[data-tab="inbox"]');
  const overviewTab = document.querySelector('.tab[data-tab="overview"]');
  const gepTab = document.querySelector('.tab[data-tab="gep"]');
  const sharedTab = document.querySelector('.tab[data-tab="shared"]');

  if (role === "anna") {
    inboxTab.classList.add("hidden");
    overviewTab.classList.add("hidden");
    gepTab.classList.add("hidden");
    sharedTab.classList.remove("hidden");
    setActiveTab("shared");
    await sharedController.load({ silent: true });
  } else {
    inboxTab.classList.remove("hidden");
    overviewTab.classList.remove("hidden");
    gepTab.classList.remove("hidden");
    sharedTab.classList.remove("hidden");
    setActiveTab("inbox");
    if (Object.keys(state.overviewData).length > 0) overviewController.render();
    await Promise.allSettled([
      personalController.load({ silent: true }),
      overviewController.load({ silent: true }),
    ]);
  }

  startPolling();
}

function startPolling() {
  stopPolling();
  activePollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshActiveTab(true);
  }, ACTIVE_POLL_MS);
  backgroundPollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshBackgroundTabs(true);
  }, BACKGROUND_POLL_MS);
}

function stopPolling() {
  if (activePollTimer) clearInterval(activePollTimer);
  if (backgroundPollTimer) clearInterval(backgroundPollTimer);
  activePollTimer = null;
  backgroundPollTimer = null;
}

async function refreshActiveTab(silent = false) {
  if (state.activeTab === "inbox" && state.role !== "anna") await personalController.load({ noCache: true, silent });
  if (state.activeTab === "overview" && state.role !== "anna") await overviewController.load({ silent });
  if (state.activeTab === "shared") await sharedController.load({ silent });
  if (state.activeTab === "gep" && state.role !== "anna") await gepController.load({ silent });
}

async function refreshBackgroundTabs(silent = false) {
  const tasks = [];
  if (state.role !== "anna" && state.activeTab !== "inbox" && state.feedLoaded.personal) tasks.push(personalController.load({ noCache: true, silent }));
  if (state.role !== "anna" && state.activeTab !== "overview" && Object.keys(state.overviewData).length > 0) tasks.push(overviewController.load({ silent }));
  if (state.activeTab !== "shared" && state.feedLoaded.shared) tasks.push(sharedController.load({ silent }));
  if (state.role !== "anna" && state.activeTab !== "gep" && state.feedLoaded.gep) tasks.push(gepController.load({ silent }));
  await Promise.allSettled(tasks);
}

async function submitPersonal() {
  const text = elements.personal.input.value.trim();
  const hasFiles = state.pendingFiles.length > 0;
  if (!text && !hasFiles) return;

  elements.personal.sendButton.disabled = true;
  elements.personal.input.disabled = true;
  elements.personal.attachButton.disabled = true;
  elements.settings.micButton.disabled = true;

  try {
    if (hasFiles) {
      await uploadsController.uploadPendingFiles(text);
      elements.personal.input.value = "";
      setDraft("personal", "");
      personalController.setMeta("Snel gedumpt naar inbox");
    } else {
      await personalController.submitCurrentInput();
    }
  } catch (error) {
    showToast(error.message || "Opslaan mislukt", "error");
  } finally {
    elements.personal.sendButton.disabled = false;
    elements.personal.input.disabled = false;
    elements.personal.attachButton.disabled = false;
    elements.settings.micButton.disabled = false;
    elements.personal.input.focus();
  }
}

async function handleLogout() {
  try {
    await logout();
  } catch {
    // Keep local cleanup even if request fails.
  }
  resetSessionState();
  uploadsController.clear();
  showLogin();
}

function bindTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const target = tab.dataset.tab;
      setActiveTab(target);
      if (target === "overview" && state.role !== "anna") {
        if (Object.keys(state.overviewData).length === 0) await overviewController.load();
        else overviewController.render();
      }
      if (target === "inbox" && state.role !== "anna" && !state.feedLoaded.personal) await personalController.load();
      if (target === "shared" && !state.feedLoaded.shared) await sharedController.load();
      if (target === "gep" && state.role !== "anna" && !state.feedLoaded.gep) await gepController.load();
      if (target === "shared") updateSharedNotification();
    });
  });
}

function bindLogin() {
  elements.pinSubmit.addEventListener("click", async () => {
    elements.pinError.classList.add("hidden");
    elements.pinSubmit.disabled = true;
    try {
      const data = await login(elements.pinInput.value);
      setExpiry(data.expiry);
      await showApp(data.role);
    } catch (error) {
      elements.pinError.textContent = error.message || "Inloggen mislukt";
      elements.pinError.classList.remove("hidden");
    } finally {
      elements.pinSubmit.disabled = false;
    }
  });
  elements.pinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") elements.pinSubmit.click();
  });
}

function bindPersonalComposer() {
  elements.personal.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPersonal();
    }
  });
  elements.personal.input.addEventListener("input", () => autoResize(elements.personal.input));
  elements.personal.sendButton.addEventListener("click", () => submitPersonal());
}

function bindCommon() {
  personalController.bind();
  sharedController.bind();
  gepController.bind();
  overviewController.bind();
  settingsController.bind();
  uploadsController.bind();
  bindTabs();
  bindLogin();
  bindPersonalComposer();
  elements.logoutButton.addEventListener("click", () => handleLogout());
  elements.overview.refreshButton.addEventListener("click", async () => {
    if (state.role === "anna") return;
    await Promise.allSettled([
      personalController.load({ noCache: true }),
      overviewController.load(),
      gepController.load({ silent: true }),
      sharedController.load({ silent: true }),
    ]);
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".move-menu").forEach((node) => node.classList.add("hidden"));
    document.querySelectorAll(".item-actions.open").forEach((node) => node.classList.remove("open"));
  });
}

async function bootstrap() {
  setUnauthorizedHandler(() => handleLogout());
  initPwa(elements.pwa);
  bindCommon();
  if (state.drafts.personal) autoResize(elements.personal.input);
  if (state.drafts.shared) autoResize(elements.shared.input);
  if (state.drafts.gep) autoResize(elements.gep.input);

  try {
    const session = await getSession();
    if (session.authenticated) {
      setExpiry(session.expiry);
      await showApp(session.role);
      return;
    }
  } catch {
    // Fall through to login state.
  }

  showLogin();
}

bootstrap();
