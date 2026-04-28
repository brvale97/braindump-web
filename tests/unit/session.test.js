import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionToken,
  parseCookieHeader,
  serializeSessionCookie,
  verifySessionToken,
} from "../../functions/lib/session.js";

const env = { SESSION_SECRET: "test-secret" };

test("session tokens roundtrip via verifySessionToken", async () => {
  const session = await createSessionToken(env, "bram", { expiry: Date.now() + 60_000 });
  const verified = await verifySessionToken(env, session.token);
  assert.equal(verified.role, "bram");
  assert.equal(verified.expiry, session.expiry);
});

test("session cookie serialization includes httponly and samesite", () => {
  const header = serializeSessionCookie("abc", "https://example.com", Date.now() + 60_000);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
});

test("parseCookieHeader decodes multiple cookies", () => {
  const cookies = parseCookieHeader("a=1; braindump_session=token; theme=light");
  assert.equal(cookies.a, "1");
  assert.equal(cookies.braindump_session, "token");
  assert.equal(cookies.theme, "light");
});
