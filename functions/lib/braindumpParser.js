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

const SKIP_HEADERS = new Set([
  "werk",
  "fysieke taken",
  "persoonlijk",
  "persoonlijke herinneringen, afspraken en notities.",
  "someday / misschien later",
  "ideeën & taken",
  "notities",
]);

const IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|svg)$/i;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/;
const DUTCH_TS_RE = /^\d{2}-\d{2}-\d{4}(?:\s+\d{2}:\d{2})?$/;

function encodeUtf8Base64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeUtf8Base64(text) {
  return decodeURIComponent(escape(atob(text)));
}

export function encodeMatchKey(rawText) {
  return encodeUtf8Base64(rawText)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeMatchKey(matchKey) {
  const normalized = `${matchKey}`.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return decodeUtf8Base64(padded);
}

export function normalizeLineEndings(content = "") {
  return content.replace(/\r\n?/g, "\n");
}

export function stripUncheckedPrefix(text) {
  return text.startsWith("[ ]") ? text.slice(4).trim() : text.trim();
}

export function stripSortedTimestamp(text) {
  return text.replace(/^\[\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\]\s*/, "").trim();
}

export function stripAuthorPrefix(text) {
  return text.replace(/^\[[^\]]+\]\s+/, "").trim();
}

export function stripInboxTimestamp(text) {
  return text.replace(/\s*\*\((.+?)\)\*$/, "").trim();
}

export function normalizeInboxItemText(text) {
  return stripInboxTimestamp(stripAuthorPrefix(text.replace(/^- /, "").trim()));
}

export function summarizeItems(items, limit = 10) {
  return items.slice(0, limit).map((item) => {
    const main = typeof item === "string" ? item : item.text;
    return normalizeInboxItemText(main);
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

export function formatDisplayTimestamp(timestamp) {
  if (!timestamp) return "";
  if (ISO_TS_RE.test(timestamp)) {
    const [datePart, timePart = ""] = timestamp.split(/\s+/);
    const [year, month, day] = datePart.split("-");
    return `${day}-${month}-${year}${timePart ? ` ${timePart}` : ""}`;
  }
  return timestamp;
}

export function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;
  if (ISO_TS_RE.test(timestamp)) return timestamp;
  if (DUTCH_TS_RE.test(timestamp)) {
    const [datePart, timePart = "00:00"] = timestamp.split(/\s+/);
    const [day, month, year] = datePart.split("-");
    return `${year}-${month}-${day} ${timePart}`;
  }
  return null;
}

export function timestampToMillis(timestamp) {
  const normalized = normalizeTimestamp(timestamp);
  if (!normalized) return null;
  const [datePart, timePart = "00:00"] = normalized.split(/\s+/);
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function parseAttachment(text) {
  const match = text.match(/^\[([^\]]+)\]\(([^)]+)\)(?:\s+(.*))?$/);
  if (!match) return null;
  const [, label, url, maybeCaption = ""] = match;
  const caption = maybeCaption.trim();
  const isImage = IMAGE_EXT_RE.test(label) || IMAGE_EXT_RE.test(url);
  return {
    label,
    url,
    caption,
    isImage,
  };
}

function parseFeedChunk(rawText, { allowAuthor = false } = {}) {
  let working = rawText.trim();
  let author = null;

  const authorMatch = allowAuthor ? working.match(/^\[([^\]]+)\]\s+(.*)$/) : null;
  if (authorMatch) {
    author = authorMatch[1];
    working = authorMatch[2];
  }

  const tsMatch = working.match(/\s*\*\((.+?)\)\*$/);
  const timestamp = tsMatch ? tsMatch[1] : null;
  const withoutTimestamp = tsMatch ? working.replace(/\s*\*\((.+?)\)\*$/, "").trim() : working;
  const attachment = parseAttachment(withoutTimestamp);

  return {
    rawText,
    author,
    timestamp,
    timestampIso: normalizeTimestamp(timestamp),
    text: attachment ? (attachment.caption || attachment.label) : withoutTimestamp,
    attachment,
  };
}

export function parseInboxItems(content) {
  return parseFeedItems(content, { allowAuthor: false });
}

