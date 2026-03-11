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
  const inboxRefreshBtn = document.getElementById("inbox-refresh-btn");
  const fileInput = document.getElementById("file-input");

  let overviewData = {};
  let activeCategory = "alles";
  let pendingFiles = [];
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

    items.forEach((item) => {
      // Support both old string format and new {text, contexts} format
      if (typeof item === "string") {
        appendInboxItem({ text: item, contexts: [] });
      } else {
        appendInboxItem(item);
      }
    });

    // Scroll to bottom
    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  const deleteSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  const contextSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function makeDeleteBtn(fullText, itemEl) {
    const btn = document.createElement("button");
    btn.className = "delete-btn";
    btn.innerHTML = deleteSvg;
    btn.title = "Verwijderen";
    btn.addEventListener("click", async () => {
      if (!confirm("Dit item verwijderen?")) return;
      btn.disabled = true;
      try {
        const data = await api("/api/inbox", {
          method: "DELETE",
          body: JSON.stringify({ item: fullText }),
        });
        if (data.error) {
          alert("Fout: " + data.error);
          return;
        }
        itemEl.style.animation = "none";
        itemEl.style.transition = "opacity 0.2s, transform 0.2s";
        itemEl.style.opacity = "0";
        itemEl.style.transform = "translateX(20px)";
        setTimeout(() => {
          itemEl.remove();
          if (!inboxFeed.querySelector(".inbox-item")) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "Inbox is leeg";
            inboxFeed.appendChild(empty);
          }
        }, 200);
      } catch (e) {
        alert("Kon item niet verwijderen");
        btn.disabled = false;
      }
    });
    return btn;
  }

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

  function makeContextBtn(fullText, itemEl) {
    const btn = document.createElement("button");
    btn.className = "context-btn";
    btn.innerHTML = contextSvg;
    btn.title = "Context toevoegen";
    btn.addEventListener("click", () => {
      // Toggle inline input
      let wrap = itemEl.querySelector(".context-input-wrap");
      if (wrap) {
        wrap.remove();
        return;
      }
      wrap = document.createElement("div");
      wrap.className = "context-input-wrap";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Context toevoegen...";
      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Toevoegen";
      sendBtn.className = "context-send-btn";

      async function submitContext() {
        const val = input.value.trim();
        if (!val) return;
        input.disabled = true;
        sendBtn.disabled = true;
        try {
          const data = await api("/api/inbox", {
            method: "PATCH",
            body: JSON.stringify({ parentItem: fullText, context: val }),
          });
          if (data.error) {
            alert("Fout: " + data.error);
            return;
          }
          // Add context to DOM
          const contextContainer = itemEl.querySelector(".inbox-contexts");
          const ctxDiv = document.createElement("div");
          ctxDiv.className = "inbox-context";
          const ctxTsMatch = data.context.match(/\*\((.+?)\)\*$/);
          const ctxText = ctxTsMatch ? data.context.replace(/\s*\*\(.+?\)\*$/, "") : data.context;
          ctxDiv.innerHTML = escapeHtml(ctxText);
          if (ctxTsMatch) {
            ctxDiv.innerHTML += ` <span class="timestamp">${escapeHtml(ctxTsMatch[1])}</span>`;
          }
          contextContainer.appendChild(ctxDiv);
          wrap.remove();
        } catch (e) {
          alert("Kon context niet toevoegen");
          input.disabled = false;
          sendBtn.disabled = false;
        }
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitContext();
        if (e.key === "Escape") wrap.remove();
      });
      sendBtn.addEventListener("click", submitContext);

      wrap.appendChild(input);
      wrap.appendChild(sendBtn);
      itemEl.querySelector(".inbox-item-content").appendChild(wrap);
      input.focus();
    });
    return btn;
  }

  function appendInboxItem(itemObj) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const text = typeof itemObj === "string" ? itemObj : itemObj.text;
    const contexts = (typeof itemObj === "object" && itemObj.contexts) || [];

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

    // Context sub-items container
    const contextContainer = document.createElement("div");
    contextContainer.className = "inbox-contexts";
    contexts.forEach((ctx) => {
      const ctxDiv = document.createElement("div");
      ctxDiv.className = "inbox-context";
      const ctxTsMatch = ctx.match(/\*\((.+?)\)\*$/);
      const ctxText = ctxTsMatch ? ctx.replace(/\s*\*\(.+?\)\*$/, "") : ctx;
      ctxDiv.innerHTML = escapeHtml(ctxText);
      if (ctxTsMatch) {
        ctxDiv.innerHTML += ` <span class="timestamp">${escapeHtml(ctxTsMatch[1])}</span>`;
      }
      contextContainer.appendChild(ctxDiv);
    });
    content.appendChild(contextContainer);

    const actions = document.createElement("div");
    actions.className = "inbox-item-actions";
    actions.appendChild(makeContextBtn(text, div));
    actions.appendChild(makeCopyBtn(mainText));
    actions.appendChild(makeDeleteBtn(text, div));

    div.appendChild(content);
    div.appendChild(actions);

    inboxFeed.appendChild(div);
    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  function appendInboxImage(imgSrc, altText, entryText) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "inbox-item";

    const content = document.createElement("div");
    content.className = "inbox-item-content";
    const img = document.createElement("img");
    img.className = "inbox-img";
    img.src = imgSrc;
    img.alt = altText;
    content.appendChild(img);

    const tsMatch = entryText && entryText.match(/\*\((.+?)\)\*$/);
    if (tsMatch) {
      const ts = document.createElement("span");
      ts.className = "timestamp";
      ts.textContent = tsMatch[1];
      content.appendChild(ts);
    }

    const itemText = entryText ? entryText.replace(/^- /, "") : altText;
    const actions = document.createElement("div");
    actions.className = "inbox-item-actions";
    actions.appendChild(makeCopyBtn(altText));
    actions.appendChild(makeDeleteBtn(itemText, div));

    div.appendChild(content);
    div.appendChild(actions);

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
      appendInboxItem({ text: data.item.replace(/^- /, ""), contexts: [] });
      inboxInput.value = "";
      autoResize(inboxInput);
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

  async function markItemDone(category, itemText, row) {
    const circle = row.querySelector(".circle");
    circle.classList.add("checking");
    try {
      const data = await api("/api/overview", {
        method: "POST",
        body: JSON.stringify({ category, itemText }),
      });
      if (data.error) {
        alert("Fout: " + data.error);
        circle.classList.remove("checking");
        return;
      }
      circle.classList.remove("checking");
      circle.classList.add("done");
      circle.innerHTML = "&#10003;";
      row.classList.add("completed");
      setTimeout(() => {
        row.style.transition = "opacity 0.3s, transform 0.3s";
        row.style.opacity = "0";
        row.style.transform = "translateX(20px)";
        setTimeout(() => row.remove(), 300);
      }, 600);
    } catch (e) {
      alert("Kon item niet afvinken");
      circle.classList.remove("checking");
    }
  }

  const gripSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';

  const moveSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>';
  const editSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

  function makeEditBtn(category, itemText, row) {
    const btn = document.createElement("button");
    btn.className = "edit-btn";
    btn.innerHTML = editSvg;
    btn.title = "Bewerken";
    btn.addEventListener("click", () => {
      let wrap = row.querySelector(".edit-input-wrap");
      if (wrap) {
        wrap.remove();
        return;
      }
      wrap = document.createElement("div");
      wrap.className = "edit-input-wrap";
      const input = document.createElement("textarea");
      input.rows = 1;
      input.value = itemText;
      setTimeout(() => autoResize(input), 0);
      input.addEventListener("input", () => autoResize(input));
      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Opslaan";

      async function submitEdit() {
        const newText = input.value.trim();
        if (!newText || newText === itemText) {
          wrap.remove();
          return;
        }
        input.disabled = true;
        saveBtn.disabled = true;
        try {
          const data = await api("/api/overview", {
            method: "PATCH",
            body: JSON.stringify({ category, itemText, newText }),
          });
          if (data.error) {
            alert("Fout: " + data.error);
            input.disabled = false;
            saveBtn.disabled = false;
            return;
          }
          // Update the displayed text
          const mainEl = row.querySelector(".item-main");
          mainEl.innerHTML = renderMarkdown(newText);
          // Update button references to new text
          row.querySelectorAll(".copy-btn").forEach(b => {
            b.onclick = () => {
              navigator.clipboard.writeText(newText);
              b.classList.add("copied");
              setTimeout(() => b.classList.remove("copied"), 1500);
            };
          });
          wrap.remove();
        } catch (e) {
          alert("Kon item niet bewerken");
          input.disabled = false;
          saveBtn.disabled = false;
        }
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
        if (e.key === "Escape") wrap.remove();
      });
      saveBtn.addEventListener("click", submitEdit);

      wrap.appendChild(input);
      wrap.appendChild(saveBtn);
      row.querySelector(".item-text").appendChild(wrap);
      input.focus();
      input.select();
    });
    return btn;
  }

  function makeMoveBtn(category, itemText, row) {
    const wrap = document.createElement("div");
    wrap.className = "move-wrap";

    const btn = document.createElement("button");
    btn.className = "move-btn";
    btn.innerHTML = moveSvg;
    btn.title = "Verplaatsen";

    const menu = document.createElement("div");
    menu.className = "move-menu hidden";

    const allCats = { werk: "GEP", fysiek: "Fysiek", code: "Code", persoonlijk: "Persoonlijk", someday: "Someday" };
    for (const [key, label] of Object.entries(allCats)) {
      if (key === category) continue;
      const opt = document.createElement("button");
      opt.className = "move-option";
      opt.textContent = label;
      opt.addEventListener("click", async () => {
        menu.classList.add("hidden");
        row.style.opacity = "0.5";
        try {
          const data = await api("/api/overview", {
            method: "PUT",
            body: JSON.stringify({ fromCategory: category, toCategory: key, itemText }),
          });
          if (data.error) {
            alert("Fout: " + data.error);
            row.style.opacity = "1";
            return;
          }
          row.style.transition = "opacity 0.3s, transform 0.3s";
          row.style.opacity = "0";
          row.style.transform = "translateX(20px)";
          setTimeout(() => row.remove(), 300);
        } catch (e) {
          alert("Kon item niet verplaatsen");
          row.style.opacity = "1";
        }
      });
      menu.appendChild(opt);
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open menus
      document.querySelectorAll(".move-menu").forEach(m => m.classList.add("hidden"));
      menu.classList.toggle("hidden");
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  // Close move menus on outside click
  document.addEventListener("click", () => {
    document.querySelectorAll(".move-menu").forEach(m => m.classList.add("hidden"));
  });

  function makeOverviewContextBtn(category, itemText, row) {
    const btn = document.createElement("button");
    btn.className = "context-btn";
    btn.innerHTML = contextSvg;
    btn.title = "Context toevoegen";
    btn.addEventListener("click", () => {
      let wrap = row.querySelector(".context-input-wrap");
      if (wrap) {
        wrap.remove();
        return;
      }
      wrap = document.createElement("div");
      wrap.className = "context-input-wrap";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Context toevoegen...";
      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Toevoegen";
      sendBtn.className = "context-send-btn";

      async function submitContext() {
        const val = input.value.trim();
        if (!val) return;
        input.disabled = true;
        sendBtn.disabled = true;
        try {
          const data = await api("/api/overview", {
            method: "PATCH",
            body: JSON.stringify({ category, itemText, context: val }),
          });
          if (data.error) {
            alert("Fout: " + data.error);
            return;
          }
          const contextContainer = row.querySelector(".overview-contexts");
          const ctxDiv = document.createElement("div");
          ctxDiv.className = "inbox-context";
          const ctxTsMatch = data.context.match(/\*\((.+?)\)\*$/);
          const ctxText = ctxTsMatch ? data.context.replace(/\s*\*\(.+?\)\*$/, "") : data.context;
          ctxDiv.innerHTML = escapeHtml(ctxText);
          if (ctxTsMatch) {
            ctxDiv.innerHTML += ` <span class="timestamp">${escapeHtml(ctxTsMatch[1])}</span>`;
          }
          contextContainer.appendChild(ctxDiv);
          wrap.remove();
        } catch (e) {
          alert("Kon context niet toevoegen");
          input.disabled = false;
          sendBtn.disabled = false;
        }
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitContext();
        if (e.key === "Escape") wrap.remove();
      });
      sendBtn.addEventListener("click", submitContext);

      wrap.appendChild(input);
      wrap.appendChild(sendBtn);
      row.querySelector(".item-text").appendChild(wrap);
      input.focus();
    });
    return btn;
  }

  function renderItemsIntoCard(card, items, category) {
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
        const contexts = entry.contexts || [];
        const row = document.createElement("div");
        row.className = "overview-item" + (lastHeaderLevel >= 3 ? " sub-item" : "");

        const circle = document.createElement("div");
        circle.className = "circle";
        circle.title = "Markeer als klaar";
        circle.addEventListener("click", () => markItemDone(category, parsed.text, row));

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

        // Context sub-items
        const contextContainer = document.createElement("div");
        contextContainer.className = "overview-contexts";
        contexts.forEach((ctx) => {
          const ctxDiv = document.createElement("div");
          ctxDiv.className = "inbox-context";
          const ctxTsMatch = ctx.match(/\*\((.+?)\)\*$/);
          const ctxText = ctxTsMatch ? ctx.replace(/\s*\*\(.+?\)\*$/, "") : ctx;
          ctxDiv.innerHTML = escapeHtml(ctxText);
          if (ctxTsMatch) {
            ctxDiv.innerHTML += ` <span class="timestamp">${escapeHtml(ctxTsMatch[1])}</span>`;
          }
          contextContainer.appendChild(ctxDiv);
        });
        textWrap.appendChild(contextContainer);

        // Drag handle (hidden for sort-by-date and "alles" tab)
        const handle = document.createElement("div");
        handle.className = "drag-handle";
        handle.innerHTML = gripSvg;
        if (sortNewest || activeCategory === "alles") {
          handle.classList.add("hidden");
        }
        row.appendChild(handle);
        row.appendChild(circle);
        row.appendChild(textWrap);
        row.appendChild(makeEditBtn(category, parsed.text, row));
        row.appendChild(makeOverviewContextBtn(category, parsed.text, row));
        row.appendChild(makeMoveBtn(category, parsed.text, row));
        row.appendChild(makeCopyBtn(parsed.text));
        // Store item text for reorder
        row.dataset.itemText = parsed.text;
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
    renderItemsIntoCard(card, sortItemsByDate(items), cat);
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

      renderItemsIntoCard(card, sortItemsByDate(items), cat);
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

  function addFilesToPreview(files) {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is te groot (max 10MB)`);
        continue;
      }
      pendingFiles.push(file);
    }
    renderUploadPreview();
  }

  function renderUploadPreview() {
    uploadPreview.innerHTML = "";
    if (pendingFiles.length === 0) {
      uploadPreview.classList.add("hidden");
      return;
    }
    uploadPreview.classList.remove("hidden");

    pendingFiles.forEach((file, i) => {
      const item = document.createElement("div");
      item.className = "upload-preview-item";

      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        item.appendChild(img);
      } else {
        const name = document.createElement("span");
        name.className = "file-name";
        name.textContent = file.name;
        item.appendChild(name);
      }

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "\u00D7";
      remove.title = "Verwijderen";
      remove.addEventListener("click", () => {
        pendingFiles.splice(i, 1);
        renderUploadPreview();
      });
      item.appendChild(remove);
      uploadPreview.appendChild(item);
    });
  }

  function clearUploadPreview() {
    pendingFiles = [];
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
    const files = [...pendingFiles];

    if (!text && files.length === 0) return;

    inboxSend.disabled = true;
    inboxInput.disabled = true;
    attachBtn.disabled = true;

    try {
      for (const file of files) {
        const localUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
        const result = await uploadFile(file);
        if (localUrl) {
          appendInboxImage(localUrl, file.name, result.entry);
        } else {
          appendInboxItem({ text: result.entry.replace(/^- /, ""), contexts: [] });
        }
      }
      if (files.length > 0) clearUploadPreview();
      if (text) {
        const data = await api("/api/inbox", {
          method: "POST",
          body: JSON.stringify({ item: text }),
        });
        if (data.error) {
          alert("Fout: " + data.error);
          return;
        }
        appendInboxItem({ text: data.item.replace(/^- /, ""), contexts: [] });
        inboxInput.value = "";
        autoResize(inboxInput);
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

  // --- Drag & Drop ---

  const dropZone = document.getElementById("tab-inbox");

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length === 0) return;
    addFilesToPreview(e.dataTransfer.files);
  });

  attachBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length === 0) return;
    addFilesToPreview(fileInput.files);
    fileInput.value = "";
  });

  inboxSend.addEventListener("click", handleSend);

  inboxInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  inboxInput.addEventListener("input", () => autoResize(inboxInput));

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
  inboxRefreshBtn.addEventListener("click", loadInbox);

  // --- Drag & Drop Reorder ---

  let dragState = null;

  function initDrag(e, handle) {
    const row = handle.closest(".overview-item");
    const card = row.closest(".overview-card");
    if (!row || !card) return;

    // Only respond to primary pointer
    if (e.button !== 0) return;

    e.preventDefault();
    handle.setPointerCapture(e.pointerId);

    const rect = row.getBoundingClientRect();
    const items = [...card.querySelectorAll(".overview-item")];
    const startIndex = items.indexOf(row);

    // Create ghost
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = row.dataset.itemText || "";
    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY - 16}px`;
    document.body.appendChild(ghost);

    row.classList.add("dragging");

    dragState = {
      row,
      card,
      ghost,
      startIndex,
      currentIndex: startIndex,
      pointerId: e.pointerId,
      items,
      indicator: null,
    };
  }

  function moveDrag(e) {
    if (!dragState) return;

    const { ghost, card, row, items } = dragState;

    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY - 16}px`;

    // Remove old indicator
    if (dragState.indicator) {
      dragState.indicator.remove();
      dragState.indicator = null;
    }

    // Find drop target
    let targetIndex = items.length;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === row) continue;
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        targetIndex = i;
        break;
      }
    }

    // Adjust for dragged item position
    const startIndex = items.indexOf(row);
    if (targetIndex > startIndex) targetIndex--;

    dragState.currentIndex = targetIndex;

    // Show drop indicator
    const indicator = document.createElement("div");
    indicator.className = "drop-indicator";

    // Insert indicator in the right place
    const overviewItems = [...card.querySelectorAll(".overview-item")];
    if (targetIndex < startIndex && overviewItems[targetIndex]) {
      overviewItems[targetIndex].before(indicator);
    } else if (overviewItems[targetIndex + (targetIndex >= startIndex ? 1 : 0)]) {
      overviewItems[targetIndex + (targetIndex >= startIndex ? 1 : 0)].before(indicator);
    } else {
      // Append at end
      const lastItem = overviewItems[overviewItems.length - 1];
      if (lastItem) lastItem.after(indicator);
    }

    dragState.indicator = indicator;
  }

  async function endDrag(e) {
    if (!dragState) return;

    const { row, ghost, card, startIndex, currentIndex, items, indicator } = dragState;

    row.classList.remove("dragging");
    ghost.remove();
    if (indicator) indicator.remove();
    dragState = null;

    if (startIndex === currentIndex) return;

    // Reorder DOM
    const overviewItems = [...card.querySelectorAll(".overview-item")];
    const target = overviewItems[currentIndex + (currentIndex > startIndex ? 1 : 0)];
    if (target) {
      target.before(row);
    } else {
      // Move to end — find last overview-item and insert after
      const lastItem = overviewItems[overviewItems.length - 1];
      if (lastItem && lastItem !== row) lastItem.after(row);
    }

    // Collect new order
    const newItems = [...card.querySelectorAll(".overview-item")];
    const orderedItems = newItems
      .map((el) => el.dataset.itemText)
      .filter(Boolean);

    // Send to API
    try {
      const data = await api("/api/overview", {
        method: "PATCH",
        body: JSON.stringify({
          action: "reorder",
          category: activeCategory,
          orderedItems,
        }),
      });
      if (data.error) {
        alert("Herschikken mislukt: " + data.error);
        // Reload to revert
        loadOverview();
      }
    } catch (e) {
      alert("Herschikken mislukt");
      loadOverview();
    }
  }

  overviewContent.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (handle) initDrag(e, handle);
  });

  overviewContent.addEventListener("pointermove", (e) => {
    if (dragState) moveDrag(e);
  });

  overviewContent.addEventListener("pointerup", (e) => {
    if (dragState) endDrag(e);
  });

  overviewContent.addEventListener("pointercancel", (e) => {
    if (dragState) {
      dragState.row.classList.remove("dragging");
      dragState.ghost.remove();
      if (dragState.indicator) dragState.indicator.remove();
      dragState = null;
    }
  });

  // --- Helpers ---

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

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
