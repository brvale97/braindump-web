# Braindump Systeem — Complete Setup Instructie voor Claude Code

Plak deze volledige instructie in Claude Code op de nieuwe machine. Claude zal alles automatisch opzetten.

---

## Instructie voor Claude Code

Ik wil een compleet persoonlijk braindump-systeem opzetten. Dit bestaat uit twee delen:

1. **Een GitHub repo** voor de data (inbox, gesorteerde taken, uploads)
2. **Een web UI** gehost op Cloudflare Pages (PIN-beveiligd)

Vraag me EERST om de volgende gegevens voordat je begint:
- **GitHub username** (bijv. `jandejong`)
- **Gewenste repo naam** voor de data (bijv. `braindump-jan`)
- **Gewenste project naam** voor de web UI (bijv. `braindump-jan-web`)
- **PIN code** die ik wil gebruiken om in te loggen
- **Categorie-labels** voor het overzicht (standaard: Werk, Fysiek, Code, Persoonlijk, Someday — pas aan als gewenst)

---

### Stap 1: Vereisten checken

Controleer of het volgende geinstalleerd is:
```bash
node --version    # Node.js 18+
npm --version     # npm
git --version     # git
gh --version      # GitHub CLI
npx wrangler --version  # Cloudflare Wrangler
```

Als `gh` niet ingelogd is: `gh auth login`
Als `wrangler` niet ingelogd is: `npx wrangler login`

---

### Stap 2: GitHub data-repo aanmaken

Maak een **private** GitHub repo aan en zet de basisstructuur op:

```bash
mkdir ~/REPO_NAME && cd ~/REPO_NAME
git init
```

Maak deze bestanden aan:

**inbox.md:**
```markdown
# Inbox

Alles wat binnenkomt landt hier. Claude sorteert het bij de volgende run.

---
```

**sorted/werk.md:**
```markdown
# Werk

---
```

**sorted/fysiek.md:**
```markdown
# Fysieke Taken

---
```

**sorted/code-projects/.gitkeep** (lege file)

**sorted/persoonlijk.md:**
```markdown
# Persoonlijk

---
```

**sorted/someday.md:**
```markdown
# Someday / Misschien Later

---
```

Commit en push:
```bash
git add -A
git commit -m "Initial braindump structure"
gh repo create GITHUB_USERNAME/REPO_NAME --private --source=. --push
```

---

### Stap 3: GitHub Personal Access Token

Maak een Fine-grained PAT aan:
1. Ga naar https://github.com/settings/tokens?type=beta
2. **Token name**: `braindump-web`
3. **Expiration**: minimaal 90 dagen (of geen expiry)
4. **Repository access**: Only select repositories → selecteer de data-repo
5. **Permissions**: Contents → Read and write
6. Genereer en kopieer het token

---

### Stap 4: Web UI project aanmaken

```bash
mkdir ~/WEB_PROJECT_NAME && cd ~/WEB_PROJECT_NAME
npm init -y
npm install --save-dev wrangler
```

Pas `package.json` aan:
```json
{
  "name": "WEB_PROJECT_NAME",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler pages dev public",
    "deploy": "wrangler pages deploy public"
  },
  "devDependencies": {
    "wrangler": "^3"
  }
}
```

**wrangler.toml:**
```toml
name = "WEB_PROJECT_NAME"
compatibility_date = "2024-09-23"
pages_build_output_dir = "./public"
```

**.gitignore:**
```
node_modules/
.dev.vars
.wrangler/
```

---

### Stap 5: Bronbestanden aanmaken

Maak de mappen aan:
```bash
mkdir -p public functions/api
```

Maak de volgende bestanden aan. **Vervang in ALLE bestanden:**
- `__REPO_OWNER__` → het GitHub username
- `__REPO_NAME__` → de data-repo naam
- `__WERK_LABEL__` → het label voor de werk-categorie (bijv. "Werk" of een bedrijfsnaam)

---

