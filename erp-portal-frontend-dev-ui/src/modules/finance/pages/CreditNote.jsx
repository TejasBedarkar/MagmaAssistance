import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ApprovalDetailPanel from "../components/ApprovalDetailPanel.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import CreditNoteStatusBadge from "../components/CreditNoteStatusBadge.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceDocumentHeader from "../components/FinanceDocumentHeader.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceItemsTable from "../components/FinanceItemsTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceSalesInvoiceDocument from "../components/FinanceSalesInvoiceDocument.jsx";
import FinanceTaxesSection from "../components/FinanceTaxesSection.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import ApprovalLimitNotice from "../components/ApprovalLimitNotice.jsx";
import { financeFmt } from "../lib/financeFmt.js";
import { downloadSalesInvoicePdf } from "../lib/financeSalesInvoicePdf.js";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { approvalSubmitLabel, showApprovalCreateToast } from "../lib/approvalUi.js";
import {
  creditNoteApprovalStatus,
  creditNoteRefundFieldStatus,
  refundTrackingStatus,
} from "../lib/creditNoteStatus.js";
import {
  CREDIT_NOTE_APPROVAL_FILTER_STATUSES,
  REFUND_TRACKING_STATUSES,
  mergeStatusOptions,
} from "../lib/statusFilters.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";

const fmt = financeFmt;

const EMPTY_FORM = {
  sales_invoice: "",
  return_reason: "Customer Return",
  return_request_ref: "",
  remarks: "",
  return_amount: "",
  items: [],
};

const EMPTY_REFUND_INIT = {
  credit_note: "",
  amount: "",
  mode: "Cash",
  reference_no: "",
};

