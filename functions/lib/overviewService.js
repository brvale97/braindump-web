import {
  SORTED_FILES,
  encodeMatchKey,
  normalizeLineEndings,
  normalizeTimestamp,
  parseStructuredOverview,
  stripSortedTimestamp,
} from "./braindumpParser.js";
import {
  GitHubRepoError,
  formatInboxTimestamp,
  getFile,
  listDirectory,
  readOverviewCategories,
  updateWithRetry,
} from "./githubRepo.js";

async function categoryFiles(env, category) {
  const path = SORTED_FILES[category];
  if (!path) throw new GitHubRepoError("Onbekende categorie", 400);

  if (path.endsWith("/")) {
    const listing = await listDirectory(env, path, { tolerate404: true });
    return listing.filter((file) => file.name.endsWith(".md")).map((file) => file.path);
  }

  return [path];
}

function itemMatches(entry, { matchKey, itemText }) {
  return (
    (matchKey && entry.matchKey === matchKey) ||
    (itemText && (entry.text === itemText || stripSortedTimestamp(entry.rawText || "") === itemText))
  );
}

async function findOverviewItem(env, category, { matchKey, itemText }) {
  const files = await categoryFiles(env, category);
  for (const filePath of files) {
    const file = await getFile(env, filePath, { tolerate404: true });
    if (!file) continue;
    const entries = parseStructuredOverview(file.content || "");
    const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
    if (found) return { file, entries, found };
  }

  return null;
}

