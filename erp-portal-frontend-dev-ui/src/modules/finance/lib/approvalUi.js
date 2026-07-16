/** Submit button label when approval limits apply. */
export function approvalSubmitLabel({
  needsCfoApproval,
  isCfo,
  doctype,
  amount,
  defaultLabel,
  draftLabel = "Save for CFO approval",
}) {
  if (!isCfo && needsCfoApproval(doctype, amount)) {
    return draftLabel;
  }
  return defaultLabel;
}

/** Toast after create API — draft vs submitted. */
export function showApprovalCreateToast(showToast, msg, fallbackSuccess) {
  if (msg?.pending_cfo_approval) {
    const status = msg?.portal_approval_status ? ` (${msg.portal_approval_status})` : "";
    showToast({
      type: "warning",
      text: msg.message || `Saved as draft — pending CFO approval${status}.`,
    });
    return;
  }
  showToast({ type: "success", text: msg?.message || fallbackSuccess });
}
