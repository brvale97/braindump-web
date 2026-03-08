const REPO_OWNER = "brvale97";
const REPO_NAME = "braindump-bram";
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

// GET: read current inbox items
export async function onRequestGet(context) {
  try {
    const { content } = await getFile(context.env);
    const items = parseInbox(content);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// POST: add item to inbox
export async function onRequestPost(context) {
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

    // Append after the header (first line)
    const lines = content.split("\n");
    let insertIndex = 1;
    // Skip header and any empty lines after it
    while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
      insertIndex++;
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
