const REPO_OWNER = "brvale97";
const REPO_NAME = "braindump-bram";
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
    const { filename, mimeType, content, caption } = await context.request.json();

    if (!filename || !content) {
      return Response.json({ error: "Bestandsnaam en inhoud zijn vereist" }, { status: 400 });
    }

    // Build upload path: uploads/YYYY-MM/{timestamp}-{filename}
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const ts = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadPath = `uploads/${yyyy}-${mm}/${ts}-${safeName}`;

    // Upload file to GitHub (new file, no sha needed)
    const uploadRes = await githubRequest(context.env, `contents/${uploadPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `upload: ${filename}`,
        content, // already base64
        branch: BRANCH,
      }),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} - ${err}`);
    }

    const fileUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${uploadPath}`;

    // Add entry to inbox.md
    const timestamp = now.toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const entry = caption
      ? `- [${filename}](${fileUrl}) ${caption} *(${timestamp})*`
      : `- [${filename}](${fileUrl}) *(${timestamp})*`;

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
