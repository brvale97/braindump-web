import { guardScope } from "../lib/access.js";
import {
  addOverviewContext,
  editOverviewItem,
  listOverview,
  markOverviewItemDone,
  moveOverviewItem,
  organizeOverviewItem,
  reorderOverviewItems,
} from "../lib/overviewService.js";

export async function onRequestGet(context) {
  const denied = guardScope(context, "overview");
  if (denied) return denied;

  try {
    return Response.json({ categories: await listOverview(context.env) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function onRequestPost(context) {
  const denied = guardScope(context, "overview");
  if (denied) return denied;

  try {
    const { category, matchKey, itemText } = await context.request.json();
    if (!category || (!matchKey && !itemText)) {
      return Response.json({ error: "category en matchKey/itemText zijn vereist" }, { status: 400 });
    }
    return Response.json(await markOverviewItemDone(context.env, {
      category,
      matchKey,
      itemText,
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function onRequestPut(context) {
  const denied = guardScope(context, "overview");
  if (denied) return denied;

  try {
    const { fromCategory, toCategory, matchKey, itemText } = await context.request.json();
    if (!fromCategory || !toCategory || (!matchKey && !itemText)) {
      return Response.json({ error: "fromCategory, toCategory en matchKey/itemText zijn vereist" }, { status: 400 });
    }
    return Response.json(await moveOverviewItem(context.env, {
      fromCategory,
      toCategory,
      matchKey,
      itemText,
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}

export async function onRequestPatch(context) {
  const denied = guardScope(context, "overview");
  if (denied) return denied;

  try {
    const body = await context.request.json();
    const {
      category,
      matchKey,
      itemText,
      newText,
      context: text,
      action,
      orderedItems,
      orderedMatchKeys,
      fromCategory,
      toCategory,
      targetHeader,
      beforeMatchKey,
      position,
    } = body;

    if (action === "reorder") {
      if (!category || (!orderedMatchKeys && !orderedItems)) {
        return Response.json({ error: "category en orderedMatchKeys/orderedItems zijn vereist" }, { status: 400 });
      }
      return Response.json(await reorderOverviewItems(context.env, {
        category,
        orderedMatchKeys: orderedMatchKeys || orderedItems,
      }));
    }

    if (action === "organize") {
      if (!fromCategory || !toCategory || (!matchKey && !itemText)) {
        return Response.json({ error: "fromCategory, toCategory en matchKey/itemText zijn vereist" }, { status: 400 });
      }
      return Response.json(await organizeOverviewItem(context.env, {
        fromCategory,
        toCategory,
        matchKey,
        itemText,
        targetHeader,
        beforeMatchKey,
        position,
      }));
    }

    if (!category || (!matchKey && !itemText)) {
      return Response.json({ error: "category en matchKey/itemText zijn vereist" }, { status: 400 });
    }

    if (newText && newText.trim()) {
      return Response.json(await editOverviewItem(context.env, {
        category,
        matchKey,
        itemText,
        newText,
      }));
    }

    if (!text || !text.trim()) {
      return Response.json({ error: "context of newText is vereist" }, { status: 400 });
    }

    return Response.json(await addOverviewContext(context.env, {
      category,
      matchKey,
      itemText,
      text,
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
