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
