const REPO_OWNER = "brvale97";
const REPO_NAME = "braindump-bram";
const FILE_PATH = "gep/inbox.md";
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
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
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

// Access guard: only bram for now (later: add gep team roles)
function guardAccess(context) {
  const role = context.data && context.data.user;
  if (role && role !== "bram") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  return null;
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

// GET: read gep inbox items
export async function onRequestGet(context) {
  const denied = guardAccess(context);
  if (denied) return denied;
  try {
    const { content } = await getFile(context.env);
    const items = parseInbox(content);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// POST: add item to gep inbox
export async function onRequestPost(context) {
  const denied = guardAccess(context);
  if (denied) return denied;
  try {
    const { item } = await context.request.json();
    if (!item || !item.trim()) {
      return Response.json({ error: "Item is vereist" }, { status: 400 });
    }

    const role = (context.data && context.data.user) || "bram";
    const author = role.charAt(0).toUpperCase() + role.slice(1);

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
    const newLine = `- [${author}] ${item.trim()} *(${timestamp})*`;

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
    await updateFile(context.env, newContent, sha, `gep: [${author}] ${item.trim().slice(0, 50)}`);

    return Response.json({ success: true, item: newLine });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: remove item from gep inbox
export async function onRequestDelete(context) {
  const denied = guardAccess(context);
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

    let removeCount = 1;
    while (idx + removeCount < lines.length && lines[idx + removeCount].startsWith("  - ")) {
      removeCount++;
    }
    lines.splice(idx, removeCount);
    const newContent = lines.join("\n");
    await updateFile(context.env, newContent, sha, `gep: delete "${item.trim().slice(0, 50)}"`);

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: add context to a gep inbox item
export async function onRequestPatch(context) {
  const denied = guardAccess(context);
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

    let insertAt = idx + 1;
    while (insertAt < lines.length && lines[insertAt].startsWith("  - ")) {
      insertAt++;
    }

    const role = (context.data && context.data.user) || "bram";
    const author = role.charAt(0).toUpperCase() + role.slice(1);

    const now = new Date();
    const timestamp = now.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const contextLine = `  - [${author}] ${ctxText.trim()} *(${timestamp})*`;
    lines.splice(insertAt, 0, contextLine);

    const newContent = lines.join("\n");
    await updateFile(context.env, newContent, sha, `gep: context on "${parentItem.trim().slice(0, 40)}"`);

    return Response.json({ success: true, context: contextLine.slice(4) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
