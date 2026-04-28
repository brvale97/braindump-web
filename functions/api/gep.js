import { guardScope } from "../lib/access.js";
import {
  addSpaceContext,
  addSpaceItem,
  listSpaceItems,
  removeSpaceItem,
} from "../lib/spaceService.js";

const SPACE = "gep";

export async function onRequestGet(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    return Response.json({ items: await listSpaceItems(context.env, SPACE) });
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
    return Response.json(await addSpaceItem(context.env, {
      space: SPACE,
      text: item,
      role: context.data.user,
    }));
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
