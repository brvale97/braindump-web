// Access guard: only bram can access overview
function guardBram(context) {
  const role = context.data && context.data.user;
  if (role && role !== "bram") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  return null;
}

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
    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s*/, "");
      const level = (trimmed.match(/^#+/) || [""])[0].length;
      if (skipHeaders.has(text.toLowerCase())) continue;
      result.push({ type: "header", text, level });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2);
      // Skip done items
      if (text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]")) continue;

      // Indented = sub-item / context of the last item
      if (indent >= 2) {
        const lastItem = [...result].reverse().find((r) => r.type === "item");
        if (lastItem) {
          const ctxText = text.startsWith("[ ]") ? text.slice(4).trim() : text;
          lastItem.contexts.push(ctxText);
        }
      } else if (text.startsWith("[ ]")) {
        result.push({ type: "item", text: text.slice(4).trim(), contexts: [] });
      } else {
        result.push({ type: "item", text, contexts: [] });
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
  const denied = guardBram(context);
  if (denied) return denied;
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

// Helper: find item line in files for a category
async function findItemInCategory(env, category, itemText) {
  const sortedPath = SORTED_FILES[category];
  if (!sortedPath) return null;

  const isDir = sortedPath.endsWith("/");
  let files = [];

  if (isDir) {
    const res = await githubRequest(env, `contents/${sortedPath}?ref=${BRANCH}`);
    if (!res.ok) return null;
    const listing = await res.json();
    for (const f of listing) {
      if (f.name.endsWith(".md")) files.push(f.path);
    }
  } else {
    files.push(sortedPath);
  }

  for (const filePath of files) {
    const file = await getFileWithSha(env, filePath);
    if (!file) continue;

    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;
      if (trimmed.includes("~~")) continue;

      const lineText = trimmed.slice(2);
      const stripped = lineText.replace(/^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*/, "");

      if (stripped === itemText || lineText === itemText) {
        return { file, lineIndex: i, fullLine: lines[i] };
      }
    }
  }
  return null;
}

// PUT: move item to different category
export async function onRequestPut(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const { fromCategory, toCategory, itemText } = await context.request.json();
    if (!fromCategory || !toCategory || !itemText) {
      return Response.json({ error: "fromCategory, toCategory en itemText zijn vereist" }, { status: 400 });
    }
    if (fromCategory === toCategory) {
      return Response.json({ error: "Bron en doel zijn hetzelfde" }, { status: 400 });
    }
    if (!SORTED_FILES[toCategory]) {
      return Response.json({ error: "Onbekende doelcategorie" }, { status: 400 });
    }

    // 1. Find and remove from source
    const found = await findItemInCategory(context.env, fromCategory, itemText);
    if (!found) {
      return Response.json({ error: "Item niet gevonden in broncategorie" }, { status: 404 });
    }

    const srcLines = found.file.content.split("\n");
    const removedLine = srcLines[found.lineIndex];
    srcLines.splice(found.lineIndex, 1);
    const newSrcContent = srcLines.join("\n");
    await updateFile(context.env, found.file.path, newSrcContent, found.file.sha,
      `web: move "${itemText.slice(0, 40)}" → ${toCategory}`);

    // 2. Add to destination
    const destPath = SORTED_FILES[toCategory];
    // For directories, we can't easily pick a file — use the first .md file
    let destFilePath = destPath;
    if (destPath.endsWith("/")) {
      const res = await githubRequest(context.env, `contents/${destPath}?ref=${BRANCH}`);
      if (!res.ok) return Response.json({ error: "Doelmap niet gevonden" }, { status: 404 });
      const listing = await res.json();
      const mdFiles = listing.filter(f => f.name.endsWith(".md") && f.name !== ".gitkeep");
      if (mdFiles.length === 0) return Response.json({ error: "Geen bestanden in doelmap" }, { status: 404 });
      destFilePath = mdFiles[0].path;
    }

    const destFile = await getFileWithSha(context.env, destFilePath);
    if (!destFile) {
      return Response.json({ error: "Doelbestand niet gevonden" }, { status: 404 });
    }

    const destLines = destFile.content.split("\n");
    // Find the --- separator or end of file, insert after last item
    let insertIdx = destLines.length;
    for (let i = destLines.length - 1; i >= 0; i--) {
      if (destLines[i].trim().startsWith("- ") || destLines[i].trim().startsWith("* ")) {
        insertIdx = i + 1;
        break;
      }
    }
    // Extract just the item text (without prefix whitespace changes)
    const itemLine = removedLine.trim();
    destLines.splice(insertIdx, 0, itemLine);
    const newDestContent = destLines.join("\n");
    await updateFile(context.env, destFilePath, newDestContent, destFile.sha,
      `web: move "${itemText.slice(0, 40)}" → ${toCategory}`);

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: add context to an overview item, edit item text, or reorder items
export async function onRequestPatch(context) {
  const denied = guardBram(context);
  if (denied) return denied;
  try {
    const body = await context.request.json();
    const { category, itemText, context: ctxText, newText, action, orderedItems } = body;

    // Reorder mode
    if (action === "reorder") {
      if (!category || !orderedItems || !Array.isArray(orderedItems)) {
        return Response.json({ error: "category en orderedItems zijn vereist" }, { status: 400 });
      }
      const sortedPath = SORTED_FILES[category];
      if (!sortedPath || sortedPath.endsWith("/")) {
        return Response.json({ error: "Categorie ondersteunt geen herschikken" }, { status: 400 });
      }

      const file = await getFileWithSha(context.env, sortedPath);
      if (!file) {
        return Response.json({ error: "Bestand niet gevonden" }, { status: 404 });
      }

      const lines = file.content.split("\n");

      // Build blocks: each item = main line + its indented sub-items
      const blocks = []; // { key, lines[] }
      const preamble = []; // lines before first item (headers, blank lines)
      let currentBlock = null;

      for (const line of lines) {
        const trimmed = line.trim();
        const indent = line.length - line.trimStart().length;

        if (indent >= 2 && (trimmed.startsWith("- ") || trimmed.startsWith("* ")) && currentBlock) {
          // Sub-item of current block
          currentBlock.lines.push(line);
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          // New top-level item
          const text = trimmed.slice(2);
          if (text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]")) {
            // Done item — keep in preamble/tail (won't be reordered)
            if (currentBlock) {
              blocks.push(currentBlock);
              currentBlock = null;
            }
            blocks.push({ key: null, lines: [line] });
            continue;
          }
          if (currentBlock) blocks.push(currentBlock);
          // Compute key: strip date prefix and [ ] checkbox
          let key = text.replace(/^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*/, "");
          if (key.startsWith("[ ] ")) key = key.slice(4);
          currentBlock = { key, lines: [line] };
        } else if (trimmed.startsWith("#")) {
          // Header line
          if (currentBlock) {
            blocks.push(currentBlock);
            currentBlock = null;
          }
          blocks.push({ key: null, lines: [line] });
        } else {
          // Blank lines or other content
          if (currentBlock) {
            // Could be blank line inside a block — attach to current
            currentBlock.lines.push(line);
          } else {
            blocks.push({ key: null, lines: [line] });
          }
        }
      }
      if (currentBlock) blocks.push(currentBlock);

      // Separate reorderable blocks from fixed (headers, done items, etc)
      const fixed = []; // { index, block }
      const reorderable = []; // { key, block }
      blocks.forEach((block, i) => {
        if (block.key) {
          reorderable.push(block);
        } else {
          fixed.push({ index: i, block });
        }
      });

      // Reorder based on orderedItems
      const ordered = [];
      const used = new Set();
      for (const itemText of orderedItems) {
        const idx = reorderable.findIndex((b, i) => !used.has(i) && b.key === itemText);
        if (idx !== -1) {
          ordered.push(reorderable[idx]);
          used.add(idx);
        }
      }
      // Append any items not in orderedItems (shouldn't happen, but safe)
      reorderable.forEach((b, i) => {
        if (!used.has(i)) ordered.push(b);
      });

      // Reconstruct: fixed blocks stay in place, reorderable fill in order
      const result = [];
      let orderedIdx = 0;
      for (let i = 0; i < blocks.length; i++) {
        const fixedBlock = fixed.find((f) => f.index === i);
        if (fixedBlock) {
          result.push(...fixedBlock.block.lines);
        } else {
          if (orderedIdx < ordered.length) {
            result.push(...ordered[orderedIdx].lines);
            orderedIdx++;
          }
        }
      }

      const newContent = result.join("\n");
      await updateFile(context.env, file.path, newContent, file.sha,
        `web: reorder ${category}`);

      return Response.json({ success: true });
    }

    if (!category || !itemText) {
      return Response.json({ error: "category en itemText zijn vereist" }, { status: 400 });
    }

    // Edit mode: replace item text
    if (newText && newText.trim()) {
      const found = await findItemInCategory(context.env, category, itemText);
      if (!found) {
        return Response.json({ error: "Item niet gevonden" }, { status: 404 });
      }

      const lines = found.file.content.split("\n");
      const oldLine = lines[found.lineIndex];
      const prefix = oldLine.match(/^(\s*[-*]\s*)/)[1];
      // Preserve original date prefix if present
      const dateMatch = oldLine.slice(prefix.length).match(/^(\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*)/);
      const datePrefix = dateMatch ? dateMatch[1] : "";
      lines[found.lineIndex] = `${prefix}${datePrefix}${newText.trim()}`;

      const newContent = lines.join("\n");
      await updateFile(context.env, found.file.path, newContent, found.file.sha,
        `web: edit "${itemText.slice(0, 30)}" → "${newText.trim().slice(0, 30)}"`);

      return Response.json({ success: true });
    }

    // Context mode: add context sub-item
    if (!ctxText || !ctxText.trim()) {
      return Response.json({ error: "context of newText is vereist" }, { status: 400 });
    }

    const found = await findItemInCategory(context.env, category, itemText);
    if (!found) {
      return Response.json({ error: "Item niet gevonden" }, { status: 404 });
    }

    const lines = found.file.content.split("\n");

    // Find end of existing sub-items after the parent line
    let insertAt = found.lineIndex + 1;
    while (insertAt < lines.length) {
      const nextLine = lines[insertAt];
      const nextIndent = nextLine.length - nextLine.trimStart().length;
      const nextTrimmed = nextLine.trim();
      if (nextIndent >= 2 && (nextTrimmed.startsWith("- ") || nextTrimmed.startsWith("* "))) {
        insertAt++;
      } else {
        break;
      }
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
    await updateFile(context.env, found.file.path, newContent, found.file.sha,
      `web: context on "${itemText.slice(0, 40)}"`);

    return Response.json({ success: true, context: contextLine.slice(4) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestGet(context) {
  const denied = guardBram(context);
  if (denied) return denied;
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
