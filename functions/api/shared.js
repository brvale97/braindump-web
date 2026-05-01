import { guardScope } from "../lib/access.js";
import {
  addSpaceContext,
  addSpaceItem,
  listSharedOverview,
  listSpaceItems,
  markSharedOverviewDone,
  organizeSharedOverviewItem,
  removeSpaceItem,
} from "../lib/spaceService.js";

const SPACE = "shared";

export async function onRequestGet(context) {
  const denied = guardScope(context, SPACE);
  if (denied) return denied;

  try {
    const noCache = new URL(context.request.url).searchParams.has("nocache");
    const [items, overview] = await Promise.all([
      listSpaceItems(context.env, SPACE, { noCache }),
      listSharedOverview(context.env, { noCache }),
    ]);
    return Response.json({ items, overview });
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
    const body = await context.request.json();
    const {
      action,
      matchKey,
      itemText,
      parentItem,
      context: text,
      targetHeader,
      beforeMatchKey,
      position,
    } = body;

    if (action === "done") {
      if (!matchKey && !itemText) {
        return Response.json({ error: "matchKey/itemText is vereist" }, { status: 400 });
      }
      return Response.json(await markSharedOverviewDone(context.env, {
        matchKey,
        itemText,
      }));
    }

    if (action === "organize") {
      if (!matchKey && !itemText) {
        return Response.json({ error: "matchKey/itemText is vereist" }, { status: 400 });
      }
      return Response.json(await organizeSharedOverviewItem(context.env, {
        matchKey,
        itemText,
        targetHeader,
        beforeMatchKey,
        position,
      }));
    }

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
