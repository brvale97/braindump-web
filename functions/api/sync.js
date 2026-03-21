// POST: set sync flag in KV so WSL2 poller picks it up
export async function onRequestPost(context) {
  const { env } = context;
  await env.SYNC_STORE.put("sync_requested", Date.now().toString(), {
    expirationTtl: 3600,
  });
  return Response.json({ status: "ok" });
}
