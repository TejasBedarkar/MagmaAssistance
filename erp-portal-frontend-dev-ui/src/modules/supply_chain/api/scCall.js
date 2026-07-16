import toast from "react-hot-toast";
import { callMethod, callMethodGet } from "../../../common/api/client.js";

export async function scCall(method, args = {}, options = {}) {
  try {
    return await callMethod(method, args);
  } catch (err) {
    if (!options.silent) toast.error(err.message || "Request failed");
    throw err;
  }
}

export async function scCallGet(method, args = {}, options = {}) {
  try {
    return await callMethodGet(method, args);
  } catch (err) {
    if (!options.silent) toast.error(err.message || "Request failed");
    throw err;
  }
}
