import { useEffect, useMemo, useState } from "react";
import ApprovalDetailPanel from "../components/ApprovalDetailPanel.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { buildApprovalListColumns } from "../lib/approvalListColumns.jsx";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import ApprovalLimitNotice from "../components/ApprovalLimitNotice.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinanceDocumentHeader from "../components/FinanceDocumentHeader.jsx";
import FinanceItemsTable from "../components/FinanceItemsTable.jsx";
import FinancePaymentProgress from "../components/FinancePaymentProgress.jsx";
import FinanceTaxesSection from "../components/FinanceTaxesSection.jsx";
import { financeFmt } from "../lib/financeFmt.js";
import { withAutoDueDate } from "../lib/financeDueDate.js";
import { downloadPurchaseInvoicePdf } from "../lib/financePurchaseInvoicePdf.js";
import { purchaseTaxLabel } from "../lib/financeRcmTax.js";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { approvalSubmitLabel, showApprovalCreateToast } from "../lib/approvalUi.js";
import {
  PURCHASE_INVOICE_EXCLUDED_FILTER_STATUSES,
  PURCHASE_INVOICE_FILTER_STATUSES,
  mergeStatusOptions,
} from "../lib/statusFilters.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";

const fmt = financeFmt;

function invoiceStatusTone(status) {
  const map = {
    Draft: "default",
    Submitted: "info",
    Unpaid: "warn",
    Paid: "success",
    Overdue: "danger",
    "Partly Paid": "info",
    Cancelled: "default",
  };
  return map[status] || "default";
}

function PayBar({ pct }) {
  const p = Math.min(100, pct || 0);
  const barColor = p >= 100 ? tokens.success : p >= 50 ? tokens.warning : tokens.danger;
  return (
    <div className="finance-pay-bar">
      <div className="finance-pay-bar__track">
        <div className="finance-pay-bar__fill" style={{ width: `${p}%`, background: barColor }} />
      </div>
      <span className="finance-pay-bar__pct">{Math.round(pct || 0)}%</span>
    </div>
  );
}

const EMPTY_FORM = {
  supplier: "",
  posting_date: "",
  payment_terms: "",
  due_date: "",
  bill_no: "",
  bill_date: "",
  items: [{ item_code: "", qty: 1, rate: 0 }],
  taxes_template: "",
  apply_tds: 0,
  tax_withholding_category: "",
  remarks: "",
};

