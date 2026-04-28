import { createSessionToken, serializeSessionCookie } from "../lib/session.js";

async function hashPin(pin) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost(context) {
  try {
    const { pin } = await context.request.json();
    if (!pin) {
      return Response.json({ error: "PIN is vereist" }, { status: 400 });
    }

    const hashHex = await hashPin(pin);
    let role = null;

    if (hashHex === context.env.PIN_HASH) {
      role = "bram";
    } else if (context.env.ANNA_PIN_HASH && hashHex === context.env.ANNA_PIN_HASH) {
      role = "anna";
    }

    if (!role) {
      return Response.json({ error: "Ongeldige PIN" }, { status: 401 });
    }

    const session = await createSessionToken(context.env, role);
    return Response.json(
      { ok: true, role: session.role, expiry: session.expiry },
      {
        headers: {
          "Set-Cookie": serializeSessionCookie(session.token, context.request.url, session.expiry),
        },
      }
    );
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
