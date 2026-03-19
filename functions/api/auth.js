export async function onRequestPost(context) {
  const { env } = context;

  try {
    const { pin } = await context.request.json();
    if (!pin) {
      return Response.json({ error: "PIN is vereist" }, { status: 400 });
    }

    // Hash the provided PIN and compare with stored hashes
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Determine role based on which PIN matches
    let role = null;
    if (hashHex === env.PIN_HASH) {
      role = "bram";
    } else if (env.ANNA_PIN_HASH && hashHex === env.ANNA_PIN_HASH) {
      role = "anna";
    }

    if (!role) {
      return Response.json({ error: "Ongeldige PIN" }, { status: 401 });
    }

    // Generate session token: random bytes + expiry timestamp (24h) + role
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const tokenData = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Sign the token with SESSION_SECRET (role is included in signature)
    const payload = `${tokenData}.${expiry}.${role}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const token = `${payload}.${sigHex}`;

    return Response.json({ token, expiry, role });
  } catch (e) {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
