import ActionIconTip from "../../../common/components/ActionIconTip.jsx";
import ApprovalResubmitButton from "../components/ApprovalResubmitButton.jsx";
import FinanceViewAction from "../components/FinanceViewAction.jsx";
import { ApprovalStatusBadge } from "../components/ApprovalStatusBadge.jsx";
import { approvalRowNote, canShowResubmit } from "./approvalListUi.js";

/** Shared list-table columns for portal approval status, notes, and resubmit. */
export function buildApprovalListColumns({ doctype, user, onResubmitSuccess, showToast }) {
  return [
    {
      key: "portal_approval_status",
      label: "Approval status",
      cellClassName: "finance-approval-status-cell",
      render: (row) => (
        <ApprovalStatusBadge
          status={row.portal_approval_status}
          pendingCfoApproval={row.pending_cfo_approval}
        />
      ),
    },
    {
      key: "rejection_reason",
      label: "Reason",
      cellClassName: "finance-approval-note-cell",
      render: (row) => {
        const note = approvalRowNote(row);
        if (!note) return <span className="finance-cell-muted">—</span>;
        return (
          <ActionIconTip label={note}>
            <span className="finance-approval-note-text">{note}</span>
          </ActionIconTip>
        );
      },
    },
    {
      key: "row_actions",
      label: "Actions",
      align: "right",
      cellClassName: "finance-row-actions-cell",
      render: (row) => (
        <div className="finance-row-actions">
          {canShowResubmit(row, user) ? (
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <ApprovalResubmitButton
                doctype={doctype}
                name={row.name}
                onSuccess={onResubmitSuccess}
                showToast={showToast}
              />
            </div>
          ) : null}
          <FinanceViewAction />
        </div>
      ),
    },
  ];
}
