/** Portal finance approval status labels (Phase 1). */

export const FINANCE_APPROVAL_STATUS = {
  DRAFT: "Draft",
  PENDING_FM: "Pending FM",
  PENDING_CFO: "Pending CFO",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT_BACK: "Sent Back",
};

// approvalStatus.js
export const APPROVAL_STATUS = {
  SENT_BACK: 'Sent Back',
  REJECTED: 'Rejected',
  PENDING_CFO: 'Pending CFO',
  APPROVED: 'Approved',
};

const STATUS_TONE = {
  [FINANCE_APPROVAL_STATUS.DRAFT]: "muted",
  [FINANCE_APPROVAL_STATUS.PENDING_FM]: "warning",
  [FINANCE_APPROVAL_STATUS.PENDING_CFO]: "warning",
  [FINANCE_APPROVAL_STATUS.APPROVED]: "success",
  [FINANCE_APPROVAL_STATUS.REJECTED]: "danger",
  [FINANCE_APPROVAL_STATUS.SENT_BACK]: "danger",
};

export function formatApprovalStatus(status) {
  const value = (status || "").trim();
  if (!value) return FINANCE_APPROVAL_STATUS.DRAFT;
  return value;
}

export function approvalStatusTone(status) {
  return STATUS_TONE[formatApprovalStatus(status)] || "muted";
}

export function approvalStatusLabel(status, { pendingCfoApproval = false } = {}) {
  if (status) return formatApprovalStatus(status);
  if (pendingCfoApproval) return FINANCE_APPROVAL_STATUS.PENDING_CFO;
  return FINANCE_APPROVAL_STATUS.DRAFT;
}