#### `functions/_middleware.js`
```javascript
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === "/api/auth" || !url.pathname.startsWith("/api/")) {
    return next();
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) {
    return Response.json({ error: "Ongeldig token" }, { status: 401 });
  }

  const [tokenData, expiryStr, sigHex] = parts;
  const expiry = parseInt(expiryStr, 10);

  if (Date.now() > expiry) {
    return Response.json({ error: "Token verlopen" }, { status: 401 });
  }

  try {
    const encoder = new TextEncoder();
    const payload = `${tokenData}.${expiryStr}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map((byte) => parseInt(byte, 16)));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload));
    if (!valid) {
      return Response.json({ error: "Ongeldig token" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Token verificatie mislukt" }, { status: 401 });
  }

  return next();
}
```

#### `functions/api/auth.js`
```javascript
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const { pin } = await context.request.json();
    if (!pin) {
      return Response.json({ error: "PIN is vereist" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    if (hashHex !== env.PIN_HASH) {
      return Response.json({ error: "Ongeldige PIN" }, { status: 401 });
    }

    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const tokenData = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const payload = `${tokenData}.${expiry}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const token = `${payload}.${sigHex}`;

    return Response.json({ token, expiry });
  } catch (e) {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
```

#### `functions/api/inbox.js`
```javascript
const REPO_OWNER = "__REPO_OWNER__";
const REPO_NAME = "__REPO_NAME__";
const FILE_PATH = "inbox.md";
const BRANCH = "main";

async function githubRequest(env, path, options = {}) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "braindump-web",
      ...options.headers,
    },
  });
  return res;
}

async function getFile(env) {
  const res = await githubRequest(env, `contents/${FILE_PATH}?ref=${BRANCH}`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ""));
  return { content, sha: data.sha };
}

async function updateFile(env, content, sha, message) {
  const res = await githubRequest(env, `contents/${FILE_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      sha,
      branch: BRANCH,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub commit error: ${res.status} - ${err}`);
  }
  return res.json();
}

export async function onRequestGet(context) {
  try {
    const { content } = await getFile(context.env);
    const items = parseInbox(content);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const { item } = await context.request.json();
    if (!item || !item.trim()) {
      return Response.json({ error: "Item is vereist" }, { status: 400 });
    }

    const { content, sha } = await getFile(context.env);

    const now = new Date();
    const timestamp = now.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const newLine = `- ${item.trim()} *(${timestamp})*`;

    const lines = content.split("\n");
    let insertIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        insertIndex = i + 1;
        break;
      }
    }
    if (insertIndex === -1) {
      insertIndex = 1;
      while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
        insertIndex++;
      }
    }
    lines.splice(insertIndex, 0, newLine);

    const newContent = lines.join("\n");
    await updateFile(context.env, newContent, sha, `web: ${item.trim().slice(0, 50)}`);

    return Response.json({ success: true, item: newLine });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function parseInbox(content) {
  return content
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}
```

#### `functions/api/overview.js`
```javascript
const REPO_OWNER = "__REPO_OWNER__";
const REPO_NAME = "__REPO_NAME__";
const BRANCH = "main";

const SORTED_FILES = {
  werk: "sorted/werk.md",
  fysiek: "sorted/fysiek.md",
  code: "sorted/code-projects/",
  persoonlijk: "sorted/persoonlijk.md",
  someday: "sorted/someday.md",
};

async function githubRequest(env, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "braindump-web",
    },
  });
  return res;
}

async function getFileContent(env, filePath) {
  const res = await githubRequest(env, `contents/${filePath}?ref=${BRANCH}`);
  if (!res.ok) return null;
  const data = await res.json();

  if (Array.isArray(data)) {
    let combined = "";
    for (const file of data) {
      if (file.name.endsWith(".md")) {
        const fileRes = await githubRequest(env, `contents/${file.path}?ref=${BRANCH}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          const content = decodeBase64(fileData.content);
          combined += content + "\n\n";
        }
      }
    }
    return combined;
  }

  return decodeBase64(data.content);
}

function decodeBase64(encoded) {
  return decodeURIComponent(escape(atob(encoded.replace(/\n/g, ""))));
}

