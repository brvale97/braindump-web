import { guardScope } from "../lib/access.js";
import {
  addSpaceContext,
  addSpaceItem,
  listSpaceItems,
  removeSpaceItem,
  updateSpaceItem,
} from "../lib/spaceService.js";

const SPACE = "personal";

export async function onRequestGet(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const url = new URL(context.request.url);
    const items = await listSpaceItems(context.env, SPACE, {
      noCache: url.searchParams.has("nocache"),
    });
    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const { item } = await context.request.json();
    if (!item || !item.trim()) {
      return Response.json({ error: "Item is vereist" }, { status: 400 });
    }
    const result = await addSpaceItem(context.env, {
      space: SPACE,
      text: item,
      role: context.data.user,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const { matchKey, item } = await context.request.json();
    if (!matchKey && !item) {
      return Response.json({ error: "matchKey of item is vereist" }, { status: 400 });
    }
    return Response.json(await removeSpaceItem(context.env, { space: SPACE, matchKey, item }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function onRequestPatch(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const { matchKey, parentItem, context: text } = await context.request.json();
    if ((!matchKey && !parentItem) || !text || !text.trim()) {
      return Response.json({ error: "matchKey/parentItem en context zijn vereist" }, { status: 400 });
    }
    return Response.json(await addSpaceContext(context.env, {
      space: SPACE,
      matchKey,
      parentItem,
      text,
      role: context.data.user,
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function onRequestPut(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const { matchKey, oldItem, newText } = await context.request.json();
    if ((!matchKey && !oldItem) || !newText || !newText.trim()) {
      return Response.json({ error: "matchKey/oldItem en newText zijn vereist" }, { status: 400 });
    }
    return Response.json(await updateSpaceItem(context.env, {
      space: SPACE,
      matchKey,
      oldItem,
      newText,
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
