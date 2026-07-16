/** Map finance domain values to shared StatusPill tones. */

export function docStatusLabel(docstatus) {
  return docstatus === 1 ? "Submitted" : "Draft";
}

export function docStatusTone(docstatus) {
  return docstatus === 1 ? "success" : "default";
}

export function paymentTypeTone(type) {
  const map = {
    Receive: "success",
    Pay: "danger",
    "Internal Transfer": "info",
  };
  return map[type] || "default";
}

export function paymentTypeLabel(type) {
  const icons = { Receive: "↓", Pay: "↑", "Internal Transfer": "↔" };
  const icon = icons[type] || "•";
  return `${icon} ${type || "—"}`;
}

export function reconciliationStatusTone(status) {
  const map = {
    Reconciled: "success",
    Unreconciled: "warn",
    Pending: "info",
    Settled: "success",
    Cancelled: "default",
  };
  return map[status] || "default";
}

export function assetStatusTone(status) {
  const map = {
    Draft: "default",
    Submitted: "info",
    "In Use": "success",
    "Fully Depreciated": "warn",
    Scrapped: "danger",
    Sold: "info",
  };
  return map[status] || "default";
}

export function accentClassToTone(accentClass = "") {
  if (accentClass.includes("--success")) return "success";
  if (accentClass.includes("--danger")) return "danger";
  if (accentClass.includes("--warning") || accentClass.includes("--warn")) return "warn";
  if (accentClass.includes("--accent")) return "default";
  return "default";
}
