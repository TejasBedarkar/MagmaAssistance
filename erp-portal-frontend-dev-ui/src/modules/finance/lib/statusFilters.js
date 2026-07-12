/** Preset status options for finance list filters (ERPNext workflow statuses). */

export const INVOICE_FILTER_STATUSES = [
  "Draft",
  "Unpaid",
  "Paid",
  "Overdue",
  "Partly Paid",
  "Partially Paid",
  "Return",
  "Credit Note Issued",
  "Cancelled",
];

/** Purchase invoice list filter — excludes Partly Paid / Return from dropdown. */
export const PURCHASE_INVOICE_FILTER_STATUSES = [
  "Draft",
  "Unpaid",
  "Paid",
  "Overdue",
  "Partially Paid",
  "Credit Note Issued",
  "Cancelled",
];

export const PURCHASE_INVOICE_EXCLUDED_FILTER_STATUSES = new Set([
  "Partly Paid",
  "Return",
]);

export const SALES_ORDER_FILTER_STATUSES = [
  "Draft",
  "To Deliver and Bill",
  "To Deliver",
  "To Bill",
  "Completed",
  "Cancelled",
];

export const PURCHASE_ORDER_FILTER_STATUSES = [
  "Draft",
  "To Receive and Bill",
  "To Receive",
  "To Bill",
  "Completed",
  "Cancelled",
];

export const ASSET_FILTER_STATUSES = [
  "Draft",
  "Submitted",
  "Partially Depreciated",
  "In Use",
  "Fully Depreciated",
  "Scrapped",
  "Sold",
];

export const DELIVERY_NOTE_FILTER_STATUSES = [
  "Draft",
  "To Bill",
  "Partly Billed",
  "Completed",
  "Cancelled",
];

export const PURCHASE_RECEIPT_FILTER_STATUSES = [
  "Draft",
  "To Bill",
  "Partly Billed",
  "Completed",
  "Cancelled",
];

export const CREDIT_NOTE_REFUND_STATUSES = [
  "Pending",
  "Completed",
  "Credit Balance",
  "Not Required",
];

export const REFUND_TRACKING_STATUSES = [
  "Processed",
  "In Progress",
  "Pending Approval",
  "Awaiting Refund",
];

export const CREDIT_NOTE_APPROVAL_FILTER_STATUSES = [
  "Approved",
  "Pending Approval",
  "Rejected",
  "Sent Back",
  "Cancelled",
];

/** Merge preset statuses with any values from loaded rows (no duplicates). */
export function mergeStatusOptions(preset, fromRows = []) {
  const seen = new Set();
  const out = [];
  for (const status of [...preset, ...fromRows.filter(Boolean)]) {
    if (!seen.has(status)) {
      seen.add(status);
      out.push(status);
    }
  }
  return out;
}
