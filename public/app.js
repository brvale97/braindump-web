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
    overviewData = {};
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

  function parseItemText(text) {
    const match = text.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*/);
    if (match) return { text: text.slice(match[0].length), date: match[1] };
    return { text, date: null };
  }

  function formatDate(dateStr) {
    const parts = dateStr.split(/\s+/);
    const [y, m, d] = parts[0].split("-");
    const months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    let result = `${parseInt(d)} ${months[parseInt(m) - 1]}`;
    if (parts[1]) result += `, ${parts[1]}`;
    return result;
  }

  function renderMarkdown(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  async function loadOverview() {
    overviewLoading.classList.remove("hidden");
    overviewContent.querySelectorAll(".overview-card").forEach((el) => el.remove());
    try {
      const data = await api("/api/overview");
      overviewData = data.categories || {};
      overviewLoading.classList.add("hidden");
      renderCategory(activeCategory);
    } catch {
      overviewLoading.textContent = "Laden mislukt";
    }
  }

  function renderItemsIntoCard(card, items) {
    const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    let lastHeaderLevel = 1;
    items.forEach((entry) => {
      if (entry.type === "header") {
        lastHeaderLevel = entry.level || 2;
        const header = document.createElement("div");
        header.className = "overview-header-item" + (lastHeaderLevel >= 3 ? " sub-header" : "");
        header.textContent = entry.text;
        card.appendChild(header);
      } else {
        const parsed = parseItemText(entry.text);
        const row = document.createElement("div");
        row.className = "overview-item" + (lastHeaderLevel >= 3 ? " sub-item" : "");

        const circle = document.createElement("div");
        circle.className = "circle";

        const textWrap = document.createElement("div");
        textWrap.className = "item-text";
        const mainEl = document.createElement("span");
        mainEl.className = "item-main";
        mainEl.innerHTML = renderMarkdown(parsed.text);
        textWrap.appendChild(mainEl);
        if (parsed.date) {
          const dateEl = document.createElement("span");
          dateEl.className = "item-date";
          dateEl.textContent = formatDate(parsed.date);
          textWrap.appendChild(dateEl);
        }

        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-btn";
        copyBtn.innerHTML = copySvg;
        copyBtn.title = "Kopiëren";
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(parsed.text);
          copyBtn.innerHTML = "&#10003;";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.innerHTML = copySvg;
            copyBtn.classList.remove("copied");
          }, 1500);
        });

        row.appendChild(circle);
        row.appendChild(textWrap);
        row.appendChild(copyBtn);
        card.appendChild(row);
      }
    });
  }

  function renderCategory(cat) {
    activeCategory = cat;
    // Update active tab
    categoryTabs.forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));

    // Clear and render
    overviewContent.querySelectorAll(".overview-card, .empty").forEach((el) => el.remove());

    if (cat === "alles") {
      renderAllCategories();
      return;
    }

    const items = overviewData[cat] || [];
    const hasRealItems = items.some((e) => e.type !== "header");

    if (items.length === 0 || !hasRealItems) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      overviewContent.appendChild(empty);
      return;
    }

    const card = document.createElement("div");
    card.className = "overview-card";
    renderItemsIntoCard(card, items);
    overviewContent.appendChild(card);
  }

  function renderAllCategories() {
    const order = ["werk", "fysiek", "code", "persoonlijk", "someday"];
    let hasItems = false;

    order.forEach((cat) => {
      const items = overviewData[cat] || [];
      const hasRealItems = items.some((e) => e.type !== "header");
      if (items.length === 0 || !hasRealItems) return;
      hasItems = true;

      const card = document.createElement("div");
      card.className = "overview-card";

      const title = document.createElement("div");
      title.className = "overview-card-title";
      title.textContent = categoryLabels[cat] || cat;
      card.appendChild(title);

      renderItemsIntoCard(card, items);
      overviewContent.appendChild(card);
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
