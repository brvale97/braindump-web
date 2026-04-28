let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function parseResponse(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });

  if (response.status === 401 && onUnauthorized && path !== "/api/auth" && path !== "/api/auth/session") {
    onUnauthorized();
  }

  const data = await parseResponse(response);
  if (!response.ok && typeof data === "object" && data?.error) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(typeof data === "string" ? data : "Request mislukt");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function login(pin) {
  return apiFetch("/api/auth", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export function getSession() {
  return apiFetch("/api/auth/session");
}

export function logout() {
  return apiFetch("/api/auth/logout", { method: "POST" });
}