function serializeOverviewEntry(entry) {
  if (entry.type === "header") {
    return { type: "header", text: entry.text, level: entry.level };
  }

  return {
    type: "item",
    matchKey: entry.matchKey,
    text: entry.text,
    timestamp: entry.timestamp || null,
    isClaudeItem: !!entry.isClaudeItem,
    contexts: (entry.contexts || []).map((context) => ({
      matchKey: context.matchKey,
      text: context.text,
      timestamp: context.timestamp || null,
    })),
  };
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

function findInsertIndex(content, { targetHeader, beforeMatchKey, position = "end" }) {
  const lines = normalizeLineEndings(content || "").split("\n");
  const entries = parseStructuredOverview(content || "");

  if (beforeMatchKey) {
    const before = entries.find((entry) => entry.type === "item" && entry.matchKey === beforeMatchKey);
    if (before) return before.lineIndex;
  }

  const header = findHeaderSection(entries, targetHeader);
  if (!header) {
    return lines.length;
  }

  if (position === "start") {
    return header.lineIndex + 1;
  }

  return findSectionEnd(lines, entries, header);
}

function moveBlockInContent(content, { matchKey, itemText, blockLines, targetHeader, beforeMatchKey, position }) {
  const lines = normalizeLineEndings(content || "").split("\n");
  const entries = parseStructuredOverview(content || "");
  const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
  const sourceBlockLines = blockLines || (found ? lines.slice(found.lineIndex, findBlockEnd(lines, found.lineIndex)) : null);
  if (!sourceBlockLines) throw new GitHubRepoError("Item niet gevonden", 404);

  let insertIndex = findInsertIndex(content, { targetHeader, beforeMatchKey, position });

  if (found) {
    const end = findBlockEnd(lines, found.lineIndex);
    lines.splice(found.lineIndex, end - found.lineIndex);
    if (insertIndex > found.lineIndex) {
      insertIndex -= end - found.lineIndex;
    }
  }

  lines.splice(Math.max(0, insertIndex), 0, ...sourceBlockLines);
  return lines.join("\n");
}

export async function listOverview(env) {
  const categories = await readOverviewCategories(env);
  return Object.fromEntries(
    Object.entries(categories).map(([key, entries]) => [
      key,
      entries.map(serializeOverviewEntry),
    ])
  );
}

export async function markOverviewItemDone(env, { category, matchKey, itemText, channel = "web" }) {
  const located = await findOverviewItem(env, category, { matchKey, itemText });
  if (!located) throw new GitHubRepoError("Item niet gevonden", 404);

  const filePath = located.file.path;
  await updateWithRetry(
    env,
    filePath,
    (content) => {
      const lines = (content || "").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden", 404);

      const trimmed = lines[found.lineIndex].trim();
      const prefix = lines[found.lineIndex].match(/^(\s*[-*]\s*)/)?.[1] || "- ";
      const lineText = trimmed.slice(2);
      lines[found.lineIndex] = `${prefix}~~${lineText}~~ ✅ done`;
      return lines.join("\n");
    },
    `assistant(${channel}): done "${(itemText || matchKey || "").slice(0, 50)}"`
  );

  return { ok: true };
}

export async function editOverviewItem(env, { category, matchKey, itemText, newText, channel = "web" }) {
  const located = await findOverviewItem(env, category, { matchKey, itemText });
  if (!located) throw new GitHubRepoError("Item niet gevonden", 404);

  await updateWithRetry(
    env,
    located.file.path,
    (content) => {
      const lines = (content || "").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden", 404);

      const oldLine = lines[found.lineIndex];
      const prefix = oldLine.match(/^(\s*[-*]\s*)/)?.[1] || "- ";
      const datePrefix = found.timestamp ? `[${found.timestamp}] ` : "";
      lines[found.lineIndex] = `${prefix}${datePrefix}${newText.trim()}`;
      return lines.join("\n");
    },
    `assistant(${channel}): edit "${newText.trim().slice(0, 40)}"`
  );

  return { ok: true };
}

export async function addOverviewContext(env, { category, matchKey, itemText, text, channel = "web" }) {
  const located = await findOverviewItem(env, category, { matchKey, itemText });
  if (!located) throw new GitHubRepoError("Item niet gevonden", 404);

  const timestamp = formatInboxTimestamp();
  const contextLine = `  - ${text.trim()} *(${timestamp})*`;

  await updateWithRetry(
    env,
    located.file.path,
    (content) => {
      const lines = (content || "").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden", 404);

      const insertAt = findBlockEnd(lines, found.lineIndex);
      lines.splice(insertAt, 0, contextLine);
      return lines.join("\n");
    },
    `assistant(${channel}): context "${(itemText || matchKey || "").slice(0, 40)}"`
  );

  return {
    ok: true,
    context: {
      matchKey: encodeMatchKey(contextLine.trim().slice(2)),
      text: text.trim(),
      timestamp: normalizeTimestamp(timestamp),
    },
  };
}

export async function moveOverviewItem(env, { fromCategory, toCategory, matchKey, itemText, channel = "web" }) {
  if (fromCategory === toCategory) throw new GitHubRepoError("Bron en doel zijn hetzelfde", 400);

  const source = await findOverviewItem(env, fromCategory, { matchKey, itemText });
  if (!source) throw new GitHubRepoError("Item niet gevonden in broncategorie", 404);

  const sourceLines = source.file.content.split("\n");
  const blockEnd = findBlockEnd(sourceLines, source.found.lineIndex);
  const blockLines = sourceLines.slice(source.found.lineIndex, blockEnd);

  await updateWithRetry(
    env,
    source.file.path,
    (content) => {
      const lines = (content || "").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden in broncategorie", 404);
      const end = findBlockEnd(lines, found.lineIndex);
      lines.splice(found.lineIndex, end - found.lineIndex);
      return lines.join("\n");
    },
    `assistant(${channel}): move "${(itemText || matchKey || "").slice(0, 40)}" → ${toCategory}`
  );

  const destFiles = await categoryFiles(env, toCategory);
  const destPath = destFiles[0];
  if (!destPath) throw new GitHubRepoError("Doelbestand niet gevonden", 404);

  await updateWithRetry(
    env,
    destPath,
    (content) => {
      const lines = (content || "").split("\n");
      let insertIdx = lines.length;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const trimmed = lines[index].trim();
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          insertIdx = index + 1;
          break;
        }
      }
      lines.splice(insertIdx, 0, ...blockLines);
      return lines.join("\n");
    },
    `assistant(${channel}): move "${(itemText || matchKey || "").slice(0, 40)}" → ${toCategory}`
  );

  return { ok: true };
}

