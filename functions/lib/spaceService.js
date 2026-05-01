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
