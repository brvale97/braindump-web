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
  const fileInput = document.getElementById("file-input");

  let overviewData = {};
  let activeCategory = "alles";
  let pendingFile = null;
  let sortNewest = false;

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

  const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function makeCopyBtn(textToCopy) {
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.innerHTML = copySvg;
    btn.title = "Kopiëren";
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(textToCopy);
      btn.innerHTML = "&#10003;";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = copySvg;
        btn.classList.remove("copied");
      }, 1500);
    });
    return btn;
  }

  function appendInboxItem(text) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "inbox-item";

    // Extract timestamp if present
    const tsMatch = text.match(/\*\((.+?)\)\*$/);
    const mainText = tsMatch ? text.replace(/\s*\*\(.+?\)\*$/, "") : text;

    // Check for markdown image link: [filename.ext](url)
    const imgExts = /\.(jpe?g|png|gif|webp|svg)$/i;
    const linkMatch = mainText.match(/^\[(.+?)\]\((.+?)\)$/);

    const content = document.createElement("div");
    content.className = "inbox-item-content";

    if (linkMatch && imgExts.test(linkMatch[1])) {
      const rawUrl = linkMatch[2].replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
      content.innerHTML = `<img class="inbox-img" src="${escapeHtml(rawUrl)}" alt="${escapeHtml(linkMatch[1])}">`;
      if (tsMatch) {
        content.innerHTML += `<span class="timestamp">${escapeHtml(tsMatch[1])}</span>`;
      }
    } else if (tsMatch) {
      content.innerHTML = `${escapeHtml(mainText)} <span class="timestamp">${escapeHtml(tsMatch[1])}</span>`;
    } else {
      content.textContent = text;
    }

    div.appendChild(content);
    div.appendChild(makeCopyBtn(mainText));

    inboxFeed.appendChild(div);
    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  function appendInboxImage(imgSrc, altText, entryText) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "inbox-item";
    const img = document.createElement("img");
    img.className = "inbox-img";
    img.src = imgSrc;
    img.alt = altText;
    div.appendChild(img);

    const tsMatch = entryText && entryText.match(/\*\((.+?)\)\*$/);
    if (tsMatch) {
      const ts = document.createElement("span");
      ts.className = "timestamp";
      ts.textContent = tsMatch[1];
      div.appendChild(ts);
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

        row.appendChild(circle);
        row.appendChild(textWrap);
        row.appendChild(makeCopyBtn(parsed.text));
        card.appendChild(row);
      }
    });
  }

  function sortItemsByDate(items) {
    if (!sortNewest) return items;
    // Separate headers and items, then sort items by date descending
    const onlyItems = items.filter((e) => e.type !== "header");
    onlyItems.sort((a, b) => {
      const dateA = (a.text.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]/) || [])[1] || "";
      const dateB = (b.text.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]/) || [])[1] || "";
      return dateB.localeCompare(dateA);
    });
    return onlyItems;
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
    renderItemsIntoCard(card, sortItemsByDate(items));
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

      renderItemsIntoCard(card, sortItemsByDate(items));
      overviewContent.appendChild(card);
    });

    if (!hasItems) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Geen items";
      overviewContent.appendChild(empty);
    }
  }

  // --- Upload ---

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const attachBtn = document.getElementById("attach-btn");
  const uploadPreview = document.getElementById("upload-preview");

  function showUploadPreview(file) {
    pendingFile = file;
    uploadPreview.innerHTML = "";
    uploadPreview.classList.remove("hidden");

    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      uploadPreview.appendChild(img);
    } else {
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      uploadPreview.appendChild(name);
    }

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "\u00D7";
    remove.title = "Verwijderen";
    remove.addEventListener("click", clearUploadPreview);
    uploadPreview.appendChild(remove);
  }

  function clearUploadPreview() {
    pendingFile = null;
    uploadPreview.classList.add("hidden");
    uploadPreview.innerHTML = "";
    fileInput.value = "";
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadFile(file) {
    const base64 = await readFileAsBase64(file);
    const data = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        content: base64,
      }),
    });
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function handleSend() {
    const text = inboxInput.value.trim();
    const file = pendingFile;

    if (!text && !file) return;

    inboxSend.disabled = true;
    inboxInput.disabled = true;
    attachBtn.disabled = true;

    try {
      if (file) {
        const localUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
        const result = await uploadFile(file);
        if (localUrl) {
          appendInboxImage(localUrl, file.name, result.entry);
        } else {
          appendInboxItem(result.entry.replace(/^- /, ""));
        }
        clearUploadPreview();
      }
      if (text) {
        const data = await api("/api/inbox", {
          method: "POST",
          body: JSON.stringify({ item: text }),
        });
        if (data.error) {
          alert("Fout: " + data.error);
          return;
        }
        appendInboxItem(data.item.replace(/^- /, ""));
        inboxInput.value = "";
      }
    } catch (e) {
      alert("Fout: " + e.message);
    } finally {
      inboxSend.disabled = false;
      inboxInput.disabled = false;
      attachBtn.disabled = false;
      inboxInput.focus();
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

  attachBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert("Bestand is te groot (max 10MB)");
      fileInput.value = "";
      return;
    }
    showUploadPreview(file);
  });

  inboxSend.addEventListener("click", handleSend);

  inboxInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });

  categoryTabs.forEach((tab) => {
    tab.addEventListener("click", () => renderCategory(tab.dataset.cat));
  });

  const sortBtn = document.getElementById("sort-btn");
  sortBtn.addEventListener("click", () => {
    sortNewest = !sortNewest;
    sortBtn.classList.toggle("active", sortNewest);
    sortBtn.title = sortNewest ? "Standaard volgorde" : "Sorteer op nieuwste";
    renderCategory(activeCategory);
  });

  refreshBtn.addEventListener("click", loadOverview);

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- PWA Install ---

  let deferredPrompt = null;
  const installBanner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-btn");
  const installDismiss = document.getElementById("install-dismiss");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Don't show if user dismissed before
    if (!sessionStorage.getItem("install_dismissed")) {
      installBanner.classList.remove("hidden");
    }
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBanner.classList.add("hidden");
  });

  installDismiss.addEventListener("click", () => {
    installBanner.classList.add("hidden");
    sessionStorage.setItem("install_dismissed", "1");
  });

  window.addEventListener("appinstalled", () => {
    installBanner.classList.add("hidden");
    deferredPrompt = null;
  });

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }

  // --- Init ---

  if (getToken()) {
    showApp();
  } else {
    showLogin();
  }
})();
