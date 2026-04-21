// Middleware that validates auth token on all /api/* routes except /api/auth
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Skip auth check for public endpoints, webhook receiver, image proxy, and static files
  if (
    url.pathname === "/api/auth" ||
    url.pathname === "/api/image" ||
    !url.pathname.startsWith("/api/")
  ) {
    return next();
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const parts = token.split(".");

  // Support both old 3-part tokens and new 4-part tokens (with role)
  if (parts.length !== 3 && parts.length !== 4) {
    return Response.json({ error: "Ongeldig token" }, { status: 401 });
  }

  let tokenData, expiryStr, role, sigHex, payload;

  if (parts.length === 4) {
    [tokenData, expiryStr, role, sigHex] = parts;
    payload = `${tokenData}.${expiryStr}.${role}`;
  } else {
    // Legacy 3-part token (always bram)
    [tokenData, expiryStr, sigHex] = parts;
    role = "bram";
    payload = `${tokenData}.${expiryStr}`;
  }

  const expiry = parseInt(expiryStr, 10);

  // Check expiry
  if (Date.now() > expiry) {
    return Response.json({ error: "Token verlopen" }, { status: 401 });
  }

  // Verify signature
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Convert hex signature back to ArrayBuffer
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map((byte) => parseInt(byte, 16)));

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payload));
    if (!valid) {
      return Response.json({ error: "Ongeldig token" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "Token verificatie mislukt" }, { status: 401 });
  }

  // Store role in context for downstream handlers
  context.data = context.data || {};
  context.data.user = role;

  return next();
}
