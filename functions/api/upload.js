import { parseFeedBlocks, serializeFeedItem } from "../lib/braindumpParser.js";
import {
  buildRepoBlobUrl,
  formatInboxTimestamp,
  putBase64File,
  updateWithRetry,
} from "../lib/githubRepo.js";

export async function onRequestPost(context) {
  try {
    const { filename, content, caption } = await context.request.json();

    if (!filename || !content) {
      return Response.json({ error: "Bestandsnaam en inhoud zijn vereist" }, { status: 400 });
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const ts = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadPath = `uploads/${yyyy}-${mm}/${ts}-${safeName}`;

    await putBase64File(context.env, uploadPath, content, {
      message: `upload: ${filename}`,
    });

    const fileUrl = buildRepoBlobUrl(context.env, uploadPath);
    const timestamp = formatInboxTimestamp(now);
    const entry = caption
      ? `- [${filename}](${fileUrl}) ${caption} *(${timestamp})*`
      : `- [${filename}](${fileUrl}) *(${timestamp})*`;

    await updateWithRetry(
      context.env,
      "inbox.md",
      (existing) => {
        const lines = (existing || "").split("\n");
        let insertIndex = lines.findIndex((line) => line.trim() === "---");
        if (insertIndex === -1) {
          insertIndex = 1;
          while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex += 1;
        } else {
          insertIndex += 1;
        }
        lines.splice(insertIndex, 0, entry);
        return lines.join("\n");
      },
      `assistant(web): upload ${filename}`
    );

    const [item] = parseFeedBlocks(entry, { allowAuthor: false });
    return Response.json({ ok: true, url: fileUrl, item: serializeFeedItem(item) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
