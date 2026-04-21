import { appendJsonlEvent, formatAuditTimestamp, formatBacklogDate, getFile } from "../../lib/githubRepo.js";

function secretOk(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  const headerSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  return headerSecret === env.TELEGRAM_WEBHOOK_SECRET || querySecret === env.TELEGRAM_WEBHOOK_SECRET;
}

async function backlogAlreadyContains(env, filePath, backlogId) {
  const file = await getFile(env, filePath, { tolerate404: true });
  if (!file?.content) return false;
  return file.content.includes(`"id":"${backlogId}"`) || file.content.includes(`"id": "${backlogId}"`);
}

function toBacklogEvent(update) {
  const message = update.message || update.edited_message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!message?.chat?.id || !message?.message_id || !text) return null;

  const sender =
    message.from?.username ||
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") ||
    "telegram-user";

  return {
    id: `telegram-${message.chat.id}-${message.message_id}`,
    timestamp: formatAuditTimestamp(),
    updateId: update.update_id || null,
    chatId: message.chat.id,
    messageId: message.message_id,
    sender,
    text,
    processed: false,
    processedAt: null,
    resultSummary: null,
    error: null,
  };
}

export async function onRequestPost(context) {
  if (!secretOk(context.request, context.env)) {
    return Response.json({ error: "Webhook secret ongeldig" }, { status: 401 });
  }

  try {
    const update = await context.request.json();
    const event = toBacklogEvent(update);
    if (!event) {
      return Response.json({ ok: true, ignored: true });
    }

    const filePath = `state/telegram-backlog/${formatBacklogDate()}.jsonl`;
    if (await backlogAlreadyContains(context.env, filePath, event.id)) {
      return Response.json({ ok: true, duplicate: true });
    }

    const result = await appendJsonlEvent(
      context.env,
      filePath,
      event,
      `telegram-capture: ${String(event.text).slice(0, 60)}`
    );

    return Response.json({ ok: true, filePath, commitSha: result.commitSha, backlogId: event.id });
  } catch (error) {
    return Response.json({ error: error.message || "Telegram capture mislukt" }, { status: 500 });
  }
}
