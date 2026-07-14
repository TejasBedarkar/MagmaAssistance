import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  HiOutlineArrowUturnLeft,
  HiOutlineCheck,
  HiOutlineXMark,
} from "react-icons/hi2";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import ActionIconTip from "../../../common/components/ActionIconTip.jsx";
import ApprovalActionModal from "../components/ApprovalActionModal.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import { ApprovalStatusBadge } from "../components/ApprovalStatusBadge.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import { FinanceAuditHint } from "../components/FinanceDocumentHistory.jsx";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import useFinanceToast from "../hooks/useFinanceToast.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const QUEUE_LABELS = {
  credit_refunds: "Credit notes & refunds",
  credit_notes: "Credit notes",
  refunds: "Customer refunds",
};

const ACTION_CONFIG = {
  reject: {
    title: "Reject document",
    confirmLabel: "Reject",
    confirmTone: "danger",
    method: "finance_app.api.approvals.reject_document",
    successFallback: "Document rejected.",
  },
  send_back: {
    title: "Send back to creator",
    confirmLabel: "Send back",
    confirmTone: "secondary",
    method: "finance_app.api.approvals.send_back_document",
    successFallback: "Document sent back.",
  },
};

export default function PendingApprovals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueFilter = searchParams.get("queue") || "";
  const doctypeFilter = searchParams.get("doctype") || "";
  const { isCfo, isFinanceManager } = useFinanceRole();
  const { showToast } = useFinanceToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState("");
  const [actionModal, setActionModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (queueFilter) params.set("queue", queueFilter);
      if (doctypeFilter) params.set("doctype", doctypeFilter);
      const query = params.toString();
      const url = query
        ? `finance_app.api.approvals.get_pending_approvals?${query}`
        : "finance_app.api.approvals.get_pending_approvals";
      const message = await callMethodGet(url);
      if (message?.status === "success") {
        setItems(message.items || []);
      } else {
        setItems([]);
        if (message?.message) {
          showToast({ type: "error", text: message.message });
        }
      }
    } catch (e) {
      setItems([]);
      showToast({ type: "error", text: e?.message || "Failed to load pending approvals." });
    }
    setLoading(false);
  }, [showToast, queueFilter, doctypeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const clearQueueFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("queue");
    next.delete("doctype");
    setSearchParams(next, { replace: true });
  };

  const queueLabel = QUEUE_LABELS[queueFilter] || (doctypeFilter ? doctypeFilter : "");

  const runAction = useCallback(
    async (row, { method, successFallback }) => {
      const key = `${row.doctype}:${row.name}`;
      setActionKey(key);
      try {
        const msg = await callMethod(method, {
          doctype: row.doctype,
          name: row.name,
        });
        if (msg?.status === "success") {
          showToast({ type: "success", text: msg.message || successFallback });
          load();
        } else {
          showToast({ type: "error", text: msg?.message || "Action failed." });
        }
      } catch (e) {
        showToast({ type: "error", text: e?.message || "Action failed." });
      }
      setActionKey("");
    },
    [load, showToast]
  );

  const handleApprove = useCallback(
    (row) =>
      runAction(row, {
        method: "finance_app.api.approvals.approve_document",
        successFallback: `${row.name} approved.`,
      }),
    [runAction]
  );

  const openActionModal = useCallback((type, row) => {
    setActionModal({ type, row });
  }, []);

  const closeActionModal = useCallback(() => {
    if (!actionKey) setActionModal(null);
  }, [actionKey]);

  const handleModalConfirm = useCallback(
    async (reason) => {
      if (!actionModal) return;
      const config = ACTION_CONFIG[actionModal.type];
      const row = actionModal.row;
      const key = `${row.doctype}:${row.name}`;
      setActionKey(key);
      try {
        const msg = await callMethod(config.method, {
          doctype: row.doctype,
          name: row.name,
          reason,
        });
        if (msg?.status === "success") {
          showToast({ type: "success", text: msg.message || config.successFallback });
          setActionModal(null);
          load();
        } else {
          showToast({ type: "error", text: msg?.message || "Action failed." });
        }
      } catch (e) {
        showToast({ type: "error", text: e?.message || "Action failed." });
      }
      setActionKey("");
    },
    [actionModal, load, showToast]
  );

  const columns = useMemo(
    () => [
      {
        key: "doctype",
        label: "Document",
        render: (row) => <span className="finance-cell-title">{row.doctype}</span>,
      },
      {
        key: "name",
        label: "ID",
        render: (row) => <span className="finance-party-label">{row.name}</span>,
      },
      {
        key: "party",
        label: "Party",
        render: (row) => row.party || "—",
      },
      {
        key: "amount",
        label: "Amount",
        align: "right",
        render: (row) => <span className="finance-cell-danger">{fmt(row.amount)}</span>,
      },
      {
        key: "approval_limit",
        label: "FM limit",
        align: "right",
        render: (row) => (row.approval_limit ? fmt(row.approval_limit) : "—"),
      },
      {
        key: "portal_approval_status",
        label: "Approval status",
        render: (row) => (
          <ApprovalStatusBadge
            status={row.portal_approval_status}
            pendingCfoApproval={row.pending_cfo_approval}
          />
        ),
      },
      {
        key: "current_approval_level",
        label: "Level",
        render: (row) => row.current_approval_level || "—",
      },
      {
        key: "posting_date",
        label: "Posting date",
        render: (row) => row.posting_date || "—",
      },
      {
        key: "owner",
        label: "Created by",
        render: (row) => row.owner || "—",
      },
      {
        key: "latest_audit",
        label: "Last activity",
        render: (row) => <FinanceAuditHint audit={row.latest_audit} />,
      },
      {
        key: "actions",
        label: "Actions",
        align: "right",
        render: (row) => {
          if (!isCfo) return null;
          const key = `${row.doctype}:${row.name}`;
          const busy = actionKey === key;
          const approveLabel = busy && !actionModal ? "Approving…" : "Approve document";
          return (
            <div className="finance-approval-actions">
              <ActionIconTip label="Send back to creator">
                <button
                  type="button"
                  className="finance-approval-act finance-approval-act--send-back"
                  disabled={busy}
                  aria-label="Send back to creator"
                  onClick={(e) => {
                    e.stopPropagation();
                    openActionModal("send_back", row);
                  }}
                >
                  <HiOutlineArrowUturnLeft size={14} aria-hidden />
                </button>
              </ActionIconTip>
              <ActionIconTip label="Reject document">
                <button
                  type="button"
                  className="finance-approval-act finance-approval-act--reject"
                  disabled={busy}
                  aria-label="Reject document"
                  onClick={(e) => {
                    e.stopPropagation();
                    openActionModal("reject", row);
                  }}
                >
                  <HiOutlineXMark size={14} aria-hidden />
                </button>
              </ActionIconTip>
              <ActionIconTip label={approveLabel}>
                <button
                  type="button"
                  className="finance-approval-act finance-approval-act--approve"
                  disabled={busy}
                  aria-label={approveLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApprove(row);
                  }}
                >
                  <HiOutlineCheck size={14} aria-hidden />
                </button>
              </ActionIconTip>
            </div>
          );
        },
      },
    ],
    [actionKey, actionModal, handleApprove, isCfo, openActionModal]
  );

  if (!isCfo && !isFinanceManager) {
    return (
      <div className="pm-page finance-page">
        <FinancePageHeader title="Pending approvals" />
        <p className="pm-field-hint">You do not have access to view pending approvals.</p>
      </div>
    );
  }

  const modalConfig = actionModal ? ACTION_CONFIG[actionModal.type] : null;

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader
        title="Pending approvals"
        description="Draft documents above Finance Manager approval limits — CFO approval required."
        note={
          isFinanceManager && !isCfo
            ? "Documents listed here require CFO approval before they are submitted."
            : null
        }
        noteTone="muted"
        actions={
          <button type="button" className="pm-btn pm-btn-secondary" onClick={load} disabled={loading}>
            Refresh
          </button>
        }
      >
        {queueLabel ? (
          <p className="finance-detail-sub finance-text-sm--flush">
            Filter: <strong>{queueLabel}</strong>
            {queueFilter === "credit_refunds" ? (
              <>
                {" · "}
                <Link to="/finance/credit-notes" className="finance-link">
                  Back to credit notes
                </Link>
              </>
            ) : null}
            {" · "}
            <button type="button" className="pm-btn pm-btn-ghost finance-queue-clear" onClick={clearQueueFilter}>
              Clear filter
            </button>
          </p>
        ) : null}
      </FinancePageHeader>

      {loading && !items.length ? (
        <FinancePageLoader message="Loading pending approvals…" />
      ) : (
        <FinanceDataTable
          columns={columns}
          rows={items}
          loading={loading}
          emptyMessage="No documents pending CFO approval."
          pageSize={FINANCE_LIST_PAGE_SIZE}
          getRowKey={(row) => `${row.doctype}:${row.name}`}
          className="finance-data-table--wide"
        />
      )}

      <ApprovalActionModal
        open={Boolean(actionModal && modalConfig)}
        title={modalConfig?.title || ""}
        confirmLabel={modalConfig?.confirmLabel || "Confirm"}
        confirmTone={modalConfig?.confirmTone || "primary"}
        busy={Boolean(actionKey)}
        onClose={closeActionModal}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}
