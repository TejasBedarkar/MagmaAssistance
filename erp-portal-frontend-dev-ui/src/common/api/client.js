/**
 * Frappe REST + RPC client for the PM portal.
 * Dev: rely on Vite proxy so requests are same-origin and session cookies apply.
 * Prod: set VITE_SITE_ORIGIN to your Frappe site URL (must enable CORS + credentials if cross-origin).
 */

let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

function apiBase() {
  return import.meta.env.VITE_SITE_ORIGIN || "";
}

function parseServerError(data) {
  if (!data) return "Request failed";
  if (typeof data.message === "string" && data.message) return data.message;
  if (data.exc_type && data.exception) {
    const raw = String(data.exception);
    const cleaned = raw
      .replace(/^frappe\.exceptions\.\w+:\s*/i, "")
      .replace(/^ValidationError:\s*/i, "")
      .trim();
    return cleaned || raw;
  }
  if (data._server_messages) {
    try {
      const arr = JSON.parse(data._server_messages);
      const first = arr[0];
      if (typeof first === "string") {
        const inner = JSON.parse(first);
        return inner.message || first;
      }
    } catch {
      /* ignore */
    }
  }
  return data.exception || "Request failed";
}

export async function apiLogin(usr, pwd) {
  const body = new URLSearchParams({ usr, pwd });
  const r = await fetch(`${apiBase()}/api/method/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    credentials: "include",
    body,
  });
  let j = {};
  const text = await r.text();
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    if (r.status === 502 || r.status === 503) {
      throw new Error(
        "Cannot reach Frappe. Is bench running? Check VITE_PROXY_TARGET (usually http://127.0.0.1:8001 in .env)."
      );
    }
    throw new Error(text?.slice(0, 200) || `Login failed (HTTP ${r.status})`);
  }
  if (!r.ok || j.exc_type) {
    const msg = parseServerError(j);
    if (r.status === 401 || j.exc_type === "AuthenticationError") {
      throw new Error(msg || "Invalid email or password");
    }
    if (r.status >= 500) {
      throw new Error(
        `${msg} (HTTP ${r.status}). If bench is on another port, set VITE_PROXY_TARGET in erp-portal/.env and restart npm run dev.`
      );
    }
    throw new Error(msg);
  }
  if (j.message === "Password Reset") {
    throw new Error("Password reset required. Complete reset from Desk / website login.");
  }
  if (j.message !== "Logged In" && j.message !== "No App") {
    throw new Error(j.message || "Login incomplete (check 2FA or user type).");
  }
  return j;
}

function apiJsonHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
  };
}

/** Set a new password from welcome/reset email link (guest-safe). */
export async function apiUpdatePassword({ key, newPassword, logoutAllSessions = 1 }) {
  const r = await fetch(`${apiBase()}/api/method/frappe.core.doctype.user.user.update_password`, {
    method: "POST",
    credentials: "include",
    headers: apiJsonHeaders(),
    body: JSON.stringify({
      key,
      new_password: newPassword,
      logout_all_sessions: logoutAllSessions ? 1 : 0,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 410 || j.exc_type) {
    throw new Error(parseServerError(j) || "This password link is invalid or has expired.");
  }
  if (!r.ok) {
    throw new Error(parseServerError(j));
  }
  return j.message;
}

/** Password strength check for set-password page (guest-safe when key is present). */
export async function apiTestPasswordStrength(newPassword, key) {
  const r = await fetch(`${apiBase()}/api/method/frappe.core.doctype.user.user.test_password_strength`, {
    method: "POST",
    credentials: "include",
    headers: apiJsonHeaders(),
    body: JSON.stringify({ new_password: newPassword, key }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.message || {};
}

/** Request password reset email (guest-safe, no session required). */
export async function apiResetPassword(user) {
  const r = await fetch(`${apiBase()}/api/method/frappe.core.doctype.user.user.reset_password`, {
    method: "POST",
    credentials: "include",
    headers: apiJsonHeaders(),
    body: JSON.stringify({ user: (user || "").trim() }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  if (j._server_messages) {
    try {
      const arr = JSON.parse(j._server_messages);
      for (const item of arr) {
        const inner = typeof item === "string" ? JSON.parse(item) : item;
        if (inner?.message) return inner.message;
      }
    } catch {
      /* ignore */
    }
  }
  return (
    j.message ||
    "If this email is registered with us, we have sent password reset instructions to it. Please check your inbox."
  );
}

export async function apiLogout() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
  };
  await fetch(`${apiBase()}/api/method/logout`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({}),
  });
  csrfToken = null;
}

/** GET whitelisted method — no CSRF header required */
export async function callMethodGet(method, args = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  const url = qs
    ? `${apiBase()}/api/method/${method}?${qs}`
    : `${apiBase()}/api/method/${method}`;
  let r;
  try {
    r = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    const msg = e?.message === "Failed to fetch"
      ? "Cannot reach Frappe. Is bench running? Check VITE_PROXY_TARGET in erp-portal/.env and restart npm run dev."
      : e?.message || "Request failed";
    throw new Error(msg);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.message;
}

export async function callMethod(method, args = {}) {
  const r = await fetch(`${apiBase()}/api/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.message;
}

export async function getList(doctype, options = {}) {
  const qs = new URLSearchParams();
  if (options.fields) qs.set("fields", JSON.stringify(options.fields));
  if (options.filters) qs.set("filters", JSON.stringify(options.filters));
  if (options.order_by) qs.set("order_by", options.order_by);
  qs.set("limit_page_length", String(options.limit_page_length ?? 200));
  if (options.limit_start != null) {
    qs.set("limit_start", String(options.limit_start));
  }
  const r = await fetch(`${apiBase()}/api/resource/${encodeURIComponent(doctype)}?${qs}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.data || [];
}

export async function getDoc(doctype, name) {
  const r = await fetch(
    `${apiBase()}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { credentials: "include", headers: { Accept: "application/json" } }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.data;
}

export async function insertDoc(doctype, doc) {
  const r = await fetch(`${apiBase()}/api/resource/${encodeURIComponent(doctype)}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(doc),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.data;
}

export async function updateDoc(doctype, name, doc) {
  const r = await fetch(
    `${apiBase()}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
      },
      body: JSON.stringify(doc),
    }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.exc_type) {
    throw new Error(parseServerError(j));
  }
  return j.data;
}

export async function deleteDoc(doctype, name) {
  const r = await fetch(
    `${apiBase()}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(csrfToken ? { "X-Frappe-CSRF-Token": csrfToken } : {}),
      },
    }
  );
  if (r.status === 202 || r.status === 200) return true;
  const j = await r.json().catch(() => ({}));
  throw new Error(parseServerError(j));
}
