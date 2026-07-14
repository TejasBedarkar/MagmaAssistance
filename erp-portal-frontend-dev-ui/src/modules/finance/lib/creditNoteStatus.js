/** Credit note & refund status labels and tones (Figma-aligned). */

import { FINANCE_APPROVAL_STATUS } from "./approvalStatus.js";

export const CREDIT_NOTE_LIST_STATUSES = [
  "Approved",
  "Pending Approval",
  "Rejected",
  "Sent Back",
  "Cancelled",
];

export const CREDIT_NOTE_REFUND_FIELD_STATUSES = [
  "Pending",
  "Completed",
  "Credit Balance",
  "Not Required",
];

/** Credit note list / detail approval badge. */
export function creditNoteApprovalStatus(row) {
  const docstatus = Number(row?.docstatus ?? 0);
  const portal = (row?.portal_approval_status || "").trim();

  if (docstatus === 2) {
    return { label: "Cancelled", tone: "muted" };
  }
  if (portal === FINANCE_APPROVAL_STATUS.REJECTED) {
    return { label: "Rejected", tone: "danger" };
  }
  if (portal === FINANCE_APPROVAL_STATUS.SENT_BACK) {
    return { label: "Sent Back", tone: "danger" };
  }
  if (docstatus === 1 || portal === FINANCE_APPROVAL_STATUS.APPROVED) {
    return { label: "Approved", tone: "success" };
  }
  if (
    row?.pending_cfo_approval ||
    portal === FINANCE_APPROVAL_STATUS.PENDING_FM ||
    portal === FINANCE_APPROVAL_STATUS.PENDING_CFO ||
    portal.includes("Pending")
  ) {
    return { label: "Pending Approval", tone: "warning" };
  }
  return { label: "Pending Approval", tone: "warning" };
}

/** Refund status stored on the credit note (custom_refund_status). */
export function creditNoteRefundFieldStatus(status) {
  const value = (status || "").trim();
  const map = {
    Pending: { label: "Pending", tone: "warning" },
    Completed: { label: "Completed", tone: "success" },
    "Credit Balance": { label: "Credit Balance", tone: "info" },
    "Not Required": { label: "Not Required", tone: "muted" },
  };
  return map[value] || { label: value || "—", tone: "muted" };
}

/** Refund request tracking table statuses. */
export function refundTrackingStatus(status) {
  const value = (status || "").trim();
  const map = {
    Processed: { label: "Processed", tone: "success" },
    "In Progress": { label: "In Progress", tone: "warning" },
    "Pending Approval": { label: "Pending Approval", tone: "warning" },
    "Awaiting Refund": { label: "Awaiting Refund", tone: "warning" },
  };
  return map[value] || { label: value || "—", tone: "muted" };
}
