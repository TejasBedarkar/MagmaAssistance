import {
  apiLogin,
  apiLogout,
  callMethod,
  callMethodGet,
  getCsrfToken,
  setCsrfToken,
} from "../../../common/api/client.js";

/**
 * Sales module API transport — uses portal common/client (fetch + shared CSRF).
 * Dev: empty base URL (Vite proxy). Prod: VITE_SITE_ORIGIN.
 */
export const FRAPPE_BASE_URL = import.meta.env.DEV
  ? ""
  : (import.meta.env.VITE_SITE_ORIGIN || import.meta.env.VITE_FRAPPE_URL || "");

export function toMethodPath(pathOrMethod) {
  return String(pathOrMethod || "").replace(/^\/api\/method\//, "");
}

/** Build Frappe method path with optional GET query string. */
export function toMethodGetUrl(pathOrMethod, params = {}) {
  const method = toMethodPath(pathOrMethod);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${method}?${query}` : method;
}

function payloadFromPostData(data) {
  const payload = {};
  if (data instanceof URLSearchParams) {
    data.forEach((value, key) => {
      if (value != null && value !== "") payload[key] = value;
    });
    return payload;
  }
  if (data && typeof data === "object") {
    Object.entries(data).forEach(([key, value]) => {
      if (value != null && value !== "") payload[key] = String(value);
    });
  }
  return payload;
}

function toAxiosError(err, url = "", method = "GET") {
  if (err?.response) return err;
  const message = err?.message || "Request failed";
  const axiosLike = new Error(message);
  axiosLike.response = {
    data: {
      message,
      exception: message,
    },
  };
  axiosLike.config = { url, method };
  return axiosLike;
}

export function unwrapMessage(res, fallback = null) {
  const payload = res?.data?.message;
  return payload == null ? fallback : payload;
}

export function toFriendlyError(err, fallback = "Something went wrong. Please try again.") {
  if (!err?.response && typeof err?.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  const data = err?.response?.data;
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof data?.exception === "string" && data.exception.trim()) return data.exception.trim();
  if (data?._server_messages) {
    try {
      const raw = JSON.parse(data._server_messages);
      const rows = (Array.isArray(raw) ? raw : [raw])
        .map((entry) => {
          const parsed = typeof entry === "string" ? JSON.parse(entry) : entry;
          return parsed?.message || String(entry || "");
        })
        .filter(Boolean);
      if (rows.length) return rows.join(" | ");
    } catch {
      // ignore parse errors
    }
  }
  if (err?.message) return String(err.message);
  return fallback;
}

/** Client-side cap so list pages never spin forever when proxy/bench is unreachable. */
export const SALES_API_TIMEOUT_MS = 90_000;

export function withSalesTimeout(
  promise,
  timeoutMs = SALES_API_TIMEOUT_MS,
  timeoutMessage,
) {
  const ms = timeoutMs > 0 ? timeoutMs : SALES_API_TIMEOUT_MS;
  const msg =
    timeoutMessage ||
    `Request timed out after ${Math.round(ms / 1000)}s. Is bench running? Check VITE_PROXY_TARGET in erp-portal-frontend/.env and restart npm run dev.`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

let prefetchPromise = null;

/** Warm CSRF for upcoming POSTs without blocking GET list loads. */
export function prefetchCsrfInBackground() {
  void prefetchCsrf().catch(() => "");
}

export function prefetchCsrf(opts = {}) {
  const force = opts.force === true;
  if (force) {
    prefetchPromise = null;
    setCsrfToken(null);
  }
  if (!prefetchPromise) {
    prefetchPromise = callMethodGet("sales_app.api.session.get_csrf_token")
      .then((token) => {
        const csrf = token != null ? String(token) : "";
        if (csrf) setCsrfToken(csrf);
        else prefetchPromise = null;
        return csrf;
      })
      .catch(() => {
        setCsrfToken(null);
        prefetchPromise = null;
        return "";
      });
  }
  return prefetchPromise;
}

export async function getLoggedUser() {
  try {
    const user = await callMethodGet("sales_app.api.session.get_session_user");
    return typeof user === "string" ? user : user != null ? String(user) : "Guest";
  } catch {
    return "Guest";
  }
}

export async function loginWithPassword(usr, pwd) {
  try {
    const data = await apiLogin(usr, pwd);
    prefetchPromise = null;
    await prefetchCsrf().catch(() => "");
    return { data };
  } catch (err) {
    throw toAxiosError(err, "/api/method/login", "POST");
  }
}

export async function logoutSession() {
  try {
    await apiLogout();
  } catch {
    // ignore
  } finally {
    setCsrfToken(null);
    prefetchPromise = null;
  }
}

async function ensureCsrfForPost() {
  if (!getCsrfToken()) {
    await prefetchCsrf().catch(() => "");
  }
  if (!getCsrfToken()) {
    await prefetchCsrf({ force: true }).catch(() => "");
  }
}

/** GET whitelisted method — returns unwrapped Frappe message. */
export async function get(path, config = {}) {
  try {
    return await callMethodGet(toMethodGetUrl(path, config.params || {}));
  } catch (err) {
    throw toAxiosError(err, path, "GET");
  }
}

/** POST whitelisted method — returns unwrapped Frappe message. */
export async function post(path, payload = {}) {
  try {
    await ensureCsrfForPost();
    return await callMethod(toMethodPath(path), payloadFromPostData(payload));
  } catch (err) {
    throw toAxiosError(err, path, "POST");
  }
}

/** Axios-shaped GET — drop-in for pages using res.data.message. */
async function apiGet(path, config = {}) {
  try {
    const timeoutMs = config.timeout ?? SALES_API_TIMEOUT_MS;
    const message = await withSalesTimeout(
      callMethodGet(toMethodGetUrl(path, config.params || {})),
      timeoutMs,
      config.timeoutMessage,
    );
    return { data: { message } };
  } catch (err) {
    throw toAxiosError(err, path, "GET");
  }
}

/** Axios-shaped POST — accepts URLSearchParams or plain object. */
async function apiPost(path, data, _config = {}) {
  try {
    await ensureCsrfForPost();
    const message = await callMethod(toMethodPath(path), payloadFromPostData(data));
    return { data: { message } };
  } catch (err) {
    throw toAxiosError(err, path, "POST");
  }
}

/** Default export — axios-compatible client for existing sales pages. */
const api = {
  get: apiGet,
  post: apiPost,
};

export default api;
