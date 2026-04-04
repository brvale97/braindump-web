// Sync endpoint removed — poller now checks GitHub directly.
// Kept as stub to avoid 404s from old clients.
export async function onRequestPost() {
  return Response.json({ status: "ok" });
}
