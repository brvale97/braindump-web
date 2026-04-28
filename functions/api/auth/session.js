import { readSessionFromRequest } from "../../lib/session.js";

export async function onRequestGet(context) {
  const session = await readSessionFromRequest(context.request, context.env);
  if (!session) {
    return Response.json({ authenticated: false, role: null, expiry: null });
  }

  return Response.json({
    authenticated: true,
    role: session.role,
    expiry: session.expiry,
  });
}
