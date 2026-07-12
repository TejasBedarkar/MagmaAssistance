import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ApprovalDetailPanel from "../components/ApprovalDetailPanel.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { buildApprovalListColumns } from "../lib/approvalListColumns.jsx";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import ApprovalLimitNotice from "../components/ApprovalLimitNotice.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { approvalSubmitLabel, showApprovalCreateToast } from "../lib/approvalUi.js";
import {
  paymentEntryTypesForRole,
  paymentFilterOptionsForRole,
} from "../lib/roles.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import {
  docStatusLabel,
  docStatusTone,
  paymentTypeLabel,
  paymentTypeTone,
} from "../lib/statusTones.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const EMPTY_FORM = { invoice: "", amount: "", mode: "Cash", reference_no: "" };

const PAY_TYPE_LABELS = {
  sales: "Sales Invoice (Receive)",
  purchase: "Purchase Invoice (Pay)",
};

export default function PaymentEntry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueFilter = searchParams.get("queue") || "";
  const refundsOnly = searchParams.get("refunds_only") === "1";
  const paymentTypeParam = searchParams.get("payment_type") || "";
  const peParam = searchParams.get("pe") || "";
  const { financeRole, needsCfoApproval, isCfo, user } = useFinanceRole();
  const payTypeOptions = useMemo(
    () => paymentEntryTypesForRole(financeRole),
    [financeRole]
  );
  const filterOptions = useMemo(
    () => paymentFilterOptionsForRole(financeRole),
    [financeRole]
  );
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [opts, setOpts] = useState({ unpaid_sales: [], unpaid_purchases: [], modes: [] });
  const [payType, setPayType] = useState("sales");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast();
  const [viewEntry, setViewEntry] = useState(null);

  const loadOpts = useCallback(async () => {
    try {
      const message = await callMethodGet("finance_app.api.payment_entry.get_payment_options");
      if (message) setOpts(message);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const activeType = filter || paymentTypeParam || (refundsOnly ? "Pay" : "");
      if (activeType) params.set("payment_type", activeType);
      if (refundsOnly) params.set("refunds_only", "1");
      const query = params.toString();
      const url = query
        ? `finance_app.api.payment_entry.get_payment_entries?${query}`
        : "finance_app.api.payment_entry.get_payment_entries";
      const message = await callMethodGet(url);
      setEntries(message || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [filter, paymentTypeParam, refundsOnly]);

  const viewDetail = useCallback(async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.payment_entry.get_payment_entry", { name })
      );
      if (message) setViewEntry(message);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const allowed = paymentEntryTypesForRole(financeRole);
    if (allowed.length === 1) {
      setPayType(allowed[0]);
    }
  }, [financeRole]);

  useEffect(() => {
    const allowedFilters = paymentFilterOptionsForRole(financeRole).map((o) => o.value);
    if (refundsOnly && (paymentTypeParam === "Pay" || filter === "Pay")) {
      return;
    }
    if (filter && !allowedFilters.includes(filter)) {
      setFilter("");
    }
  }, [financeRole, filter, refundsOnly, paymentTypeParam]);

  useEffect(() => {
    if (paymentTypeParam) {
      setFilter(paymentTypeParam);
    } else if (refundsOnly) {
      setFilter("Pay");
    }
  }, [paymentTypeParam, refundsOnly]);

  useEffect(() => {
    loadOpts();
  }, [loadOpts]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (queueFilter === "awaiting_payment") {
      setPayType("sales");
      setShowForm(true);
      loadOpts();
    }
  }, [queueFilter, loadOpts]);

  useEffect(() => {
    if (showForm) loadOpts();
  }, [showForm, loadOpts]);

  useEffect(() => {
    if (peParam) {
      viewDetail(peParam);
    }
  }, [peParam, viewDetail]);

  const clearQueueFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("queue");
    setSearchParams(next, { replace: true });
  };

  const clearRefundsFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("refunds_only");
    next.delete("payment_type");
    next.delete("pe");
    setSearchParams(next, { replace: true });
    setFilter("");
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const invoice_type = payType === "sales" ? "Sales Invoice" : "Purchase Invoice";
      const msg = await callMethod("finance_app.api.payment_entry.create_payment_for_invoice", {
        invoice_type,
        invoice_name: form.invoice,
        amount: form.amount,
        mode_of_payment: form.mode,
        reference_no: form.reference_no,
      });
      if (msg?.status === "success") {
        showApprovalCreateToast(
          showToast,
          msg,
          `Payment ${msg.payment_entry} created and submitted.`
        );
        setShowForm(false);
        load();
        loadOpts();
        setForm(EMPTY_FORM);
      } else {
        const errorText = msg?.message || "Error";
        if (errorText.toLowerCase().includes("already been fully paid")) {
          await loadOpts();
          setForm((prev) => ({ ...prev, invoice: "", amount: "" }));
        }
        showToast({ type: "error", text: errorText });
      }
    } catch (e) {
      showToast({ type: "error", text: `Error: ${e.message}` });
    }
    setSaving(false);
  };

  const filtered = entries.filter((e) => {
    if (filter && e.payment_type !== filter) return false;
    if (
      search &&
      !e.name?.toLowerCase().includes(search.toLowerCase()) &&
      !e.party?.toLowerCase().includes(search.toLowerCase()) &&
      !(e.party_name || "").toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const unpaidList = payType === "sales" ? opts.unpaid_sales : opts.unpaid_purchases;
  const paymentAmount = Number(form.amount) || 0;
  const paymentSubmitLabel = approvalSubmitLabel({
    needsCfoApproval,
    isCfo,
    doctype: "Payment Entry",
    amount: paymentAmount,
    defaultLabel: "Submit Payment",
  });

  const approvalColumns = useMemo(
    () =>
      buildApprovalListColumns({
        doctype: "Payment Entry",
        user,
        onResubmitSuccess: load,
        showToast,
      }),
    [user, load, showToast]
  );

  if (viewEntry) {
    return (
      <div className="pm-page finance-page">
        <button
          type="button"
          className="pm-btn pm-btn-ghost finance-back-link"
          onClick={() => {
            setViewEntry(null);
            if (peParam) {
              const next = new URLSearchParams(searchParams);
              next.delete("pe");
              setSearchParams(next, { replace: true });
            }
          }}
        >
          ← Back to List
        </button>
        <div className="pm-card">
          <div className="finance-detail-actions finance-detail-actions--center">
            <h2 className="finance-detail-title">{viewEntry.name}</h2>
            <StatusPill tone={paymentTypeTone(viewEntry.payment_type)}>
              {paymentTypeLabel(viewEntry.payment_type)}
            </StatusPill>
          </div>
          <div className="finance-field-grid--4">
            <div>
              <div className="finance-field-label">PARTY</div>
              <div className="finance-field-value">{viewEntry.party_name || viewEntry.party}</div>
              <div className="finance-field-sub">{viewEntry.party_type}</div>
            </div>
            <div>
              <div className="finance-field-label">DATE</div>
              <div className="finance-field-value">{viewEntry.posting_date}</div>
            </div>
            <div>
              <div className="finance-field-label">AMOUNT</div>
              <div
                className={`finance-field-value finance-field-value--lg ${viewEntry.payment_type === "Receive" ? "finance-field-value--success" : "finance-field-value--danger"}`}
              >
                {fmt(viewEntry.paid_amount)}
              </div>
            </div>
            <div>
              <div className="finance-field-label">MODE</div>
              <div className="finance-field-value">{viewEntry.mode_of_payment || "—"}</div>
            </div>
          </div>
          <ApprovalDetailPanel
            doctype="Payment Entry"
            row={viewEntry}
            user={user}
            showToast={showToast}
            onResubmitSuccess={() => {
              load();
              viewDetail(viewEntry.name);
            }}
          />
          {viewEntry.references?.length > 0 ? (
            <>
              <h3 className="finance-section-title finance-section-title--spaced">References</h3>
              <div className="pm-table-wrap">
                <table className="pm-table">
                  <thead>
                    <tr>
                      {["Type", "Reference", "Total", "Outstanding", "Allocated"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewEntry.references.map((ref, i) => (
                      <tr key={i}>
                        <td>{ref.reference_doctype}</td>
                        <td className="finance-cell-accent">{ref.reference_name}</td>
                        <td>{fmt(ref.total_amount)}</td>
                        <td className="finance-cell-warning">{fmt(ref.outstanding_amount)}</td>
                        <td className="finance-cell-success">{fmt(ref.allocated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {viewEntry.remarks ? <div className="finance-remark-box">{viewEntry.remarks}</div> : null}
          <FinanceDocumentHistory doctype="Payment Entry" name={viewEntry.name} showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Payment Entries"
        actions={
          <FinanceCan action="canRecordPayment">
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={() => {
                setShowForm(true);
                loadOpts();
              }}
            >
              + Record Payment
            </button>
          </FinanceCan>
        }
      >
        {queueFilter === "awaiting_payment" ? (
          <p className="finance-detail-sub finance-text-sm--flush">
            Filter: <strong>Awaiting payment</strong>
            {" · "}
            <button type="button" className="pm-btn pm-btn-ghost finance-queue-clear" onClick={clearQueueFilter}>
              Clear filter
            </button>
          </p>
        ) : null}
        {refundsOnly ? (
          <p className="finance-detail-sub finance-text-sm--flush">
            Filter: <strong>Customer refunds</strong>
            {" · "}
            <Link to="/finance/credit-notes" className="finance-link">
              Back to credit notes
            </Link>
            {" · "}
            <button type="button" className="pm-btn pm-btn-ghost finance-queue-clear" onClick={clearRefundsFilter}>
              Clear filter
            </button>
          </p>
        ) : null}
        <FinanceListFilters
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search payments..."
          statusValue={filter}
          statusOptions={filterOptions}
          onStatusChange={setFilter}
        />
      </FinancePageHeader>

      {showForm ? (
        <Modal
          title="Record Payment Against Invoice"
          wide
          onClose={() => setShowForm(false)}
          footer={
            <FinanceCan action="canSubmit">
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={handleCreate}
                disabled={saving || !form.invoice || !form.amount}
              >
                {saving ? "Processing..." : paymentSubmitLabel}
              </button>
            </FinanceCan>
          }
        >
          {payTypeOptions.length > 1 ? (
            <div className="finance-toolbar finance-toolbar--wrap">
              {payTypeOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`pm-btn finance-toggle-pill ${payType === t ? "finance-toggle-pill--active" : "finance-toggle-pill--inactive"}`}
                  onClick={() => {
                    setPayType(t);
                    setForm({ ...form, invoice: "", amount: "" });
                  }}
                >
                  {PAY_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          ) : (
            <p className="finance-field-hint finance-toolbar__fields--spaced">
              {PAY_TYPE_LABELS[payTypeOptions[0]]}
            </p>
          )}
          <div className="finance-form-grid finance-form-grid--4col finance-form-grid--flush">
            <FinanceFormField
              label="Unpaid Invoice *"
              type="select"
              value={form.invoice}
              onChange={(e) => {
                const inv = unpaidList.find((x) => x.name === e.target.value);
                setForm({ ...form, invoice: e.target.value, amount: inv?.outstanding_amount || "" });
              }}
            >
              <option value="">Select invoice...</option>
              {unpaidList.map((inv) => (
                <option key={inv.name} value={inv.name}>
                  {inv.name} — {inv.customer || "—"}
                  {inv.sales_order ? ` · SO ${inv.sales_order}` : ""}
                  {inv.delivery_note ? ` · DN ${inv.delivery_note}` : ""}
                  {" — Outstanding: "}
                  {fmt(inv.outstanding_amount)}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Amount *"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <FinanceFormField
              label="Mode"
              type="select"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
            >
              {(opts.modes || ["Cash"]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Ref No."
              value={form.reference_no}
              onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
            />
          </div>
          <ApprovalLimitNotice doctype="Payment Entry" amount={paymentAmount} />
        </Modal>
      ) : null}

      <FinanceDataTable
        columns={[
          { key: "name", label: "Payment", render: (e) => <span className="finance-cell-accent">{e.name}</span> },
          {
            key: "payment_type",
            label: "Type",
            render: (e) => (
              <StatusPill tone={paymentTypeTone(e.payment_type)}>{paymentTypeLabel(e.payment_type)}</StatusPill>
            ),
          },
          {
            key: "party",
            label: "Party",
            render: (e) => <span className="finance-cell-title">{e.party_name || e.party}</span>,
          },
          { key: "posting_date", label: "Date", render: (e) => <span className="finance-cell-muted">{e.posting_date}</span> },
          {
            key: "paid_amount",
            label: "Amount",
            render: (e) => (
              <span className={e.payment_type === "Receive" ? "finance-cell-success" : "finance-cell-danger"}>
                {fmt(e.paid_amount)}
              </span>
            ),
          },
          {
            key: "mode_of_payment",
            label: "Mode",
            render: (e) => <span className="finance-cell-muted">{e.mode_of_payment || "—"}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (e) => (
              <StatusPill tone={docStatusTone(e.docstatus)}>{docStatusLabel(e.docstatus)}</StatusPill>
            ),
          },
          ...approvalColumns,
        ]}
        rows={filtered}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${filter}|${queueFilter}`}
        loading={loading}
        loadingMessage="Loading..."
        emptyMessage="No payments found"
        getRowKey={(e) => e.name}
        onRowClick={(e) => viewDetail(e.name)}
      />
    </div>
  );
}
