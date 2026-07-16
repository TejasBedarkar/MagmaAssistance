/** Base path for manufacturing routes inside ERP Portal. */
export const MFG_BASE = "/manufacturing";

/** Build a portal path under /manufacturing (e.g. mfgPath('/work-orders/new')). */
export function mfgPath(subpath = "") {
  if (!subpath || subpath === "/") return MFG_BASE;
  const segment = subpath.startsWith("/") ? subpath : `/${subpath}`;
  return `${MFG_BASE}${segment}`;
}
