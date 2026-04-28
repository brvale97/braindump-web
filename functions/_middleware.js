import { readSessionFromRequest } from "./lib/session.js";

const PUBLIC_API_PATHS = new Set([
  "/api/auth",
  "/api/auth/session",
  "/api/auth/logout",
]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/") || PUBLIC_API_PATHS.has(url.pathname)) {
    return next();
  }

  const session = await readSessionFromRequest(request, context.env);
  if (!session) {
    return Response.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  context.data = context.data || {};
  context.data.user = session.role;
  context.data.session = session;

  return next();
}
