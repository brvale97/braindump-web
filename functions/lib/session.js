export const SESSION_COOKIE = "braindump_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
}

async function importSessionKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function parseCookieHeader(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [name, ...rest] = pair.split("=");
      acc[name] = rest.join("=");
      return acc;
    }, {});
}

export async function createSessionToken(env, role, { expiry = Date.now() + SESSION_MAX_AGE_MS } = {}) {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const tokenData = bytesToHex(randomBytes);
  const payload = `${tokenData}.${expiry}.${role}`;
  const key = await importSessionKey(env.SESSION_SECRET);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return {
    token: `${payload}.${bytesToHex(new Uint8Array(signature))}`,
    expiry,
    role,
  };
}

export async function verifySessionToken(env, token) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 4 && parts.length !== 3) return null;

  let payload;
  let role;
  let expiry;
  let sigHex;

  if (parts.length === 4) {
    const [tokenData, expiryStr, tokenRole, signature] = parts;
    payload = `${tokenData}.${expiryStr}.${tokenRole}`;
    role = tokenRole;
    expiry = Number.parseInt(expiryStr, 10);
    sigHex = signature;
  } else {
    const [tokenData, expiryStr, signature] = parts;
    payload = `${tokenData}.${expiryStr}`;
    role = "bram";
    expiry = Number.parseInt(expiryStr, 10);
    sigHex = signature;
  }

  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;

  try {
    const key = await importSessionKey(env.SESSION_SECRET);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      hexToBytes(sigHex),
      new TextEncoder().encode(payload)
    );

    if (!valid) return null;
    return { role, expiry, token };
  } catch {
    return null;
  }
}

export async function readSessionFromRequest(request, env) {
  const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
  const cookieSession = cookies[SESSION_COOKIE];
  if (cookieSession) {
    const session = await verifySessionToken(env, cookieSession);
    if (session) return session;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return verifySessionToken(env, authHeader.slice(7));
}

export function serializeSessionCookie(token, requestUrl, expiry) {
  const url = new URL(requestUrl);
  const secure = url.protocol === "https:";
  const maxAge = Math.max(0, Math.floor((expiry - Date.now()) / 1000));

  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(requestUrl) {
  const url = new URL(requestUrl);
  const secure = url.protocol === "https:";
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]
    .filter(Boolean)
    .join("; ");
}
