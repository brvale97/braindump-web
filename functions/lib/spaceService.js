import {
  SHARED_OVERVIEW_FILE,
  SPACE_FILES,
  findFeedItem,
  parseFeedBlocks,
  parseStructuredOverview,
  serializeFeedItem,
} from "./braindumpParser.js";
import {
  GitHubRepoError,
  appendContextToItem,
  appendInboxItem,
  deleteSpaceItem,
  editSpaceItem,
  getFile,
  updateWithRetry,
} from "./githubRepo.js";

function allowAuthorForSpace(space) {
  return space !== "personal";
}

export async function listSpaceItems(env, space, { noCache = false } = {}) {
  const filePath = SPACE_FILES[space] || SPACE_FILES.personal;
  const file = await getFile(env, filePath, { tolerate404: true, noCache });
  const items = parseFeedBlocks(file?.content || "", { allowAuthor: allowAuthorForSpace(space) });
  return items.map(serializeFeedItem);
}

export async function listSharedOverview(env, { noCache = false } = {}) {
  const file = await getFile(env, SHARED_OVERVIEW_FILE, { tolerate404: true, noCache });
  return parseStructuredOverview(file?.content || "").map((entry) => {
    if (entry.type === "header") {
      return { type: "header", text: entry.text, level: entry.level };
    }

    return {
      type: "item",
      matchKey: entry.matchKey,
      text: entry.text,
      timestamp: entry.timestamp || null,
      contexts: (entry.contexts || []).map((context) => ({
        matchKey: context.matchKey,
        text: context.text,
        timestamp: context.timestamp || null,
      })),
    };
  });
}

function itemMatches(entry, { matchKey, itemText }) {
  return (
    (matchKey && entry.matchKey === matchKey) ||
    (itemText && (entry.text === itemText || entry.rawText === itemText))
  );
}

function findBlockEnd(lines, startIndex) {
  let end = startIndex + 1;
  while (end < lines.length) {
    const next = lines[end];
    const nextTrimmed = next.trim();
    const indent = next.length - next.trimStart().length;
    if (indent >= 2 && (nextTrimmed.startsWith("- ") || nextTrimmed.startsWith("* "))) {
      end += 1;
      continue;
    }
    break;
  }
  return end;
}

function findHeaderSection(entries, headerText) {
  if (!headerText) return null;
  return entries.find((entry) => (
    entry.type === "header" &&
    entry.text.toLowerCase() === headerText.toLowerCase()
  )) || null;
}

function findSectionEnd(lines, entries, header) {
  const nextHeader = entries.find((entry) => (
    entry.type === "header" &&
    entry.lineIndex > header.lineIndex &&
    entry.level <= header.level
  ));
  return nextHeader ? nextHeader.lineIndex : lines.length;
}

function findSharedInsertIndex(content, { targetHeader, beforeMatchKey, position = "end" }) {
  const lines = (content || "").replace(/\r\n?/g, "\n").split("\n");
  const entries = parseStructuredOverview(content || "");

  if (beforeMatchKey) {
    const before = entries.find((entry) => entry.type === "item" && entry.matchKey === beforeMatchKey);
    if (before) return before.lineIndex;
  }

  const header = findHeaderSection(entries, targetHeader);
  if (!header) return lines.length;
  if (position === "start") return header.lineIndex + 1;
  return findSectionEnd(lines, entries, header);
}

function moveSharedBlockInContent(content, { matchKey, itemText, targetHeader, beforeMatchKey, position }) {
  const lines = (content || "").replace(/\r\n?/g, "\n").split("\n");
  const entries = parseStructuredOverview(content || "");
  const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
  if (!found) throw new GitHubRepoError("Item niet gevonden", 404);

  const end = findBlockEnd(lines, found.lineIndex);
  const blockLines = lines.slice(found.lineIndex, end);
  let insertIndex = findSharedInsertIndex(content, { targetHeader, beforeMatchKey, position });

  lines.splice(found.lineIndex, end - found.lineIndex);
  if (insertIndex > found.lineIndex) insertIndex -= end - found.lineIndex;
  lines.splice(Math.max(0, insertIndex), 0, ...blockLines);
  return lines.join("\n");
}

export async function markSharedOverviewDone(env, { matchKey, itemText, channel = "web" }) {
  await updateWithRetry(
    env,
    SHARED_OVERVIEW_FILE,
    (content) => {
      const lines = (content || "").replace(/\r\n?/g, "\n").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden", 404);

      const trimmed = lines[found.lineIndex].trim();
      const prefix = lines[found.lineIndex].match(/^(\s*[-*]\s*)/)?.[1] || "- ";
      lines[found.lineIndex] = `${prefix}~~${trimmed.slice(2)}~~ ✅ done`;
      return lines.join("\n");
    },
    `assistant(${channel}): done shared "${(itemText || matchKey || "").slice(0, 50)}"`
  );

  return { ok: true, overview: await listSharedOverview(env, { noCache: true }) };
}

export async function organizeSharedOverviewItem(env, {
  matchKey,
  itemText,
  targetHeader,
  beforeMatchKey,
  position = "end",
  channel = "web",
}) {
  await updateWithRetry(
    env,
    SHARED_OVERVIEW_FILE,
    (content) => moveSharedBlockInContent(content, {
      matchKey,
      itemText,
      targetHeader,
      beforeMatchKey,
      position,
    }),
    `assistant(${channel}): organize shared`
  );

  return { ok: true, overview: await listSharedOverview(env, { noCache: true }) };
}

export async function addSpaceItem(env, { space, text, role, channel = "web" }) {
  const result = await appendInboxItem(env, { space, text, role, channel });
  const [entry] = parseFeedBlocks(result.entry, { allowAuthor: allowAuthorForSpace(space) });
  return { ok: true, item: serializeFeedItem(entry) };
}

export async function addSpaceContext(env, { space, matchKey, parentItem, text, role, channel = "web" }) {
  const filePath = SPACE_FILES[space] || SPACE_FILES.personal;
  const file = await getFile(env, filePath, { tolerate404: true });
  const blocks = parseFeedBlocks(file?.content || "", { allowAuthor: allowAuthorForSpace(space) });
  const found = findFeedItem(blocks, { matchKey, rawText: parentItem });
  if (!found) throw new GitHubRepoError("Parent item niet gevonden", 404);

  const result = await appendContextToItem(env, {
    space,
    parentItem: found.rawText,
    text,
    role,
    channel,
  });

  const [context] = parseFeedBlocks(`- temp\n${result.entry}`, {
    allowAuthor: allowAuthorForSpace(space),
  })[0].contexts;

  return { ok: true, context: serializeFeedItem({ contexts: [context] }).contexts[0] };
}

export async function removeSpaceItem(env, { space, matchKey, item, channel = "web" }) {
  await deleteSpaceItem(env, { space, matchKey, rawText: item, channel });
  return { ok: true };
}

export async function updateSpaceItem(env, { space, matchKey, oldItem, newText, channel = "web" }) {
  await editSpaceItem(env, { space, matchKey, oldText: oldItem, newText, channel });
  const filePath = SPACE_FILES[space] || SPACE_FILES.personal;
  const file = await getFile(env, filePath, { tolerate404: true });
  const items = parseFeedBlocks(file?.content || "", { allowAuthor: allowAuthorForSpace(space) });
  const updated = items.find((entry) => entry.text === newText.trim());
  return { ok: true, item: updated ? serializeFeedItem(updated) : null };
}
