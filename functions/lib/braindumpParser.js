export const SPACE_FILES = {
  personal: "inbox.md",
  gep: "gep/inbox.md",
  shared: "shared/inbox.md",
};

export const SORTED_FILES = {
  werk: "sorted/werk.md",
  fysiek: "sorted/fysiek.md",
  code: "sorted/code-projects/",
  persoonlijk: "sorted/persoonlijk.md",
  someday: "sorted/someday.md",
};

export const CATEGORY_LABELS = {
  werk: "Werk",
  fysiek: "Fysiek",
  code: "Code",
  persoonlijk: "Persoonlijk",
  someday: "Someday",
};

export function parseInboxItems(content) {
  if (!content) return [];

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

export function parseOpenOverviewItems(content) {
  if (!content) return [];

  const lines = content.split("\n");
  const result = [];
  let lastTopLevelSkipped = false;
  const skipHeaders = new Set([
    "werk",
    "fysieke taken",
    "persoonlijk",
    "persoonlijke herinneringen, afspraken en notities.",
    "someday / misschien later",
    "ideeën & taken",
    "notities",
  ]);

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s*/, "");
      const level = (trimmed.match(/^#+/) || [""])[0].length;
      if (skipHeaders.has(text.toLowerCase())) continue;
      result.push({ type: "header", text, level });
      lastTopLevelSkipped = false;
      continue;
    }

    if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;

    const text = trimmed.slice(2);
    if (text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]")) {
      if (indent < 2) lastTopLevelSkipped = true;
      continue;
    }

    if (indent >= 2) {
      if (lastTopLevelSkipped) continue;
      const lastItem = [...result].reverse().find((entry) => entry.type === "item");
      if (lastItem) {
        lastItem.contexts.push(stripSortedTimestamp(stripUncheckedPrefix(text)));
      }
      continue;
    }

    lastTopLevelSkipped = false;
    result.push({ type: "item", text: stripSortedTimestamp(stripUncheckedPrefix(text)), contexts: [] });
  }

  while (result.length > 0 && result[result.length - 1].type === "header") {
    result.pop();
  }

  return result;
}

export function stripUncheckedPrefix(text) {
  return text.startsWith("[ ]") ? text.slice(4).trim() : text.trim();
}

export function stripSortedTimestamp(text) {
  return text.replace(/^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*/, "").trim();
}

export function stripAuthorPrefix(text) {
  return text.replace(/^\[[^\]]+\]\s*/, "").trim();
}

export function stripInboxTimestamp(text) {
  return text.replace(/\s*\*\(.+?\)\*$/, "").trim();
}

export function normalizeInboxItemText(text) {
  return stripInboxTimestamp(stripAuthorPrefix(text.replace(/^- /, "").trim()));
}

export function summarizeItems(items, limit = 10) {
  return items.slice(0, limit).map((item) => {
    const main = typeof item === "string" ? item : item.text;
    const normalized = normalizeInboxItemText(main);
    return normalized;
  });
}

export function slugifyProjectName(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

export function projectPathFromInput(projectFile, projectTitle) {
  if (projectFile && projectFile.startsWith("sorted/code-projects/")) {
    return projectFile;
  }
  const base = projectFile || slugifyProjectName(projectTitle || "nieuw-project");
  const filename = base.endsWith(".md") ? base : `${base}.md`;
  return `sorted/code-projects/${filename}`;
}

export function titleFromProjectPath(projectPath) {
  const base = projectPath.split("/").pop() || projectPath;
  return base
    .replace(/\.md$/i, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