export default function CreditNote() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { needsCfoApproval, isCfo, user } = useFinanceRole();
  const [rows, setRows] = useState([]);
  const [refundRows, setRefundRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refundLoading, setRefundLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cnStatusFilter, setCnStatusFilter] = useState("");
  const [refundSearch, setRefundSearch] = useState("");
  const [refundStatusFilter, setRefundStatusFilter] = useState("");
  const [summary, setSummary] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundableNotes, setRefundableNotes] = useState([]);
  const [opts, setOpts] = useState({
    sales_invoices: [],
    return_reasons: [],
    modes: [],
    items: [],
    schema: "standard",
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [refundInit, setRefundInit] = useState(EMPTY_REFUND_INIT);
  const [saving, setSaving] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);
  const [refundForm, setRefundForm] = useState({ amount: "", mode: "Cash", reference_no: "" });
  const [refunding, setRefunding] = useState(false);
  const [initiatingRefund, setInitiatingRefund] = useState(false);
  const { showToast } = useFinanceToast();

  const loadCreditNotes = useCallback(async () => {
    setLoading(true);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_credit_notes")
      );
      setRows(message || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  const loadRefundTracking = useCallback(async () => {
    setRefundLoading(true);
    try {
      const params = {};
      if (refundStatusFilter) params.status = refundStatusFilter;
      if (refundSearch.trim()) params.search = refundSearch.trim();
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_refund_tracking", params)
      );
      setRefundRows(message || []);
    } catch {
      /* ignore */
    }
    setRefundLoading(false);
  }, [refundSearch, refundStatusFilter]);

  const loadSummary = useCallback(async () => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_credit_notes_refunds_summary")
      );
      setSummary(message || null);
    } catch {
      setSummary(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadCreditNotes(), loadRefundTracking(), loadSummary()]);
  }, [loadCreditNotes, loadRefundTracking, loadSummary]);

  const loadRefundableNotes = useCallback(async () => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_refundable_credit_notes")
      );
      setRefundableNotes(message || []);
    } catch {
      setRefundableNotes([]);
    }
  }, []);

  const loadOpts = useCallback(async (salesInvoice) => {
    try {
      const params = salesInvoice ? { sales_invoice: salesInvoice } : {};
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_credit_note_options", params)
      );
      if (message) {
        setOpts((prev) => ({ ...prev, ...message }));
        if (salesInvoice && message.items?.length) {
          const first = message.items[0];
          setForm((prev) => ({
            ...prev,
            sales_invoice: salesInvoice,
            return_amount: String(first.max_amount ?? first.rate ?? first.amount ?? ""),
            items: message.items.map((it) => ({
              item_code: it.item_code,
              item_name: it.item_name,
              qty: it.max_qty || it.qty || 1,
              rate: it.rate,
              amount: it.max_amount ?? it.amount ?? it.rate,
            })),
          }));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCreditNotes();
    loadSummary();
    loadOpts();
  }, [loadCreditNotes, loadSummary, loadOpts]);

  useEffect(() => {
    loadRefundTracking();
  }, [loadRefundTracking]);

  useEffect(() => {
    const cn = searchParams.get("cn") || searchParams.get("si");
    if (cn) {
      viewDetail(cn);
    }
  }, [searchParams]);

  const viewDetail = async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.credit_note.get_credit_note", { name })
      );
      if (message?.name) {
        setViewDoc(message);
        setRefundForm({
          amount: String(message.refundable_amount || message.grand_total || ""),
          mode: opts.modes?.[0] || "Cash",
          reference_no: "",
        });
      }
    } catch (e) {
      showToast(e?.message || "Unable to load credit note.", "error");
    }
  };

  const closeDetail = () => {
    setViewDoc(null);
    const next = new URLSearchParams(searchParams);
    next.delete("cn");
    next.delete("si");
    setSearchParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (cnStatusFilter) {
        const { label } = creditNoteApprovalStatus(r);
        if (label !== cnStatusFilter) return false;
      }
      if (!q) return true;
      return [r.name, r.customer, r.return_against, r.return_request_ref]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, cnStatusFilter]);

  const cnFilterOptions = useMemo(
    () => [
      { value: "", label: "All status" },
      ...CREDIT_NOTE_APPROVAL_FILTER_STATUSES.map((status) => ({
        value: status,
        label: status,
      })),
    ],
    []
  );

  const creditNoteColumns = useMemo(
    () => [
      { key: "name", label: "CN No.", render: (r) => r.name },
      {
        key: "return_against",
        label: "Original Invoice",
        render: (r) =>
          r.return_against ? (
            <Link
              to={`/finance/sales-invoices?si=${encodeURIComponent(r.return_against)}`}
              className="finance-link"
              onClick={(e) => e.stopPropagation()}
            >
              {r.return_against}
            </Link>
          ) : (
            "—"
          ),
      },
      { key: "customer", label: "Customer" },
      { key: "amount", label: "Amount", align: "right", render: (r) => fmt(r.amount || r.grand_total) },
      { key: "posting_date", label: "Date" },
      {
        key: "status",
        label: "Status",
        render: (r) => {
          const { label, tone } = creditNoteApprovalStatus(r);
          return <CreditNoteStatusBadge label={label} tone={tone} />;
        },
      },
    ],
    []
  );

  const refundFilterOptions = useMemo(
    () => [
      { value: "", label: "All status" },
      ...mergeStatusOptions(REFUND_TRACKING_STATUSES, refundRows.map((r) => r.status)).map((status) => ({
        value: status,
        label: status,
      })),
    ],
    [refundRows]
  );

  const refundTrackingColumns = useMemo(
    () => [
      {
        key: "refund_id",
        label: "Refund ID",
        render: (r) =>
          r.refund_id ? (
            r.refund_id
          ) : r.credit_note ? (
            <span className="finance-cell-muted" title="Awaiting refund initiation">
              {r.credit_note}
            </span>
          ) : (
            "—"
          ),
      },
      { key: "customer", label: "Customer" },
      { key: "amount", label: "Amount", align: "right", render: (r) => fmt(r.amount) },
      { key: "request_date", label: "Request Date" },
      {
        key: "status",
        label: "Status",
        render: (r) => {
          const { label, tone } = refundTrackingStatus(r.status);
          return <CreditNoteStatusBadge label={label} tone={tone} />;
        },
      },
    ],
    []
  );

  const openRefundModal = () => {
    setRefundInit(EMPTY_REFUND_INIT);
    setShowRefundModal(true);
    loadRefundableNotes();
    if (!opts.modes?.length) loadOpts();
  };

  const onRefundCnSelect = (creditNoteName) => {
    const selected = refundableNotes.find((r) => r.name === creditNoteName);
    setRefundInit((prev) => ({
      ...prev,
      credit_note: creditNoteName,
      amount: selected ? String(selected.refundable_amount ?? selected.amount ?? "") : "",
      mode: opts.modes?.[0] || prev.mode || "Cash",
    }));
  };

  const handleCreate = async () => {
    if (!form.sales_invoice) {
      showToast("Select the original sales invoice.", "error");
      return;
    }
    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.credit_note.create_credit_note", {
        sales_invoice: form.sales_invoice,
        items: form.items,
        return_amount: form.return_amount || estimatedReturnTotal || undefined,
        return_reason: form.return_reason,
        return_request_ref: form.return_request_ref || undefined,
        remarks: form.remarks || undefined,
      });
      if (msg?.status === "success") {
        showApprovalCreateToast(showToast, msg, msg.message || `Credit Note ${msg.name} created.`);
        setShowForm(false);
        setForm(EMPTY_FORM);
        loadAll();
        if (msg.name) viewDetail(msg.name);
      } else {
        showToast(msg?.message || "Could not create credit note.", "error");
      }
    } catch (e) {
      showToast(e?.message || "Could not create credit note.", "error");
    }
    setSaving(false);
  };

  const submitRefund = async ({ credit_note, amount, mode, reference_no, onSuccess }) => {
    const msg = await callMethod("finance_app.api.credit_note.initiate_refund", {
      credit_note,
      amount,
      mode_of_payment: mode,
      reference_no: reference_no || undefined,
    });
    if (msg?.status === "success") {
      showApprovalCreateToast(showToast, msg, msg.message || "Refund recorded.");
      await loadAll();
      onSuccess?.(msg);
      return true;
    }
    showToast(msg?.message || "Refund failed.", "error");
    return false;
  };

  const handleRefund = async () => {
    if (!viewDoc?.name) return;
    setRefunding(true);
    try {
      await submitRefund({
        credit_note: viewDoc.name,
        amount: refundForm.amount,
        mode: refundForm.mode,
        reference_no: refundForm.reference_no,
        onSuccess: () => viewDetail(viewDoc.name),
      });
    } catch (e) {
      showToast(e?.message || "Refund failed.", "error");
    }
    setRefunding(false);
  };

  const handleInitiateRefund = async () => {
    if (!refundInit.credit_note) {
      showToast("Select a credit note.", "error");
      return;
    }
    setInitiatingRefund(true);
    try {
      const ok = await submitRefund({
        credit_note: refundInit.credit_note,
        amount: refundInit.amount,
        mode: refundInit.mode,
        reference_no: refundInit.reference_no,
        onSuccess: () => {
          setShowRefundModal(false);
          setRefundInit(EMPTY_REFUND_INIT);
        },
      });
      if (!ok) {
        /* toast shown in submitRefund */
      }
    } catch (e) {
      showToast(e?.message || "Refund failed.", "error");
    }
    setInitiatingRefund(false);
  };

  const handleCreditBalance = async () => {
    if (!viewDoc?.name) return;
    try {
      const msg = await callMethod("finance_app.api.credit_note.mark_credit_balance", {
        credit_note: viewDoc.name,
      });
      showToast(msg?.message || "Marked as credit balance.", "success");
      await viewDetail(viewDoc.name);
      loadAll();
    } catch (e) {
      showToast(e?.message || "Update failed.", "error");
    }
  };

  const isCustomSchema = opts.schema === "custom";

  const estimatedReturnTotal = useMemo(() => {
    if (isCustomSchema && form.return_amount !== "") {
      return Number(form.return_amount) || 0;
    }
    return (form.items || []).reduce(
      (sum, row) => sum + Number(row.qty || 0) * Number(row.rate || 0),
      0
    );
  }, [form.items, form.return_amount, isCustomSchema]);

  const cnSubmitLabel = approvalSubmitLabel({
    needsCfoApproval,
    isCfo,
    doctype: "Sales Invoice",
    amount: estimatedReturnTotal,
    defaultLabel: "Create & Submit",
  });

  const paymentModes = opts.modes?.length ? opts.modes : ["Cash", "Bank"];

  return (
    <div className="pm-page finance-page finance-cn-page">
      <header className="finance-cn-topbar">
        <div className="finance-cn-topbar__actions">
          <FinanceCan action="canCreate">
            <button
              type="button"
              className="pm-btn pm-btn-primary finance-cn-btn-create"
              onClick={() => {
                setShowForm(true);
                loadOpts();
              }}
            >
              + Create Credit Note
            </button>
          </FinanceCan>
          <FinanceCan action="canRecordPayment">
            <button type="button" className="pm-btn finance-cn-btn-refund" onClick={openRefundModal}>
              + Initiate Refund
            </button>
          </FinanceCan>
        </div>
      </header>

      <section className="finance-cn-panel">
        <h2 className="finance-cn-panel__title">Credit Note List</h2>
        <div className="finance-cn-panel__filters">
          <FinanceListFilters
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search credit note, customer, invoice..."
            statusValue={cnStatusFilter}
            statusOptions={cnFilterOptions}
            onStatusChange={setCnStatusFilter}
          />
        </div>
        <FinanceDataTable
          columns={creditNoteColumns}
          rows={filtered}
          loading={loading}
          pageSize={FINANCE_LIST_PAGE_SIZE}
          paginationResetKey={`${search}:${cnStatusFilter}`}
          onRowClick={(row) => viewDetail(row.name)}
          emptyMessage="No credit notes yet"
          className="finance-cn-panel__table"
        />
      </section>

      <section className="finance-cn-panel">
        <h2 className="finance-cn-panel__title">Refund Request Tracking</h2>
        <div className="finance-cn-panel__filters">
          <FinanceListFilters
            searchValue={refundSearch}
            onSearchChange={setRefundSearch}
            searchPlaceholder="Search refund ID, customer, credit note..."
            statusValue={refundStatusFilter}
            statusOptions={refundFilterOptions}
            onStatusChange={setRefundStatusFilter}
          />
        </div>
        <FinanceDataTable
          columns={refundTrackingColumns}
          rows={refundRows}
          loading={refundLoading}
          pageSize={FINANCE_LIST_PAGE_SIZE}
          paginationResetKey={`${refundSearch}:${refundStatusFilter}`}
          emptyMessage="No refund requests yet"
          className="finance-cn-panel__table"
          onRowClick={(row) => {
            if (row.row_type === "pending_request" && row.credit_note) {
              viewDetail(row.credit_note);
              return;
            }
            if (row.refund_id) {
              navigate(
                `/finance/payment-entries?pe=${encodeURIComponent(row.refund_id)}&payment_type=Pay&refunds_only=1`
              );
            }
          }}
        />
      </section>

      <footer className="finance-cn-footer">
        <Link to="/finance/pending-approvals?queue=credit_refunds" className="finance-cn-card">
          <h3>Approval Workflow</h3>
          <p>
            {summary?.pending_approval_count
              ? `${summary.pending_approval_count} pending approval`
              : "View pending credit note and refund approvals"}
          </p>
          <span className="finance-cn-card__cta">View pending approvals →</span>
        </Link>
        <Link
          to="/finance/payment-entries?payment_type=Pay&refunds_only=1"
          className="finance-cn-card"
        >
          <h3>Refund History</h3>
          <p>
            {summary
              ? `${summary.refund_processed_count || 0} processed · ${fmt(summary.refund_open_total || 0)} open`
              : "Browse payment entries and customer refunds"}
          </p>
          <span className="finance-cn-card__cta">View all refund transactions →</span>
        </Link>
      </footer>

      {showForm ? (
        <Modal
          open
          title="Create credit note"
          onClose={() => {
            setShowForm(false);
            setForm(EMPTY_FORM);
          }}
          footer={
            <>
              <button type="button" className="pm-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <FinanceCan action="canCreate">
                <button type="button" className="pm-btn pm-btn-primary" disabled={saving} onClick={handleCreate}>
                  {saving ? "Saving…" : cnSubmitLabel}
                </button>
              </FinanceCan>
            </>
          }
        >
          <ApprovalLimitNotice doctype="Sales Invoice" amount={estimatedReturnTotal} />
          {isCustomSchema ? (
            <p className="finance-cell-muted finance-text-sm finance-mb-sm">
              Simplified invoice return — enter the amount to credit against the original invoice.
            </p>
          ) : null}
          <div className="finance-form-grid">
            <FinanceFormField label="Original sales invoice" required>
              <select
                className="pm-input"
                value={form.sales_invoice}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((prev) => ({ ...prev, sales_invoice: val }));
                  if (val) loadOpts(val);
                }}
              >
                <option value="">Select invoice…</option>
                {opts.sales_invoices.map((inv) => (
                  <option key={inv.name} value={inv.name}>
                    {inv.name} — {inv.customer} ({fmt(inv.grand_total)})
                  </option>
                ))}
              </select>
            </FinanceFormField>
            <FinanceFormField label="Return reason">
              <select
                className="pm-input"
                value={form.return_reason}
                onChange={(e) => setForm((prev) => ({ ...prev, return_reason: e.target.value }))}
              >
                {(opts.return_reasons || []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </FinanceFormField>
            <FinanceFormField label="Return request ref (optional)">
              <input
                className="pm-input"
                value={form.return_request_ref}
                onChange={(e) => setForm((prev) => ({ ...prev, return_request_ref: e.target.value }))}
                placeholder="RMA-2026-00001"
              />
            </FinanceFormField>
            <FinanceFormField label="Remarks" className="finance-form-grid__full">
              <textarea
                className="pm-input"
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
              />
            </FinanceFormField>
          </div>
          {isCustomSchema ? (
            <div className="finance-form-grid finance-mt-md">
              <FinanceFormField label="Return amount" required>
                <input
                  className="pm-input"
                  type="number"
                  min="0"
                  step="any"
                  value={form.return_amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, return_amount: e.target.value }))}
                />
              </FinanceFormField>
              {form.items[0]?.invoice_total ? (
                <FinanceFormField label="Original invoice total">
                  <div className="finance-field-value">{fmt(form.items[0].invoice_total)}</div>
                </FinanceFormField>
              ) : null}
            </div>
          ) : null}
          {!isCustomSchema && form.items.length > 0 ? (
            <div className="finance-mt-md">
              <div className="finance-field-label finance-mb-sm">Items to return</div>
              <table className="finance-table finance-table--compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, idx) => (
                    <tr key={it.item_code || idx}>
                      <td>{it.item_name || it.item_code}</td>
                      <td>
                        <input
                          type="number"
                          className="pm-input pm-input-sm"
                          min="0"
                          step="any"
                          value={it.qty}
                          onChange={(e) => {
                            const qty = e.target.value;
                            setForm((prev) => {
                              const items = [...prev.items];
                              items[idx] = { ...items[idx], qty };
                              return { ...prev, items };
                            });
                          }}
                        />
                      </td>
                      <td>{fmt(it.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {showRefundModal ? (
        <Modal
          open
          title="Initiate refund"
          onClose={() => {
            setShowRefundModal(false);
            setRefundInit(EMPTY_REFUND_INIT);
          }}
          footer={
            <>
              <button type="button" className="pm-btn" onClick={() => setShowRefundModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                disabled={initiatingRefund || !refundableNotes.length}
                onClick={handleInitiateRefund}
              >
                {initiatingRefund ? "Processing…" : "Submit refund"}
              </button>
            </>
          }
        >
          {refundableNotes.length === 0 ? (
            <p className="finance-cell-muted">
              No submitted credit notes are eligible for refund right now.
            </p>
          ) : (
            <div className="finance-form-grid">
              <FinanceFormField label="Credit note" required>
                <select
                  className="pm-input"
                  value={refundInit.credit_note}
                  onChange={(e) => onRefundCnSelect(e.target.value)}
                >
                  <option value="">Select credit note…</option>
                  {refundableNotes.map((cn) => (
                    <option key={cn.name} value={cn.name}>
                      {cn.name} — {cn.customer} ({fmt(cn.refundable_amount)})
                    </option>
                  ))}
                </select>
              </FinanceFormField>
              <FinanceFormField label="Amount" required>
                <input
                  className="pm-input"
                  type="number"
                  min="0"
                  step="any"
                  value={refundInit.amount}
                  onChange={(e) => setRefundInit((p) => ({ ...p, amount: e.target.value }))}
                />
              </FinanceFormField>
              <FinanceFormField label="Payment mode">
                <select
                  className="pm-input"
                  value={refundInit.mode}
                  onChange={(e) => setRefundInit((p) => ({ ...p, mode: e.target.value }))}
                >
                  {paymentModes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FinanceFormField>
              <FinanceFormField label="Reference no.">
                <input
                  className="pm-input"
                  value={refundInit.reference_no}
                  onChange={(e) => setRefundInit((p) => ({ ...p, reference_no: e.target.value }))}
                />
              </FinanceFormField>
            </div>
          )}
        </Modal>
      ) : null}

      {viewDoc ? (
        <Modal
          open
          title={`Credit note ${viewDoc.name}`}
          onClose={closeDetail}
          wide
          footer={
            <>
              <button type="button" className="pm-btn" onClick={() => downloadSalesInvoicePdf(viewDoc)}>
                Print
              </button>
              {viewDoc.can_refund ? (
                <FinanceCan action="canRecordPayment">
                  <button type="button" className="pm-btn pm-btn-primary" disabled={refunding} onClick={handleRefund}>
                    {refunding ? "Processing…" : "Issue refund"}
                  </button>
                </FinanceCan>
              ) : null}
              {viewDoc.refund_status === "Pending" ? (
                <FinanceCan action="canCreate">
                  <button type="button" className="pm-btn" onClick={handleCreditBalance}>
                    Keep as credit balance
                  </button>
                </FinanceCan>
              ) : null}
              <button type="button" className="pm-btn" onClick={closeDetail}>
                Close
              </button>
            </>
          }
        >
          <FinanceDocumentHeader
            title={viewDoc.name}
            subtitle={`Against ${viewDoc.return_against || "—"}`}
            status={
              <div className="finance-cn-status-row">
                <CreditNoteStatusBadge {...creditNoteApprovalStatus(viewDoc)} />
                <CreditNoteStatusBadge {...creditNoteRefundFieldStatus(viewDoc.refund_status)} />
              </div>
            }
          />

          <div className="finance-field-grid finance-field-grid--stats finance-mb-md">
            <div>
              <div className="finance-field-label">Customer</div>
              <div className="finance-field-value">{viewDoc.customer}</div>
            </div>
            <div>
              <div className="finance-field-label">Credit amount</div>
              <div className="finance-field-value">{fmt(viewDoc.grand_total)}</div>
            </div>
            <div>
              <div className="finance-field-label">Return reason</div>
              <div className="finance-field-value">{viewDoc.return_reason || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">Return request</div>
              <div className="finance-field-value">{viewDoc.return_request_ref || "—"}</div>
            </div>
            {viewDoc.original_invoice?.name ? (
              <div>
                <div className="finance-field-label">Original invoice</div>
                <div className="finance-field-value">
                  <Link
                    to={`/finance/sales-invoices?si=${encodeURIComponent(viewDoc.original_invoice.name)}`}
                    className="finance-link"
                  >
                    {viewDoc.original_invoice.name}
                  </Link>{" "}
                  <span className="finance-cell-muted">paid {fmt(viewDoc.original_invoice.paid_amount)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <ApprovalDetailPanel
            doctype="Sales Invoice"
            row={viewDoc}
            user={user}
            showToast={showToast}
            onResubmitSuccess={() => viewDetail(viewDoc.name)}
          />

          {viewDoc.can_refund ? (
            <div className="finance-panel finance-mt-md" style={{ borderColor: tokens.border }}>
              <div className="finance-panel__title">Refund to customer</div>
              <div className="finance-form-grid">
                <FinanceFormField label="Amount">
                  <input
                    className="pm-input"
                    type="number"
                    value={refundForm.amount}
                    onChange={(e) => setRefundForm((p) => ({ ...p, amount: e.target.value }))}
                  />
                </FinanceFormField>
                <FinanceFormField label="Mode">
                  <select
                    className="pm-input"
                    value={refundForm.mode}
                    onChange={(e) => setRefundForm((p) => ({ ...p, mode: e.target.value }))}
                  >
                    {paymentModes.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </FinanceFormField>
                <FinanceFormField label="Reference no.">
                  <input
                    className="pm-input"
                    value={refundForm.reference_no}
                    onChange={(e) => setRefundForm((p) => ({ ...p, reference_no: e.target.value }))}
                  />
                </FinanceFormField>
              </div>
            </div>
          ) : null}

          <div className="finance-mt-md">
            <FinanceItemsTable items={viewDoc.items} qtyKey="qty" emptyMessage="No return lines." />
          </div>
          <FinanceTaxesSection taxes={viewDoc.taxes} gstSummary={viewDoc.gst_summary} />
          <div className="finance-mt-md">
            <FinanceSalesInvoiceDocument invoice={{ ...viewDoc, name: viewDoc.name }} />
          </div>
          <FinanceDocumentHistory doctype="Sales Invoice" name={viewDoc.name} showToast={showToast} />
        </Modal>
      ) : null}
    </div>
  );
}