function parseStructured(content) {
  if (!content) return [];
  const lines = content.split("\n");
  const result = [];

  const skipHeaders = new Set([
    "werk", "fysieke taken", "persoonlijk",
    "persoonlijke herinneringen, afspraken en notities.",
    "someday / misschien later",
    "ideeën & taken", "notities",
  ]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s*/, "");
      const level = (trimmed.match(/^#+/) || [""])[0].length;
      if (skipHeaders.has(text.toLowerCase())) continue;
      result.push({ type: "header", text, level });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2);
      if (text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]")) continue;
      if (text.startsWith("[ ]")) {
        result.push({ type: "item", text: text.slice(4).trim() });
      } else {
        result.push({ type: "item", text });
      }
    }
  }

  while (result.length > 0 && result[result.length - 1].type === "header") {
    result.pop();
  }

  return result;
}

export async function onRequestGet(context) {
  try {
    const categories = {};

    const entries = Object.entries(SORTED_FILES);
    const results = await Promise.all(
      entries.map(([key, path]) => getFileContent(context.env, path))
    );

    for (let i = 0; i < entries.length; i++) {
      const [key] = entries[i];
      categories[key] = parseStructured(results[i]);
    }

    return Response.json({ categories });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
```

#### `functions/api/upload.js`
```javascript
const REPO_OWNER = "__REPO_OWNER__";
const REPO_NAME = "__REPO_NAME__";
const BRANCH = "main";

async function githubRequest(env, path, options = {}) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "braindump-web",
      ...options.headers,
    },
  });
  return res;
}

async function getFile(env, filePath) {
  const res = await githubRequest(env, `contents/${filePath}?ref=${BRANCH}`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ""));
  return { content, sha: data.sha };
}

async function updateFile(env, filePath, content, sha, message) {
  const res = await githubRequest(env, `contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      sha,
      branch: BRANCH,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub commit error: ${res.status} - ${err}`);
  }
  return res.json();
}

