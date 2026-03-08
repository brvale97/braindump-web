(function () {
  const TOKEN_KEY = "braindump_token";
  const EXPIRY_KEY = "braindump_expiry";

  // Elements
  const loginScreen = document.getElementById("login-screen");
  const appScreen = document.getElementById("app-screen");
  const pinInput = document.getElementById("pin-input");
  const pinSubmit = document.getElementById("pin-submit");
  const pinError = document.getElementById("pin-error");
  const tabs = document.querySelectorAll(".tab");
  const inboxFeed = document.getElementById("inbox-feed");
  const inboxLoading = document.getElementById("inbox-loading");
  const inboxInput = document.getElementById("inbox-input");
  const inboxSend = document.getElementById("inbox-send");
  const categoryTabs = document.querySelectorAll(".cat-tab");
  const overviewContent = document.getElementById("overview-content");
  const overviewLoading = document.getElementById("overview-loading");
  const refreshBtn = document.getElementById("refresh-btn");

  let overviewData = {};
  let activeCategory = "alles";

  const categoryLabels = {
    werk: "GEP",
    fysiek: "Fysiek",
    code: "Code",
    persoonlijk: "Persoonlijk",
    someday: "Someday",
  };

  // --- Auth ---

  function getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (!token || !expiry || Date.now() > parseInt(expiry, 10)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      return null;
    }
    return token;
  }

  function setToken(token, expiry) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRY_KEY, String(expiry));
  }

  async function api(path, options = {}) {
    const token = getToken();
    if (!token && path !== "/api/auth") {
      showLogin();
      throw new Error("Niet ingelogd");
    }
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      showLogin();
      throw new Error("Sessie verlopen");
    }
    return res.json();
  }

  async function login(pin) {
    pinError.classList.add("hidden");
    pinSubmit.disabled = true;
    try {
      const data = await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      if (data.error) {
        pinError.textContent = data.error;
        pinError.classList.remove("hidden");
        return;
      }
      setToken(data.token, data.expiry);
      showApp();
    } catch (e) {
      pinError.textContent = "Verbinding mislukt";
      pinError.classList.remove("hidden");
    } finally {
      pinSubmit.disabled = false;
    }
  }

  // --- Screens ---

  function showLogin() {
    loginScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    pinInput.value = "";
    pinInput.focus();
  }

  function showApp() {
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    loadInbox();
  }

  // --- Inbox ---

  async function loadInbox() {
    inboxLoading.classList.remove("hidden");
    try {
      const data = await api("/api/inbox");
      inboxLoading.classList.add("hidden");
      renderInbox(data.items || []);
    } catch {
      inboxLoading.textContent = "Laden mislukt";
    }
  }

  function renderInbox(items) {
    // Clear existing items (keep loading div)
    inboxFeed.querySelectorAll(".inbox-item").forEach((el) => el.remove());
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Inbox is leeg";
      inboxFeed.appendChild(empty);
      return;
    }

    items.forEach((text) => {
      appendInboxItem(text);
    });

    // Scroll to bottom
    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  function appendInboxItem(text) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "inbox-item";

    // Extract timestamp if present
    const tsMatch = text.match(/\*\((.+?)\)\*$/);
    if (tsMatch) {
      const mainText = text.replace(/\s*\*\(.+?\)\*$/, "");
      div.innerHTML = `${escapeHtml(mainText)} <span class="timestamp">${escapeHtml(tsMatch[1])}</span>`;
    } else {
      div.textContent = text;
    }

    inboxFeed.appendChild(div);
    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  async function addInboxItem(text) {
    inboxSend.disabled = true;
    inboxInput.disabled = true;
    try {
      const data = await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ item: text }),
      });
      if (data.error) {
        alert("Fout: " + data.error);
        return;
      }
      // Add the new item to the feed
      appendInboxItem(data.item.replace(/^- /, ""));
      inboxInput.value = "";
    } catch (e) {
      alert("Kon item niet toevoegen");
    } finally {
      inboxSend.disabled = false;
      inboxInput.disabled = false;
      inboxInput.focus();
    }
  }

  // --- Overview ---

  async function loadOverview() {
    overviewLoading.classList.remove("hidden");
    overviewContent.querySelectorAll(".overview-list").forEach((el) => el.remove());
    try {
      const data = await api("/api/overview");
      overviewData = data.categories || {};
      overviewLoading.classList.add("hidden");
      renderCategory(activeCategory);
    } catch {
      overviewLoading.textContent = "Laden mislukt";
    }
  }

  function renderCategory(cat) {
    activeCategory = cat;
    // Update active tab
    categoryTabs.forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));

    // Clear and render
    overviewContent.querySelectorAll(".overview-list, .empty").forEach((el) => el.remove());

    if (cat === "alles") {
      renderAllCategories();
      return;
    }

    const items = overviewData[cat] || [];

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      overviewContent.appendChild(empty);
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "overview-list";

    items.forEach((entry) => {
      const li = document.createElement("li");
      if (entry.type === "header") {
        li.className = "header";
        li.textContent = entry.text;
      } else {
        li.className = "item";
        li.textContent = entry.text;
      }
      ul.appendChild(li);
    });

    overviewContent.appendChild(ul);
  }

  function renderAllCategories() {
    const order = ["werk", "fysiek", "code", "persoonlijk", "someday"];
    let hasItems = false;

    order.forEach((cat) => {
      const items = overviewData[cat] || [];
      if (items.length === 0) return;
      hasItems = true;

      const section = document.createElement("div");
      section.className = "all-section";

      const title = document.createElement("h2");
      title.className = "section-title";
      title.textContent = categoryLabels[cat] || cat;
      section.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "overview-list";

      items.forEach((entry) => {
        const li = document.createElement("li");
        if (entry.type === "header") {
          li.className = "header";
          li.textContent = entry.text;
        } else {
          li.className = "item";
          li.textContent = entry.text;
        }
        ul.appendChild(li);
      });

      section.appendChild(ul);
      overviewContent.appendChild(section);
    });

    if (!hasItems) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      overviewContent.appendChild(empty);
    }
  }

  // --- Event Listeners ---

  pinSubmit.addEventListener("click", () => login(pinInput.value));
  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login(pinInput.value);
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
      const target = document.getElementById("tab-" + tab.dataset.tab);
      target.classList.remove("hidden");

      if (tab.dataset.tab === "overview" && Object.keys(overviewData).length === 0) {
        loadOverview();
      }
    });
  });

  inboxSend.addEventListener("click", () => {
    const text = inboxInput.value.trim();
    if (text) addInboxItem(text);
  });

  inboxInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = inboxInput.value.trim();
      if (text) addInboxItem(text);
    }
  });

  categoryTabs.forEach((tab) => {
    tab.addEventListener("click", () => renderCategory(tab.dataset.cat));
  });

  refreshBtn.addEventListener("click", loadOverview);

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Init ---

  if (getToken()) {
    showApp();
  } else {
    showLogin();
  }
})();
