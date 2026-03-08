const REPO_OWNER = "brvale97";
const REPO_NAME = "braindump-bram";
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

  // If it's a directory, fetch all files in it
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

function parseOpenItems(content) {
  if (!content) return [];
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Include list items that are NOT done (no strikethrough, no [x])
      if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) return false;
      if (trimmed.includes("~~") || trimmed.includes("[x]") || trimmed.includes("[X]")) return false;
      // Also include headers for structure
      return true;
    })
    .concat(
      content.split("\n").filter((line) => line.trim().startsWith("#"))
    );
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
      // Skip done items
      if (text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]")) continue;
      // Skip empty checkbox items
      if (text.startsWith("[ ]")) {
        result.push({ type: "item", text: text.slice(4).trim() });
      } else {
        result.push({ type: "item", text });
      }
    }
  }

  // Remove trailing headers with no items after them
  while (result.length > 0 && result[result.length - 1].type === "header") {
    result.pop();
  }

  return result;
}

async function getFileWithSha(env, filePath) {
  const res = await githubRequest(env, `contents/${filePath}?ref=${BRANCH}`);
  if (!res.ok) return null;
  const data = await res.json();
  return { content: decodeBase64(data.content), sha: data.sha, path: filePath };
}

async function updateFile(env, filePath, content, sha, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "braindump-web",
    },
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

// POST: mark item as done
export async function onRequestPost(context) {
  try {
    const { category, itemText } = await context.request.json();
    if (!category || !itemText) {
      return Response.json({ error: "category en itemText zijn vereist" }, { status: 400 });
    }

    const sortedPath = SORTED_FILES[category];
    if (!sortedPath) {
      return Response.json({ error: "Onbekende categorie" }, { status: 400 });
    }

    // For directories (code-projects), find the right file
    const isDir = sortedPath.endsWith("/");
    let files = [];

    if (isDir) {
      const res = await githubRequest(context.env, `contents/${sortedPath}?ref=${BRANCH}`);
      if (!res.ok) return Response.json({ error: "Map niet gevonden" }, { status: 404 });
      const listing = await res.json();
      for (const f of listing) {
        if (f.name.endsWith(".md")) {
          files.push(f.path);
        }
      }
    } else {
      files.push(sortedPath);
    }

    // Search each file for the item
    for (const filePath of files) {
      const file = await getFileWithSha(context.env, filePath);
      if (!file) continue;

      const lines = file.content.split("\n");
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;
        // Already done? Skip
        if (trimmed.includes("~~")) continue;

        const lineText = trimmed.slice(2);
        // Match: strip date prefix for comparison
        const stripped = lineText.replace(/^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*/, "");

        if (stripped === itemText || lineText === itemText) {
          // Wrap in strikethrough
          const prefix = lines[i].match(/^(\s*[-*]\s*)/)[1];
          lines[i] = `${prefix}~~${lineText}~~ ✅ done`;
          found = true;
          break;
        }
      }

      if (found) {
        const newContent = lines.join("\n");
        await updateFile(context.env, filePath, newContent, file.sha, `web: done "${itemText.slice(0, 50)}"`);
        return Response.json({ success: true });
      }
    }

    return Response.json({ error: "Item niet gevonden" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestGet(context) {
  try {
    const categories = {};

    // Fetch all files in parallel
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
