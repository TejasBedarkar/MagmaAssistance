import toast from "react-hot-toast";
import { callMethod, callMethodGet } from "../../../common/api/client.js";

/** Frappe whitelist namespace for the PM portal. */
export const PM_API = "project_management.api";

/**
 * Build GET method path with optional query string.
 * @param {string} method
 * @param {Record<string, string|number|undefined|null>} [params]
 */
export function pmMethodGetUrl(method, params = {}) {
	const base = method.startsWith(PM_API) ? method : `${PM_API}.${method}`;
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") {
			search.set(key, String(value));
		}
	}
	const query = search.toString();
	return query ? `${base}?${query}` : base;
}

/**
 * POST whitelisted method with optional error toast.
 * @param {string} method
 * @param {object} [args]
 * @param {{ silent?: boolean }} [options]
 */
export async function pmCall(method, args = {}, options = {}) {
	const path = method.startsWith(PM_API) ? method : `${PM_API}.${method}`;
	try {
		return await callMethod(path, args);
	} catch (err) {
		if (!options.silent) {
			toast.error(err.message || "Request failed");
		}
		throw err;
	}
}

/** GET whitelisted method — no CSRF required */
export async function pmCallGet(methodOrUrl, options = {}) {
	try {
		return await callMethodGet(methodOrUrl);
	} catch (err) {
		if (!options.silent) {
			toast.error(err.message || "Request failed");
		}
		throw err;
	}
}
