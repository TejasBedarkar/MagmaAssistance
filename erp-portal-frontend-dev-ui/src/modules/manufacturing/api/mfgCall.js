import toast from "react-hot-toast";
import { callMethod, callMethodGet } from "../../../common/api/client.js";

/**
 * Manufacturing API helper — portal common client + optional error toast (parity with old client.js).
 * @param {string} method
 * @param {object} [args]
 * @param {{ silent?: boolean }} [options]
 */
export async function mfgCall(method, args = {}, options = {}) {
  try {
    return await callMethod(method, args);
  } catch (err) {
    if (!options.silent) {
      toast.error(err.message || "Request failed");
    }
    throw err;
  }
}

/** GET whitelisted method — no CSRF required */
export async function mfgCallGet(method, args = {}, options = {}) {
  try {
    return await callMethodGet(method, args);
  } catch (err) {
    if (!options.silent) {
      toast.error(err.message || "Request failed");
    }
    throw err;
  }
}
