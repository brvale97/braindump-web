const REPO_OWNER = "brvale97";
const REPO_NAME = "braindump-bram";
const FILE_PATH = "inbox.md";
const BRANCH = "main";

async function githubRequest(env, path, options = {}) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${path}`;
  const { headers: extraHeaders, cf, ...restOptions } = options;
  const fetchOpts = {
    ...restOptions,
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "braindump-web",
      ...extraHeaders,
    },
  };
  if (cf) fetchOpts.cf = cf;
  const res = await fetch(url, fetchOpts);
  return res;
}

async function getFile(env, noCache = false) {
  const cacheBust = noCache ? `&_t=${Date.now()}` : "";
  const opts = noCache ? {
    headers: { "If-None-Match": "" },
    cf: { cacheTtl: 0 }
  } : {};
  const res = await githubRequest(env, `contents/${FILE_PATH}?ref=${BRANCH}${cacheBust}`, opts);
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

// Access guard: only bram can access private inbox
function guardBram(context) {
  const role = context.data && context.data.user;
  if (role && role !== "bram") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  return null;
}

// GET: read current inbox items
export async function onRequestGet(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const url = new URL(context.request.url);
    const noCache = url.searchParams.has("nocache");
    const { content } = await getFile(context.env, noCache);
    const items = parseInbox(content);
    return Response.json({ items }, noCache ? {
      headers: { "Cache-Control": "no-store, no-cache", "Pragma": "no-cache" }
    } : {});
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// POST: add item to inbox
export async function onRequestPost(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const { item } = await context.request.json();
    if (!item || !item.trim()) {
      return Response.json({ error: "Item is vereist" }, { status: 400 });
    }

    const { content, sha } = await getFile(context.env);

    // Format: - [timestamp] item text
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

    // Insert after the --- separator
    const lines = content.split("\n");
    let insertIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        insertIndex = i + 1;
        break;
      }
    }
    // If no separator found, append after header
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

// DELETE: remove item from inbox
export async function onRequestDelete(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const { item } = await context.request.json();
    if (!item || !item.trim()) {
      return Response.json({ error: "Item is vereist" }, { status: 400 });
    }

    const { content, sha } = await getFile(context.env);
    const lines = content.split("\n");
    const target = `- ${item.trim()}`;

    const idx = lines.findIndex((line) => line.trim() === target);
    if (idx === -1) {
      return Response.json({ error: "Item niet gevonden" }, { status: 404 });
    }

    // Count sub-items (lines starting with "  - " after the parent)
    let removeCount = 1;
    while (idx + removeCount < lines.length && lines[idx + removeCount].startsWith("  - ")) {
      removeCount++;
    }
    lines.splice(idx, removeCount);
    const newContent = lines.join("\n");
    await updateFile(context.env, newContent, sha, `web: delete "${item.trim().slice(0, 50)}"`);

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: add context to an existing inbox item
export async function onRequestPatch(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const { parentItem, context: ctxText } = await context.request.json();
    if (!parentItem || !ctxText || !ctxText.trim()) {
      return Response.json({ error: "parentItem en context zijn vereist" }, { status: 400 });
    }

    const { content, sha } = await getFile(context.env);
    const lines = content.split("\n");
    const target = `- ${parentItem.trim()}`;

    const idx = lines.findIndex((line) => line.trim() === target);
    if (idx === -1) {
      return Response.json({ error: "Parent item niet gevonden" }, { status: 404 });
    }

    // Find end of existing sub-items
    let insertAt = idx + 1;
    while (insertAt < lines.length && lines[insertAt].startsWith("  - ")) {
      insertAt++;
    }

    const now = new Date();
    const timestamp = now.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const contextLine = `  - ${ctxText.trim()} *(${timestamp})*`;
    lines.splice(insertAt, 0, contextLine);

    const newContent = lines.join("\n");
    await updateFile(context.env, newContent, sha, `web: context on "${parentItem.trim().slice(0, 40)}"`);

    return Response.json({ success: true, context: contextLine.slice(4) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function parseInbox(content) {
  const lines = content.split("\n");
  const items = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      items.push({ text: line.slice(2), contexts: [] });
    } else if (line.startsWith("  - ") && items.length > 0) {
      items[items.length - 1].contexts.push(line.slice(4));
    }
  }
  return items;
}
