import ApprovalResubmitButton from "./ApprovalResubmitButton.jsx";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge.jsx";
import { approvalRowNote, canShowResubmit } from "../lib/approvalListUi.js";

/** Approval status, rejection note, and resubmit on document detail views. */
export default function ApprovalDetailPanel({ doctype, row, user, onResubmitSuccess, showToast }) {
  if (!row) return null;

  const status = row.portal_approval_status;
  const note = approvalRowNote(row);
  const showResubmit = canShowResubmit(row, user);

  if (!status && !note && !showResubmit) return null;

  return (
    <div className="finance-approval-detail">
      <div className="finance-approval-detail__header">
        {status ? (
          <ApprovalStatusBadge
            status={status}
            pendingCfoApproval={row.pending_cfo_approval}
          />
        ) : null}
        {showResubmit ? (
          <ApprovalResubmitButton
            doctype={doctype}
            name={row.name}
            onSuccess={onResubmitSuccess}
            showToast={showToast}
          />
        ) : null}
      </div>
      {note ? <div className="finance-approval-detail__note">{note}</div> : null}
    </div>
  );
}