export async function organizeOverviewItem(env, {
  fromCategory,
  toCategory,
  matchKey,
  itemText,
  targetHeader,
  beforeMatchKey,
  position = "end",
  channel = "web",
}) {
  if (!fromCategory || !toCategory) throw new GitHubRepoError("Bron en doel zijn vereist", 400);

  const source = await findOverviewItem(env, fromCategory, { matchKey, itemText });
  if (!source) throw new GitHubRepoError("Item niet gevonden in broncategorie", 404);

  const sourceLines = normalizeLineEndings(source.file.content || "").split("\n");
  const blockEnd = findBlockEnd(sourceLines, source.found.lineIndex);
  const blockLines = sourceLines.slice(source.found.lineIndex, blockEnd);
  const sameCategory = fromCategory === toCategory;

  if (sameCategory) {
    await updateWithRetry(
      env,
      source.file.path,
      (content) => moveBlockInContent(content, {
        matchKey,
        itemText,
        targetHeader,
        beforeMatchKey,
        position,
      }),
      `assistant(${channel}): organize ${fromCategory}`
    );
    return { ok: true };
  }

  await updateWithRetry(
    env,
    source.file.path,
    (content) => {
      const lines = normalizeLineEndings(content || "").split("\n");
      const entries = parseStructuredOverview(content || "");
      const found = entries.find((entry) => entry.type === "item" && itemMatches(entry, { matchKey, itemText }));
      if (!found) throw new GitHubRepoError("Item niet gevonden in broncategorie", 404);
      const end = findBlockEnd(lines, found.lineIndex);
      lines.splice(found.lineIndex, end - found.lineIndex);
      return lines.join("\n");
    },
    `assistant(${channel}): organize ${fromCategory} → ${toCategory}`
  );

  const destFiles = await categoryFiles(env, toCategory);
  const destPath = destFiles[0];
  if (!destPath) throw new GitHubRepoError("Doelbestand niet gevonden", 404);

  await updateWithRetry(
    env,
    destPath,
    (content) => moveBlockInContent(content, {
      blockLines,
      targetHeader,
      beforeMatchKey,
      position,
    }),
    `assistant(${channel}): organize ${fromCategory} → ${toCategory}`
  );

  return { ok: true };
}

export async function reorderOverviewItems(env, { category, orderedMatchKeys, channel = "web" }) {
  const path = SORTED_FILES[category];
  if (!path || path.endsWith("/")) {
    throw new GitHubRepoError("Categorie ondersteunt geen herschikken", 400);
  }

  await updateWithRetry(
    env,
    path,
    (content) => {
      const lines = (content || "").split("\n");
      const blocks = [];
      let currentBlock = null;

      for (const line of lines) {
        const trimmed = line.trim();
        const indent = line.length - line.trimStart().length;

        if (indent >= 2 && (trimmed.startsWith("- ") || trimmed.startsWith("* ")) && currentBlock?.reorderable) {
          currentBlock.lines.push(line);
          continue;
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          if (currentBlock) blocks.push(currentBlock);
          const text = trimmed.slice(2);
          const isDone = text.includes("~~") || text.startsWith("[x]") || text.startsWith("[X]");
          currentBlock = {
            reorderable: !isDone,
            key: !isDone ? encodeMatchKey(text) : null,
            lines: [line],
          };
          continue;
        }

        if (currentBlock) {
          blocks.push(currentBlock);
          currentBlock = null;
        }

        blocks.push({ reorderable: false, key: null, lines: [line] });
      }

      if (currentBlock) blocks.push(currentBlock);

      const fixed = [];
      const reorderable = [];
      blocks.forEach((block, index) => {
        if (block.reorderable) {
          reorderable.push(block);
        } else {
          fixed.push({ index, block });
        }
      });

      const ordered = [];
      const used = new Set();
      for (const key of orderedMatchKeys) {
        const foundIndex = reorderable.findIndex((block, index) => !used.has(index) && block.key === key);
        if (foundIndex !== -1) {
          ordered.push(reorderable[foundIndex]);
          used.add(foundIndex);
        }
      }

      reorderable.forEach((block, index) => {
        if (!used.has(index)) ordered.push(block);
      });

      const result = [];
      let orderedIndex = 0;
      for (let index = 0; index < blocks.length; index += 1) {
        const fixedBlock = fixed.find((entry) => entry.index === index);
        if (fixedBlock) {
          result.push(...fixedBlock.block.lines);
        } else {
          result.push(...ordered[orderedIndex].lines);
          orderedIndex += 1;
        }
      }

      return result.join("\n");
    },
    `assistant(${channel}): reorder ${category}`
  );

  return { ok: true };
}
