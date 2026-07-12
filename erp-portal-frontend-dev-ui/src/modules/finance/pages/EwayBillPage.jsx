import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import FinanceDataTable from "../components/FinanceDataTable.jsx";
import FinanceDocumentHistory, { FinanceAuditHint } from "../components/FinanceDocumentHistory.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";

export default function EwayBillPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [historyWorkOrder, setHistoryWorkOrder] = useState(null);
  const { showToast } = useFinanceToast(5000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callMethodGet(
        toMethodGetUrl("finance_app.api.eway_bill.list_pending_eway_bills")
      );
      const items = data?.items || [];
      setRows(items);
      setDrafts((prev) => {
        const next = { ...prev };
        items.forEach((row) => {
          if (next[row.work_order] === undefined) next[row.work_order] = "";
        });
        return next;
      });
    } catch (e) {
      setRows([]);
      showToast({ ok: false, message: e.message || "Could not load pending e-way bills." });
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = useCallback(
    async (row) => {
      const ewayBillNo = (drafts[row.work_order] || "").trim();
      if (!ewayBillNo) {
        showToast({ ok: false, message: "Enter an e-way bill number." });
        return;
      }
      setSaving(row.work_order);
      try {
        const result = await callMethod("finance_app.api.eway_bill.save_eway_bill", {
          work_order: row.work_order,
          eway_bill_no: ewayBillNo,
          dispatch_note: row.dispatch_note || undefined,
        });
        showToast({ ok: true, message: result?.message || "E-way bill saved." });
        await load();
      } catch (e) {
        showToast({ ok: false, message: e.message || "Could not save e-way bill." });
      }
      setSaving(null);
    },
    [drafts, load, showToast]
  );

  const columns = useMemo(
    () => [
      {
        key: "work_order",
        label: "Work order",
        render: (row) => <span className="finance-cell-accent">{row.work_order}</span>,
      },
      {
        key: "customer_name",
        label: "Customer",
        render: (row) => row.customer_name || "—",
      },
      {
        key: "deliverable",
        label: "Item",
        render: (row) => row.deliverable || "—",
      },
      {
        key: "dispatch_note",
        label: "Dispatch note",
        render: (row) => row.dispatch_note || "Will create on save",
      },
      {
        key: "eway_bill_no",
        label: "E-way bill no.",
        render: (row) => (
          <input
            className="pm-input finance-eway-input-compact"
            placeholder="e.g. 123456789012"
            value={drafts[row.work_order] ?? ""}
            onChange={(e) =>
              setDrafts((prev) => ({ ...prev, [row.work_order]: e.target.value }))
            }
          />
        ),
      },
      {
        key: "latest_audit",
        label: "Last activity",
        render: (row) => <FinanceAuditHint audit={row.latest_audit} />,
      },
      {
        key: "history",
        label: "History",
        align: "right",
        render: (row) => (
          <button
            type="button"
            className="pm-btn pm-btn-ghost pm-btn-sm"
            onClick={() => setHistoryWorkOrder(row.work_order)}
          >
            View
          </button>
        ),
      },
      {
        key: "actions",
        label: "Actions",
        align: "right",
        render: (row) => (
          <button
            type="button"
            className="pm-btn pm-btn-primary pm-btn-sm"
            disabled={saving === row.work_order}
            onClick={() => onSave(row)}
          >
            {saving === row.work_order ? "Saving…" : "Save"}
          </button>
        ),
      },
    ],
    [drafts, onSave, saving]
  );

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader
        title="E-way bills"
        subtitle="Enter e-way bills after a Delivery Note is submitted for the linked Sales Order."
        action={
          <button type="button" className="pm-btn pm-btn-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
        }
      />

      {loading ? (
        <FinancePageLoader message="Loading pending e-way bills…" />
      ) : rows.length === 0 ? (
        <div className="pm-card finance-empty-card">
          <p className="finance-cell-muted">No work orders are waiting for an e-way bill.</p>
          <Link to="/finance" className="pm-btn pm-btn-sm finance-empty-card__link">
            Back to dashboard
          </Link>
        </div>
      ) : (
        <FinanceDataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.work_order}
        />
      )}

      {historyWorkOrder ? (
        <Modal
          wide
          title={`Activity — ${historyWorkOrder}`}
          onClose={() => setHistoryWorkOrder(null)}
        >
          <FinanceDocumentHistory
            doctype="MFG Work Order"
            name={historyWorkOrder}
            showToast={showToast}
          />
        </Modal>
      ) : null}
    </div>
  );
}