export async function onRequestPost(context) {
  try {
    const { filename, mimeType, content } = await context.request.json();

    if (!filename || !content) {
      return Response.json({ error: "Bestandsnaam en inhoud zijn vereist" }, { status: 400 });
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const ts = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadPath = `uploads/${yyyy}-${mm}/${ts}-${safeName}`;

    const uploadRes = await githubRequest(context.env, `contents/${uploadPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `upload: ${filename}`,
        content,
        branch: BRANCH,
      }),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} - ${err}`);
    }

    const fileUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${uploadPath}`;

    const timestamp = now.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const entry = `- [${filename}](${fileUrl}) *(${timestamp})*`;

    const { content: inboxContent, sha } = await getFile(context.env, "inbox.md");
    const lines = inboxContent.split("\n");
    let insertIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        insertIndex = i + 1;
        break;
      }
    }
    if (insertIndex === -1) {
      insertIndex = 1;
      while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
        insertIndex++;
      }
    }
    lines.splice(insertIndex, 0, entry);

    await updateFile(context.env, "inbox.md", lines.join("\n"), sha, `web upload: ${filename}`);

    return Response.json({ ok: true, url: fileUrl, entry });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
```

#### `public/index.html`
```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Braindump</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <!-- PIN Screen -->
  <div id="login-screen" class="screen">
    <div class="login-box">
      <h1>Braindump</h1>
      <p class="login-subtitle">Voer je PIN in om te beginnen</p>
      <input type="password" id="pin-input" inputmode="numeric" placeholder="PIN" maxlength="10" autocomplete="off">
      <button id="pin-submit">Unlock</button>
      <p id="pin-error" class="error hidden"></p>
    </div>
  </div>

  <!-- Main App -->
  <div id="app-screen" class="screen hidden">
    <div class="container">
      <!-- Tab navigation -->
      <nav class="tabs">
        <button class="tab active" data-tab="inbox">Braindump</button>
        <button class="tab" data-tab="overview">Overzicht</button>
      </nav>

      <!-- Inbox tab -->
      <div id="tab-inbox" class="tab-content active">
        <div class="inbox-feed" id="inbox-feed">
          <div class="loading" id="inbox-loading">Laden...</div>
        </div>
        <div class="chat-input">
          <div class="composer">
            <div id="upload-preview" class="upload-preview hidden"></div>
            <input type="text" id="inbox-input" placeholder="Nieuw item..." autocomplete="off">
            <div class="composer-actions">
              <button id="attach-btn" class="attach-btn" title="Bestand toevoegen">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button id="inbox-send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Overview tab -->
      <div id="tab-overview" class="tab-content hidden">
        <div class="overview-header">
          <div class="category-tabs" id="category-tabs">
            <button class="cat-tab active" data-cat="alles">Alles</button>
            <button class="cat-tab" data-cat="werk">__WERK_LABEL__</button>
            <button class="cat-tab" data-cat="fysiek">Fysiek</button>
            <button class="cat-tab" data-cat="code">Code</button>
            <button class="cat-tab" data-cat="persoonlijk">Persoonlijk</button>
            <button class="cat-tab" data-cat="someday">Someday</button>
          </div>
          <button id="refresh-btn" class="refresh-btn" title="Ververs">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </div>
        <div class="overview-content" id="overview-content">
          <div class="loading" id="overview-loading">Laden...</div>
        </div>
      </div>
    </div>
  </div>

  <input type="file" id="file-input" accept="image/*,.pdf,.doc,.docx,.txt" hidden>
  <script src="/app.js"></script>
</body>
</html>
```

#### `public/app.js`

**Let op:** vervang `__WERK_LABEL__` in de `categoryLabels` object.

```javascript
(function () {
  const TOKEN_KEY = "braindump_token";
  const EXPIRY_KEY = "braindump_expiry";

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

  const categoryLabels = {
    werk: "__WERK_LABEL__",
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

    inboxFeed.scrollTop = inboxFeed.scrollHeight;
  }

  function appendInboxItem(text) {
    const emptyEl = inboxFeed.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "inbox-item";

    const tsMatch = text.match(/\*\((.+?)\)\*$/);
    const mainText = tsMatch ? text.replace(/\s*\*\(.+?\)\*$/, "") : text;

    const imgExts = /\.(jpe?g|png|gif|webp|svg)$/i;
    const linkMatch = mainText.match(/^\[(.+?)\]\((.+?)\)$/);

    if (linkMatch && imgExts.test(linkMatch[1])) {
      const rawUrl = linkMatch[2].replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
      div.innerHTML = `<img class="inbox-img" src="${escapeHtml(rawUrl)}" alt="${escapeHtml(linkMatch[1])}">`;
      if (tsMatch) {
        div.innerHTML += `<span class="timestamp">${escapeHtml(tsMatch[1])}</span>`;
      }
    } else if (tsMatch) {
      div.innerHTML = `${escapeHtml(mainText)} <span class="timestamp">${escapeHtml(tsMatch[1])}</span>`;
    } else {
      div.textContent = text;
    }

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
    categoryTabs.forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));

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

  // --- Upload ---

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
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
```

#### `public/style.css`
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #F5F3EE;
  --surface: #FFFFFF;
  --surface2: #F0EDE8;
  --border: #E5E2DB;
  --text: #1A1A1A;
  --text-muted: #8C8C8C;
  --accent: #DA7B3B;
  --accent-hover: #C06A2E;
  --danger: #D94040;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  font-size: 16px;
  line-height: 1.6;
}

.hidden { display: none !important; }

.screen {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.container {
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.login-box {
  margin: auto;
  padding: 3rem 2rem;
  text-align: center;
  width: 100%;
  max-width: 360px;
}

.login-box h1 {
  font-size: 1.75rem;
  margin-bottom: 0.5rem;
  font-weight: 700;
  color: var(--text);
}

.login-subtitle {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 2rem;
}

.login-box input {
  width: 100%;
  padding: 0.85rem 1rem;
  font-size: 1.1rem;
  text-align: center;
  letter-spacing: 0.3em;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  outline: none;
  margin-bottom: 1rem;
  transition: border-color 0.2s;
}

.login-box input:focus {
  border-color: var(--accent);
}

.login-box button {
  width: 100%;
  padding: 0.85rem;
  font-size: 1rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.2s;
}

.login-box button:hover { background: var(--accent-hover); }
.login-box button:active { background: var(--accent-hover); }

.error {
  color: var(--danger);
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.tabs {
  display: flex;
  gap: 0;
  padding: 0.75rem 1rem 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
}

.tab {
  padding: 0.6rem 1.25rem;
  font-size: 0.9rem;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.tab:hover:not(.active) { color: var(--text); }

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-content.hidden { display: none !important; }

.inbox-feed {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.inbox-item {
  background: var(--surface);
  padding: 1rem 1.25rem;
  border-radius: 12px;
  font-size: 0.95rem;
  line-height: 1.6;
  border: 1px solid var(--border);
  animation: fadeIn 0.2s ease;
}

.inbox-item .inbox-img {
  max-width: 100%;
  max-height: 240px;
  border-radius: 8px;
  display: block;
  object-fit: contain;
}

.inbox-item .timestamp {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 0.4rem;
  font-style: normal;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-input {
  padding: 0.75rem 1rem;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.composer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.composer:focus-within { border-color: var(--accent); }

.composer input {
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 0.95rem;
  border: none;
  background: transparent;
  color: var(--text);
  outline: none;
}

.composer input::placeholder { color: var(--text-muted); }

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.5rem 0.5rem;
}

.attach-btn {
  width: 36px;
  height: 36px;
  background: none;
  color: var(--text-muted);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.2s, background 0.2s;
}

.attach-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface2);
}

.attach-btn:disabled { opacity: 0.4; cursor: not-allowed; }

#inbox-send {
  width: 36px;
  height: 36px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s;
}

#inbox-send:hover:not(:disabled) { background: var(--accent-hover); }
#inbox-send:disabled { opacity: 0.4; cursor: not-allowed; }

.upload-preview {
  position: relative;
  display: inline-block;
  padding: 0.75rem 0.75rem 0;
}

.upload-preview img {
  max-height: 100px;
  max-width: 160px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
}

.upload-preview .file-name {
  display: inline-block;
  font-size: 0.85rem;
  color: var(--text);
  background: var(--surface2);
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  word-break: break-all;
}

.upload-preview .remove {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  width: 22px;
  height: 22px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.upload-preview .remove:hover { background: rgba(0, 0, 0, 0.8); }

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem 0.25rem;
  gap: 0.5rem;
}

.refresh-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 0.4rem;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.2s, background 0.2s;
}

.refresh-btn:hover {
  color: var(--text);
  background: var(--surface2);
}

.category-tabs {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
}

.cat-tab {
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 20px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
  font-weight: 500;
}

.cat-tab:hover:not(.active) {
  border-color: var(--text-muted);
  color: var(--text);
}

.cat-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.overview-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.overview-card {
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid var(--border);
  padding: 0.5rem 0;
}

.overview-card-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.75rem 1.25rem 0.5rem;
}

.overview-header-item {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--text);
  padding: 0.75rem 1.25rem 0.25rem;
}

.overview-header-item.sub-header {
  padding-left: 2rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.overview-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.6rem 1.25rem;
  font-size: 0.9rem;
  line-height: 1.5;
}

.overview-item + .overview-item { border-top: 1px solid var(--border); }
.overview-header-item + .overview-item { border-top: none; }

.overview-item .circle {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border: 2px solid var(--border);
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 2px;
}

.overview-item .item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.overview-item .item-date {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.15rem;
}

.copy-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
}

