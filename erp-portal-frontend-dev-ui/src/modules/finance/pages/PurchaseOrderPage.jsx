import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { useSearchParams } from "react-router-dom";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinanceDocumentHeader from "../components/FinanceDocumentHeader.jsx";
import FinanceItemsTable from "../components/FinanceItemsTable.jsx";
import FinanceTaxesSection from "../components/FinanceTaxesSection.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { financeFmt } from "../lib/financeFmt.js";
import { financeViewTableColumn } from "../components/FinanceViewAction.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { PURCHASE_ORDER_FILTER_STATUSES, mergeStatusOptions } from "../lib/statusFilters.js";
import { callMethodWithTimeout, toMethodGetUrl } from "../lib/methodUrl.js";

const fmt = financeFmt;
const CREATE_TIMEOUT_MS = 120000;
const NEW_ITEM_ROW = { item_code: "", qty: 1, rate: 0 };
const EMPTY_FORM = {
  supplier: "",
  transaction_date: "",
  schedule_date: "",
  payment_terms: "",
  taxes_template: "",
  set_warehouse: "",
  submit_doc: 1,
  items: [{ ...NEW_ITEM_ROW }],
};

const PO_STATUS_TONE = {
  Draft: "default",
  Completed: "success",
  "To Bill": "warn",
  "To Receive and Bill": "info",
  "To Receive": "info",
  Cancelled: "danger",
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const canCreatePurchaseReceipt = (doc) => {
  if (!doc) return false;
  if (toNumber(doc.per_received) < 100) return true;
  return (doc.items || []).some((it) => toNumber(it.received_qty) < toNumber(it.qty));
};

export default function PurchaseOrderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueFilter = searchParams.get("queue") || "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState(null);
  const [acting, setActing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [opts, setOpts] = useState({
    suppliers: [],
    items: [],
    tax_templates: [],
    warehouses: [],
    default_warehouse: "",
    payment_terms_templates: [],
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast(5000);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.document_chains.get_purchase_orders", {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(queueFilter ? { queue: queueFilter } : {}),
        })
      );
      setRows(message || []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [debouncedSearch, queueFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    const loadOpts = async () => {
      try {
        const message = await callMethodGet(
          toMethodGetUrl("finance_app.api.purchase_order.get_purchase_order_form_options")
        );
        if (cancelled || !message) return;
        setOpts(message);
        setForm((prev) => ({
          ...prev,
          set_warehouse: prev.set_warehouse || message.default_warehouse || "",
        }));
      } catch {
        /* keep options */
      }
    };
    loadOpts();
    return () => {
      cancelled = true;
    };
  }, [showForm]);

  const openDetail = async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.document_chains.get_purchase_order", { name })
      );
      if (message?.name) setView(message);
    } catch {
      showToast("Could not load document.");
    }
  };

  const runCreatePR = async (name) => {
    if (!canCreatePurchaseReceipt(view)) {
      showToast("This Purchase Order is already fully received. Create Purchase Invoice from Purchase Receipt.");
      return;
    }
    setActing(true);
    try {
      const m = await callMethodWithTimeout(
        "finance_app.api.document_chains.create_purchase_receipt_from_purchase_order",
        { purchase_order: name },
        CREATE_TIMEOUT_MS
      );
      if (m?.status === "success") {
        showToast(m.message || "Created.");
        setView(null);
        load();
      } else {
        showToast(`Error: ${m?.message || "Failed"}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message || "request failed"}`);
    }
    setActing(false);
  };

  const updateItem = (index, patch) => {
    setForm((prev) => {
      const nextItems = [...prev.items];
      nextItems[index] = { ...nextItems[index], ...patch };
      return { ...prev, items: nextItems };
    });
  };

  const handleCreatePo = async () => {
    setSaving(true);
    try {
      const m = await callMethod("finance_app.api.purchase_order.create_purchase_order", {
        supplier: form.supplier,
        transaction_date: form.transaction_date,
        schedule_date: form.schedule_date,
        payment_terms: form.payment_terms,
        taxes_template: form.taxes_template,
        set_warehouse: form.set_warehouse,
        submit_doc: form.submit_doc ? 1 : 0,
        items: JSON.stringify(form.items),
      });
      if (m?.status === "success") {
        showToast(m.message || "Purchase Order created.");
        setShowForm(false);
        setForm({
          ...EMPTY_FORM,
          set_warehouse: opts.default_warehouse || "",
        });
        load();
      } else {
        showToast(`Error: ${m?.message || "Failed"}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message || "request failed"}`);
    }
    setSaving(false);
  };

  const statuses = mergeStatusOptions(
    PURCHASE_ORDER_FILTER_STATUSES,
    rows.map((r) => r.status)
  );
  const filteredRows = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });
  const clearQueueFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("queue");
    setSearchParams(next, { replace: true });
  };

  const columns = useMemo(
    () => [
      {
        key: "name",
        label: "ID",
        render: (row) => <span className="finance-cell-accent">{row.name}</span>,
      },
      {
        key: "supplier",
        label: "Supplier",
        render: (row) => row.supplier_name || row.supplier,
      },
      {
        key: "transaction_date",
        label: "Date",
        render: (row) => <span className="finance-cell-muted">{row.transaction_date}</span>,
      },
      {
        key: "status",
        label: "Status",
        render: (row) => (
          <StatusPill tone={PO_STATUS_TONE[row.status] || "default"}>{row.status || "Draft"}</StatusPill>
        ),
      },
      {
        key: "grand_total",
        label: "Amount",
        render: (row) => <span className="finance-cell-success">{fmt(row.grand_total)}</span>,
      },
      {
        key: "per_received",
        label: "% Rec.",
        render: (row) => (row.per_received != null ? `${row.per_received}%` : "—"),
      },
      financeViewTableColumn({ key: "_view" }),
    ],
    []
  );

  if (view) {
    const allowCreatePurchaseReceipt = canCreatePurchaseReceipt(view);
    return (
      <div className="pm-page finance-page">
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setView(null)}>
          ← Back to list
        </button>
        <div className="pm-card">
          <FinanceDocumentHeader
            title={view.name}
            subtitle={`Supplier: ${view.supplier_name || view.supplier}`}
            status={
              <StatusPill tone={PO_STATUS_TONE[view.status] || "default"}>
                {view.status || "Draft"}
              </StatusPill>
            }
            actions={
              <FinanceCan action="canCreate">
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  disabled={acting || !allowCreatePurchaseReceipt}
                  onClick={() => runCreatePR(view.name)}
                >
                  {acting ? "Working…" : allowCreatePurchaseReceipt ? "Create purchase receipt" : "Fully received"}
                </button>
              </FinanceCan>
            }
          />
          <div className="finance-field-grid--stats">
            <div>
              <div className="finance-field-label">TRANSACTION DATE</div>
              <div className="finance-field-value">{view.transaction_date || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">STATUS</div>
              <div className="finance-field-value">{view.status || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">% RECEIVED</div>
              <div className="finance-field-value">
                {view.per_received != null ? `${view.per_received}%` : "—"}
              </div>
            </div>
            <div>
              <div className="finance-field-label">GRAND TOTAL</div>
              <div className="finance-field-value finance-field-value--success">{fmt(view.grand_total)}</div>
            </div>
          </div>
          <div className="finance-control-section">
            <h3 className="finance-control-section__title finance-control-section__title--items">Items</h3>
            <FinanceItemsTable items={view.items} emptyMessage="No items on this order." />
          </div>
          {(view.taxes?.length > 0 || view.taxes_and_charges) && (
            <FinanceTaxesSection
              taxes={view.taxes}
              taxesTemplate={view.taxes_and_charges}
              netTotal={view.net_total}
              totalTaxes={view.total_taxes_and_charges ?? view.total_taxes}
              grandTotal={view.grand_total}
              emptyMessage="No tax lines on this order."
            />
          )}
          <FinanceDocumentHistory doctype="Purchase Order" name={view.name} showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Purchase Orders"
        actions={
          <FinanceCan action="canCreate">
            <button type="button" className="pm-btn pm-btn-primary" onClick={() => setShowForm(true)}>
              + New Purchase Order
            </button>
          </FinanceCan>
        }
      >
        {queueFilter ? (
          <p className="finance-detail-sub finance-text-sm--flush">
            Filter: <strong>{queueFilter}</strong>
            {" · "}
            <button type="button" className="pm-btn pm-btn-ghost finance-queue-clear" onClick={clearQueueFilter}>
              Clear filter
            </button>
          </p>
        ) : null}
        <FinanceListFilters
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search…"
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
          title="Create Purchase Order"
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <FinanceCan action="canCreate">
                <button
                  type="button"
                  className="pm-btn"
                  onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, { ...NEW_ITEM_ROW }] }))}
                >
                  + Add Item
                </button>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  onClick={handleCreatePo}
                  disabled={saving || !form.supplier || !form.items.some((i) => i.item_code)}
                >
                  {saving ? "Creating..." : form.submit_doc ? "Create & Submit" : "Save Draft"}
                </button>
              </FinanceCan>
              <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </>
          }
        >
          <div className="finance-form-grid--auto">
            <FinanceFormField
              label="Supplier *"
              type="select"
              value={form.supplier}
              onChange={(e) => {
                const supplier = e.target.value;
                const sup = opts.suppliers.find((s) => s.name === supplier);
                setForm((prev) => ({
                  ...prev,
                  supplier,
                  payment_terms: sup?.payment_terms || prev.payment_terms,
                }));
              }}
            >
              <option value="">Select...</option>
              {opts.suppliers.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.supplier_name || s.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Transaction Date"
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm((prev) => ({ ...prev, transaction_date: e.target.value }))}
            />
            <FinanceFormField
              label="Schedule Date"
              type="date"
              value={form.schedule_date}
              onChange={(e) => setForm((prev) => ({ ...prev, schedule_date: e.target.value }))}
            />
            <FinanceFormField
              label="Payment Terms"
              type="select"
              value={form.payment_terms}
              onChange={(e) => setForm((prev) => ({ ...prev, payment_terms: e.target.value }))}
            >
              <option value="">Default from supplier</option>
              {(opts.payment_terms_templates || []).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Tax Template"
              type="select"
              value={form.taxes_template}
              onChange={(e) => setForm((prev) => ({ ...prev, taxes_template: e.target.value }))}
            >
              <option value="">None</option>
              {opts.tax_templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.title || t.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Warehouse"
              type="select"
              value={form.set_warehouse}
              onChange={(e) => setForm((prev) => ({ ...prev, set_warehouse: e.target.value }))}
            >
              <option value="">Default</option>
              {opts.warehouses.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField label="Submission" type="select" value={String(form.submit_doc)} onChange={(e) => setForm((prev) => ({ ...prev, submit_doc: Number(e.target.value) ? 1 : 0 }))}>
              <option value="1">Create and submit</option>
              <option value="0">Save as draft</option>
            </FinanceFormField>
          </div>

          <h4 className="finance-section-title--flush">Items</h4>
          {form.items.map((item, i) => (
            <div key={i} className="finance-form-grid--items">
              <select
                className="pm-select"
                value={item.item_code}
                onChange={(e) => {
                  const code = e.target.value;
                  const found = opts.items.find((x) => x.name === code);
                  updateItem(i, { item_code: code, rate: found?.standard_rate || 0 });
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
                onChange={(e) => updateItem(i, { qty: e.target.value })}
              />
              <input
                className="pm-input"
                type="number"
                placeholder="Rate"
                value={item.rate}
                onChange={(e) => updateItem(i, { rate: e.target.value })}
              />
              <button
                type="button"
                className="pm-btn pm-btn-danger"
                onClick={() =>
                  setForm((prev) => {
                    const next = prev.items.filter((_, j) => j !== i);
                    return { ...prev, items: next.length ? next : [{ ...NEW_ITEM_ROW }] };
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </Modal>
      )}

      <FinanceDataTable
        columns={columns}
        rows={filteredRows}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${statusFilter}`}
        loading={loading}
        emptyMessage="No records found."
        getRowKey={(row) => row.name}
        onRowClick={(row) => openDetail(row.name)}
      />
    </div>
  );
}
