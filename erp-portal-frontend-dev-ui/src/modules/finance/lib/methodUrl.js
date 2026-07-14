import { callMethod } from "../../../common/api/client.js";

/** Build Frappe method path with optional GET query string. */
export function toMethodGetUrl(method, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${method}?${query}` : method;
}

/** POST whitelisted method with a client-side timeout (document chain creates). */
export function callMethodWithTimeout(method, args = {}, timeoutMs = 120000) {
  return Promise.race([
    callMethod(method, args),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("request failed")), timeoutMs);
    }),
  ]);
}