export function parseFeedItems(content, { allowAuthor = false } = {}) {
  const items = [];
  const lines = normalizeLineEndings(content).split("\n");

  for (const line of lines) {
    if (line.startsWith("- ")) {
      const parsed = parseFeedChunk(line.slice(2), { allowAuthor });
      items.push({
        text: line.slice(2),
        contexts: [],
        matchKey: encodeMatchKey(line.slice(2)),
        timestamp: parsed.timestamp,
        timestampIso: parsed.timestampIso,
        author: parsed.author,
        attachment: parsed.attachment,
      });
    } else if (line.startsWith("  - ") && items.length > 0) {
      const parsed = parseFeedChunk(line.slice(4), { allowAuthor });
      items[items.length - 1].contexts.push({
        text: line.slice(4),
        matchKey: encodeMatchKey(line.slice(4)),
        timestamp: parsed.timestamp,
        timestampIso: parsed.timestampIso,
        author: parsed.author,
      });
    }
  }

  return items;
}

export function parseFeedBlocks(content, { allowAuthor = false } = {}) {
  const items = [];
  const lines = normalizeLineEndings(content).split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("- ")) {
      const rawText = line.slice(2);
      const parsed = parseFeedChunk(rawText, { allowAuthor });
      items.push({
        type: "item",
        lineIndex: index,
        rawLine: line,
        rawText,
        matchKey: encodeMatchKey(rawText),
        text: parsed.text,
        author: parsed.author,
        timestamp: parsed.timestamp,
        timestampIso: parsed.timestampIso,
        attachment: parsed.attachment,
        contexts: [],
      });
      continue;
    }

    if (line.startsWith("  - ") && items.length > 0) {
      const rawText = line.slice(4);
      const parsed = parseFeedChunk(rawText, { allowAuthor });
      items[items.length - 1].contexts.push({
        type: "context",
        lineIndex: index,
        rawLine: line,
        rawText,
        matchKey: encodeMatchKey(rawText),
        text: parsed.text,
        author: parsed.author,
        timestamp: parsed.timestamp,
        timestampIso: parsed.timestampIso,
      });
    }
  }

  return items;
}

export function findFeedItem(blocks, { matchKey, rawText }) {
  if (matchKey) {
    const byKey = blocks.find((item) => item.matchKey === matchKey);
    if (byKey) return byKey;
  }

  if (!rawText) return null;
  return blocks.find((item) => item.rawText.trim() === rawText.trim());
}

export function serializeFeedItem(item) {
  return {
    matchKey: item.matchKey,
    text: item.text,
    timestamp: item.timestampIso || item.timestamp || null,
    timestampLabel: formatDisplayTimestamp(item.timestamp),
    author: item.author || null,
    attachment: item.attachment || null,
    contexts: (item.contexts || []).map((context) => ({
      matchKey: context.matchKey,
      text: context.text,
      timestamp: context.timestampIso || context.timestamp || null,
      timestampLabel: formatDisplayTimestamp(context.timestamp),
      author: context.author || null,
    })),
  };
}

export function parseOpenOverviewItems(content) {
  return parseStructuredOverview(content).map((entry) => (
    entry.type === "item"
      ? { type: "item", text: entry.text, contexts: entry.contexts.map((ctx) => ctx.text) }
      : entry
  ));
}

export function parseStructuredOverview(content) {
  if (!content) return [];

  const lines = normalizeLineEndings(content).split("\n");
  const result = [];
  let lastTopLevelSkipped = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s*/, "");
      const level = (trimmed.match(/^#+/) || [""])[0].length;
      if (SKIP_HEADERS.has(text.toLowerCase())) continue;
      result.push({ type: "header", text, level, lineIndex: index });
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
      if (!lastItem) continue;
      const stripped = stripSortedTimestamp(stripUncheckedPrefix(text));
      const ctxTimestampMatch = text.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*/);
      lastItem.contexts.push({
        matchKey: encodeMatchKey(text),
        text: stripped,
        timestamp: ctxTimestampMatch ? ctxTimestampMatch[1] : null,
      });
      continue;
    }

    lastTopLevelSkipped = false;
    const timestampMatch = text.match(/^\[(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*/);
    const normalizedText = stripSortedTimestamp(stripUncheckedPrefix(text));
    const isClaudeItem = /^🤖\s*/.test(normalizedText);

    result.push({
      type: "item",
      rawText: text,
      matchKey: encodeMatchKey(text),
      text: normalizedText,
      timestamp: timestampMatch ? timestampMatch[1] : null,
      isClaudeItem,
      contexts: [],
      lineIndex: index,
    });
  }

  while (result.length > 0 && result[result.length - 1].type === "header") {
    result.pop();
  }

  return result;
}
