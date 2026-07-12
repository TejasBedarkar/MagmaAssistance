import { approvalStatusLabel, approvalStatusTone } from "../lib/approvalStatus.js";

export function ApprovalStatusBadge({ status, pendingCfoApproval = false, className = "" }) {
  const label = approvalStatusLabel(status, { pendingCfoApproval });
  const tone = approvalStatusTone(label);
  return (
    <span className={`finance-approval-badge finance-approval-badge--${tone}${className ? ` ${className}` : ""}`}>
      {label}
    </span>
  );
}
export default ApprovalStatusBadge;