.overview-item:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: var(--text); }
.copy-btn.copied { opacity: 1; color: var(--accent); }

@media (hover: none) {
  .copy-btn { opacity: 0.4; }
}

.overview-item.sub-item { padding-left: 2.75rem; }

.overview-item.sub-item .circle {
  width: 16px;
  height: 16px;
  min-width: 16px;
  margin-top: 3px;
}

.loading {
  color: var(--text-muted);
  text-align: center;
  padding: 3rem;
  font-size: 0.9rem;
}

.empty {
  color: var(--text-muted);
  text-align: center;
  padding: 3rem;
  font-style: italic;
  font-size: 0.9rem;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
```

---

### Stap 6: PIN hash genereren

Genereer de SHA-256 hash van de gekozen PIN:
```bash
echo -n "DE_GEKOZEN_PIN" | sha256sum | cut -d' ' -f1
```

Sla het resultaat op — dit wordt de `PIN_HASH`.

---

### Stap 7: Git repo voor web UI

```bash
cd ~/WEB_PROJECT_NAME
git init
git add -A
git commit -m "Initial braindump web UI"
gh repo create GITHUB_USERNAME/WEB_PROJECT_NAME --private --source=. --push
```

---

### Stap 8: Cloudflare Pages deployen

```bash
cd ~/WEB_PROJECT_NAME
npx wrangler pages project create WEB_PROJECT_NAME --production-branch main
npx wrangler pages deploy public --project-name WEB_PROJECT_NAME
```

---

### Stap 9: Environment variables instellen op Cloudflare

Stel deze secrets in via wrangler:
```bash
echo "HET_GITHUB_TOKEN" | npx wrangler pages secret put GITHUB_TOKEN --project-name WEB_PROJECT_NAME
echo "DE_PIN_HASH" | npx wrangler pages secret put PIN_HASH --project-name WEB_PROJECT_NAME
echo "$(openssl rand -hex 32)" | npx wrangler pages secret put SESSION_SECRET --project-name WEB_PROJECT_NAME
```

---

### Stap 10: GitHub repo koppelen voor auto-deploy

Ga naar https://dash.cloudflare.com → Pages → het project → Settings → Builds & deployments:
- Koppel de GitHub repo (`WEB_PROJECT_NAME`)
- Build command: (leeg laten)
- Build output directory: `public`
- Branch: `main`

Vanaf nu deployt elke push automatisch.

---

### Stap 11: Testen

1. Ga naar `https://WEB_PROJECT_NAME.pages.dev`
2. Voer de PIN in
3. Typ een item en verzend
4. Check de data-repo op GitHub — het item moet in `inbox.md` staan
5. Upload een afbeelding via de + knop

---

### Lokaal testen (optioneel)

Maak `.dev.vars` aan in de web project root:
```
GITHUB_TOKEN=het_github_token
PIN_HASH=de_pin_hash
SESSION_SECRET=dev-secret-key
```

Start lokaal:
```bash
npm run dev
```

---

## Local-First Assistant Setup

### Architectuur

De webapp blijft de UI en de remote capture-laag.

- `braindump-web` doet:
  - bestaande inbox/overview CRUD
  - Telegram capture webhook
- `braindump-web` is quick-dump-only in de composer
- de echte GPT 5.4-assistent draait lokaal op je eigen pc
- er is dus geen remote `OPENAI_API_KEY` nodig in Cloudflare

### Nieuwe Cloudflare secrets

Zet deze als Pages secrets of production vars:

- `GITHUB_TOKEN`
- `PIN_HASH`
- `SESSION_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`

Optioneel als je webhook-verificatie of extra statusrouting wilt uitbreiden:

- `TELEGRAM_BOT_TOKEN`

### Telegram capture route

Gebruik deze webhook:

```text
https://<jouw-pages-domain>/api/telegram/capture?secret=<TELEGRAM_WEBHOOK_SECRET>
```

`/api/telegram/webhook` wijst nu ook naar dezelfde capture-only flow.

Gedrag:

- webhook valideert alleen het secret
- inkomende tekst wordt append-only opgeslagen in `state/telegram-backlog/YYYY-MM-DD.jsonl`
- er wordt remote geen GPT-call gedaan
- backlog wordt later door de lokale daemon verwerkt

### Lokale daemon

De lokale daemon draait standaard op:

```text
http://127.0.0.1:4317
```

De webapp gebruikt de daemon niet meer voor een assistentmodus. `Snel dumpen` loopt gewoon via de normale braindump-web API.

De lokale daemon is alleen nog relevant voor lokale verwerking buiten de webcomposer, zoals Telegram/backlog-afhandeling in `bram-assistent`.

### Lokale secrets

Deze horen op je eigen machine in `~/.config/braindump-daemon/.env` of in lokale environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL_BRAINDUMP=gpt-5.4`
- `GITHUB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `OB1_BASE_URL`
- `OB1_ACCESS_KEY`

### OB1 adapter

De lokale daemon verwacht een simpele HTTP-wrapper bovenop OB1:

- `POST {OB1_BASE_URL}/search_thoughts`
- `POST {OB1_BASE_URL}/capture_thought`

Headers:

```text
x-access-key: <OB1_ACCESS_KEY>
content-type: application/json
```

Payloads:

```json
{ "query": "zoekterm", "limit": 5 }
```

```json
{ "content": "duurzame notitie of beslissing" }
```