export default function PurchaseInvoice() {
  const { needsCfoApproval, isCfo, user } = useFinanceRole();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [opts, setOpts] = useState({
    suppliers: [],
    items: [],
    tax_templates: [],
    tds_categories: [],
    payment_terms_templates: [],
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast(4000);
  const [viewInv, setViewInv] = useState(null);

  useEffect(() => {
    load();
    loadOpts();
  }, []);

  useEffect(() => {
    if (showForm) loadOpts();
  }, [showForm]);

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowForm(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [showForm]);

  const load = async () => {
    setLoading(true);
    try {
      const message = await callMethodGet(toMethodGetUrl("finance_app.api.purchase_invoice.get_purchase_invoices"));
      setInvoices(message || []);
    } catch {
      /* keep list */
    }
    setLoading(false);
  };

  const loadOpts = async () => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.purchase_invoice.get_purchase_invoice_options")
      );
      if (message) setOpts(message);
    } catch {
      /* keep options */
    }
  };

  const viewDetail = async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.purchase_invoice.get_purchase_invoice", { name })
      );
      if (message) setViewInv(message);
    } catch {
      /* keep view */
    }
  };

  const patchForm = (patch) => setForm((prev) => withAutoDueDate({ ...prev, ...patch }));

  const onSupplierChange = (supplier) => {
    const sup = opts.suppliers.find((s) => s.name === supplier);
    patchForm({ supplier, payment_terms: sup?.payment_terms || "" });
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.purchase_invoice.create_purchase_invoice", {
        supplier: form.supplier,
        posting_date: form.posting_date,
        payment_terms: form.payment_terms,
        due_date: form.due_date,
        bill_no: form.bill_no,
        bill_date: form.bill_date,
        remarks: form.remarks,
        items: JSON.stringify(form.items),
        taxes_template: form.taxes_template,
        apply_tds: form.apply_tds ? 1 : 0,
        tax_withholding_category: form.tax_withholding_category || "",
      });
      if (msg?.status === "success") {
        showApprovalCreateToast(
          showToast,
          msg,
          msg.message || "Purchase Invoice created and submitted."
        );
        setShowForm(false);
        load();
        setForm(EMPTY_FORM);
      } else {
        showToast({ ok: false, message: msg?.message || "Error" });
      }
    } catch (e) {
      showToast(`Error: ${e.message}`);
    }
    setSaving(false);
  };

  const filtered = invoices.filter((inv) => {
    if (
      search &&
      !inv.name?.toLowerCase().includes(search.toLowerCase()) &&
      !inv.supplier?.toLowerCase().includes(search.toLowerCase()) &&
      !(inv.supplier_name || "").toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    if (statusFilter && inv.status !== statusFilter) return false;
    return true;
  });
  const statuses = mergeStatusOptions(
    PURCHASE_INVOICE_FILTER_STATUSES,
    invoices.map((i) => i.status).filter((s) => !PURCHASE_INVOICE_EXCLUDED_FILTER_STATUSES.has(s))
  );
  const estimatedTotal = useMemo(
    () =>
      form.items.reduce(
        (sum, row) => sum + Number(row.qty || 0) * Number(row.rate || 0),
        0
      ),
    [form.items]
  );
  const canSubmit =
    Boolean(form.supplier) && Boolean(form.payment_terms) && Boolean(form.items?.[0]?.item_code);

  const piSubmitLabel = approvalSubmitLabel({
    needsCfoApproval,
    isCfo,
    doctype: "Purchase Invoice",
    amount: estimatedTotal,
    defaultLabel: "Create & Submit",
  });

  const approvalColumns = useMemo(
    () =>
      buildApprovalListColumns({
        doctype: "Purchase Invoice",
        user,
        onResubmitSuccess: load,
        showToast,
      }),
    [user, load, showToast]
  );

  if (viewInv) {
    return (
      <div className="pm-page finance-page">
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setViewInv(null)}>
          ← Back to List
        </button>
        <div className="pm-card">
          <FinanceDocumentHeader
            title={viewInv.name}
            subtitle={`Supplier: ${viewInv.supplier_name || viewInv.supplier}`}
            status={
              <StatusPill tone={invoiceStatusTone(viewInv.status)}>{viewInv.status || "Draft"}</StatusPill>
            }
            actions={
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={() => downloadPurchaseInvoicePdf(viewInv)}
              >
                Download PDF
              </button>
            }
          />
          <div className="finance-field-grid--stats">
            <div>
              <div className="finance-field-label">POSTING DATE</div>
              <div className="finance-field-value">{viewInv.posting_date || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">DUE DATE</div>
              <div className="finance-field-value">{viewInv.due_date || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">GRAND TOTAL</div>
              <div className="finance-field-value finance-field-value--success">{fmt(viewInv.grand_total)}</div>
            </div>
            <div>
              <div className="finance-field-label">OUTSTANDING</div>
              <div className="finance-field-value finance-field-value--warning">{fmt(viewInv.outstanding_amount)}</div>
            </div>
          </div>
          {(viewInv.payment_terms || viewInv.supplier_details?.payment_terms) ? (
            <p className="finance-detail-sub finance-text-sm--flush">
              Payment terms:{" "}
              <strong>{viewInv.payment_terms || viewInv.supplier_details?.payment_terms}</strong>
            </p>
          ) : null}
          <ApprovalDetailPanel
            doctype="Purchase Invoice"
            row={viewInv}
            user={user}
            showToast={showToast}
            onResubmitSuccess={() => {
              load();
              viewDetail(viewInv.name);
            }}
          />
          <FinancePaymentProgress pct={viewInv.paid_pct} />
          {(viewInv.apply_tds || viewInv.taxes_and_charges) && (
            <div className="finance-field-grid--stats">
              {viewInv.taxes_and_charges ? (
                <div>
                  <div className="finance-field-label">GST TEMPLATE</div>
                  <div className="finance-field-value finance-field-value--sm">{viewInv.taxes_and_charges}</div>
                </div>
              ) : null}
              {viewInv.apply_tds ? (
                <div>
                  <div className="finance-field-label">TDS</div>
                  <div className="finance-field-value finance-field-value--warning finance-field-value--sm">
                    {viewInv.tax_withholding_category || "Applied"}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <FinanceTaxesSection
            taxes={viewInv.taxes}
            taxesTemplate={viewInv.taxes_and_charges}
            netTotal={viewInv.net_total}
            totalTaxes={viewInv.total_taxes_and_charges}
            grandTotal={viewInv.grand_total}
            isRcm={viewInv.is_rcm}
            rcmGstAmount={viewInv.rcm_gst_amount}
            supplierPayableTax={viewInv.supplier_payable_tax}
            emptyMessage="No tax lines on this invoice."
            taxLabel={(tax) => purchaseTaxLabel(tax, viewInv.is_rcm)}
          />
          <div className="finance-control-section">
            <h3 className="finance-control-section__title finance-control-section__title--items">Items &amp; HSN</h3>
            <FinanceItemsTable items={viewInv.items} showHsn emptyMessage="No items on this invoice." />
          </div>
          <FinanceDocumentHistory doctype="Purchase Invoice" name={viewInv.name} showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Purchase Invoices"
        actions={
          <FinanceCan action="canCreate">
            <button type="button" className="pm-btn pm-btn-primary" onClick={() => setShowForm(true)}>
              + New Purchase Invoice
            </button>
          </FinanceCan>
        }
      >
        <FinanceListFilters
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search purchase invoices..."
          statusValue={statusFilter}
          statusOptions={[
            { value: "", label: "All Status" },
            ...statuses.map((s) => ({ value: s, label: s })),
          ]}
          onStatusChange={setStatusFilter}
        />
      </FinancePageHeader>

      {showForm && (
        <Modal
          title="Create Purchase Invoice"
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <FinanceCan action="canCreate">
                <button
                  type="button"
                  className="pm-btn"
                  onClick={() => setForm({ ...form, items: [...form.items, { item_code: "", qty: 1, rate: 0 }] })}
                >
                  + Add Item
                </button>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  onClick={handleCreate}
                  disabled={saving || !canSubmit}
                >
                  {saving ? "Creating..." : piSubmitLabel}
                </button>
              </FinanceCan>
              <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </>
          }
        >
          <ApprovalLimitNotice
            doctype="Purchase Invoice"
            amount={estimatedTotal}
            hint=" Line totals exclude tax; if tax pushes the invoice above the limit, it will be saved as Draft for CFO approval."
          />
          <div className="finance-form-grid--auto">
            <FinanceFormField label="Supplier *" type="select" value={form.supplier} onChange={(e) => onSupplierChange(e.target.value)}>
              <option value="">Select...</option>
              {opts.suppliers.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.supplier_name || s.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Posting Date"
              type="date"
              value={form.posting_date}
              onChange={(e) => patchForm({ posting_date: e.target.value })}
            />
            <FinanceFormField
              label="Payment Terms *"
              type="select"
              value={form.payment_terms}
              onChange={(e) => patchForm({ payment_terms: e.target.value })}
            >
              <option value="">Select...</option>
              {opts.payment_terms_templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Due Date"
              type="date"
              value={form.due_date}
              readOnly
              hint="Auto-calculated from posting date and payment terms"
            />
            <FinanceFormField
              label="Supplier Invoice No."
              type="text"
              value={form.bill_no}
              onChange={(e) => setForm({ ...form, bill_no: e.target.value })}
            />
            <FinanceFormField
              label="Supplier Invoice Date"
              type="date"
              value={form.bill_date}
              onChange={(e) => setForm({ ...form, bill_date: e.target.value })}
            />
            <FinanceFormField
              label="Tax Template"
              type="select"
              value={form.taxes_template}
              onChange={(e) => setForm({ ...form, taxes_template: e.target.value })}
            >
              <option value="">None</option>
              {opts.tax_templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.title || t.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Notes"
              type="text"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </div>
          <h4 className="finance-section-title--flush">Items</h4>
          {form.items.map((item, i) => (
            <div key={i} className="finance-form-grid--items">
              <select
                className="pm-select"
                value={item.item_code}
                onChange={(e) => {
                  const items = [...form.items];
                  items[i].item_code = e.target.value;
                  const found = opts.items.find((x) => x.name === e.target.value);
                  if (found) items[i].rate = found.standard_rate || 0;
                  setForm({ ...form, items });
                }}
              >
                <option value="">Select Item...</option>
                {opts.items.map((it) => (
                  <option key={it.name} value={it.name}>
                    {it.item_name || it.name}
                  </option>
                ))}
              </select>
              <input
                className="pm-input"
                type="number"
                placeholder="Qty"
                value={item.qty}
                onChange={(e) => {
                  const items = [...form.items];
                  items[i].qty = e.target.value;
                  setForm({ ...form, items });
                }}
              />
              <input
                className="pm-input"
                type="number"
                placeholder="Rate"
                value={item.rate}
                onChange={(e) => {
                  const items = [...form.items];
                  items[i].rate = e.target.value;
                  setForm({ ...form, items });
                }}
              />
              <button
                type="button"
                className="pm-btn pm-btn-danger"
                onClick={() => {
                  const items = form.items.filter((_, j) => j !== i);
                  setForm({ ...form, items: items.length ? items : [{ item_code: "", qty: 1, rate: 0 }] });
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </Modal>
      )}

      <FinanceDataTable
        columns={[
          { key: "name", label: "Invoice", render: (inv) => <span className="finance-cell-accent">{inv.name}</span> },
          {
            key: "supplier",
            label: "Supplier",
            render: (inv) => <span className="finance-cell-title">{inv.supplier_name || inv.supplier}</span>,
          },
          { key: "posting_date", label: "Date", render: (inv) => <span className="finance-cell-muted">{inv.posting_date}</span> },
          { key: "due_date", label: "Due Date", render: (inv) => <span className="finance-cell-muted">{inv.due_date}</span> },
          {
            key: "grand_total",
            label: "Grand Total",
            render: (inv) => <span className="finance-cell-danger">{fmt(inv.grand_total)}</span>,
          },
          {
            key: "outstanding_amount",
            label: "Outstanding",
            render: (inv) => (
              <span className={inv.outstanding_amount > 0 ? "finance-cell-warning" : "finance-cell-success"}>
                {fmt(inv.outstanding_amount)}
              </span>
            ),
          },
          {
            key: "paid_pct",
            label: "Payment",
            cellClassName: "finance-cell-pay",
            render: (inv) => <PayBar pct={inv.paid_pct} />,
          },
          {
            key: "status",
            label: "Status",
            render: (inv) => <StatusPill tone={invoiceStatusTone(inv.status)}>{inv.status || "Draft"}</StatusPill>,
          },
          ...approvalColumns,
        ]}
        rows={filtered}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${statusFilter}`}
        loading={loading}
        loadingMessage="Loading..."
        emptyMessage="No purchase invoices found"
        getRowKey={(inv) => inv.name}
        onRowClick={(inv) => viewDetail(inv.name)}
      />
    </div>
  );
}
