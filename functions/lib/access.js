const SPACE_ACCESS = {
  personal: ["bram"],
  overview: ["bram"],
  gep: ["bram"],
  shared: ["bram", "anna"],
};

export function getRole(context) {
  return context?.data?.user || null;
}

export function canAccess(role, scope) {
  const allowed = SPACE_ACCESS[scope] || ["bram"];
  return !!role && allowed.includes(role);
}

export function guardScope(context, scope) {
  const role = getRole(context);
  if (!canAccess(role, scope)) {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  return null;
}
