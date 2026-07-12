import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceDocumentHeader from "../components/FinanceDocumentHeader.jsx";
import FinanceGstPreview from "../components/FinanceGstPreview.jsx";
import FinanceItemsTable from "../components/FinanceItemsTable.jsx";
import FinanceBomBreakdownTable from "../components/FinanceBomBreakdownTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinanceTaxesSection from "../components/FinanceTaxesSection.jsx";
import FinanceVerificationChecklist from "../components/FinanceVerificationChecklist.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { financeFmt } from "../lib/financeFmt.js";
import { financeViewTableColumn } from "../components/FinanceViewAction.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import {
  DELIVERY_NOTE_FILTER_STATUSES,
  PURCHASE_RECEIPT_FILTER_STATUSES,
  mergeStatusOptions,
} from "../lib/statusFilters.js";
import { showApprovalCreateToast } from "../lib/approvalUi.js";
import { callMethodWithTimeout, toMethodGetUrl } from "../lib/methodUrl.js";

const fmt = financeFmt;
const CREATE_TIMEOUT_MS = 120000;

const DN_STATUS_TONE = {
  Draft: "default",
  Completed: "success",
  "To Bill": "warn",
  "Partly Billed": "info",
  Cancelled: "danger",
};

const QUEUE_LABELS = {
  needs_verify: "Verify delivery",
  ready_to_invoice: "Ready to invoice",
};

const canCreateSalesInvoiceFromDeliveryNote = (doc) => {
  if (!doc?.finance_verified) return false;
  if (doc?.can_create_sales_invoice === false) return false;
  if (doc?.has_pending_invoice || doc?.has_submitted_invoice) return false;
  const status = String(doc?.status || "").toLowerCase();
  return status === "to bill" || status === "partly billed" || status === "partially billed";
};

const deliveryNoteActionLabel = (doc, actionLabel) => {
  if (!doc?.finance_verified) return "Verify delivery first";
  if (canCreateSalesInvoiceFromDeliveryNote(doc)) return actionLabel;
  if (doc?.has_pending_invoice) return "Pending CFO approval";
  if (doc?.has_submitted_invoice) return "Already invoiced";
  return "Completed";
};

const canCreatePurchaseInvoiceFromPurchaseReceipt = (doc) => {
  if (doc?.can_create_purchase_invoice === false) return false;
  if (doc?.has_pending_invoice || doc?.has_submitted_invoice) return false;
  const status = String(doc?.status || "").toLowerCase();
  return status === "to bill" || status === "partly billed" || status === "partially billed";
};

const purchaseReceiptActionLabel = (doc, actionLabel) => {
  if (canCreatePurchaseInvoiceFromPurchaseReceipt(doc)) return actionLabel;
  if (doc?.has_pending_invoice) return "Pending CFO approval";
  if (doc?.has_submitted_invoice) return "Already invoiced";
  return "Completed";
};

function InvoiceConfirmModal({
  open,
  sourceName,
  sourceLabel,
  sourceSecondaryLabel,
  sourceSecondaryValue,
  previewMethod,
  previewParamName,
  onClose,
  onCreated,
  createMethod,
  createParamName,
  createButtonLabel = "Create & submit invoice",
  modalTitle = "Confirm Invoice",
  loadingLabel = "Loading GST preview…",
  createdFallbackMessage = "Invoice created.",
  showToast,
  useApprovalToast,
  createPermissionAction = "canCreateSalesChain",
}) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !sourceName) {
      setPreview(null);
      return undefined;
    }

    let cancelled = false;
    const fetchPreview = async () => {
      setLoading(true);
      try {
        const msg = await callMethodGet(
          toMethodGetUrl(previewMethod, {
            [previewParamName]: sourceName,
          })
        );
        if (cancelled) return;
        if (msg?.status === "error") {
          showToast(msg.message || "Could not load invoice preview.");
          setPreview(null);
        } else {
          setPreview(msg);
        }
      } catch (e) {
        if (!cancelled) showToast(e.message || "Could not load invoice preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [open, previewMethod, previewParamName, showToast, sourceName]);

  const handleCreate = async () => {
    if (preview?.validation && preview.validation.ok === false) {
      showToast(preview.validation.errors?.[0] || "Fix GST/HSN issues before creating the invoice.");
      return;
    }
    setSubmitting(true);
    try {
      const m = await callMethodWithTimeout(
        createMethod,
        { [createParamName]: sourceName },
        CREATE_TIMEOUT_MS
      );
      if (m?.status === "success") {
        if (useApprovalToast) {
          showApprovalCreateToast(showToast, m, createdFallbackMessage);
        } else {
          showToast(m.message || createdFallbackMessage);
        }
        onCreated();
        onClose();
      } else {
        showToast(`Error: ${m?.message || "Failed"}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message || "request failed"}`);
    }
    setSubmitting(false);
  };

  if (!open) return null;

  const canSubmit = preview?.validation?.ok !== false;
  const resolvedSecondaryValue = sourceSecondaryValue || preview?.sales_order || preview?.purchase_order;

  return (
    <Modal
      title={modalTitle}
      wide
      onClose={onClose}
      footer={
        <FinanceCan action={createPermissionAction}>
          <button
            type="button"
            className="pm-btn pm-btn-primary"
            disabled={loading || submitting || !canSubmit}
            onClick={handleCreate}
          >
            {submitting ? "Creating…" : createButtonLabel}
          </button>
        </FinanceCan>
      }
    >
      {loading ? (
        <p className="finance-cell-muted">{loadingLabel}</p>
      ) : preview ? (
        <>
          <p className="finance-detail-sub finance-text-sm--flush">
            {sourceLabel} <strong>{sourceName}</strong>
            {resolvedSecondaryValue ? (
              <>
                {" "}
                · {sourceSecondaryLabel} <strong>{resolvedSecondaryValue}</strong>
              </>
            ) : null}
            {" · "}
            {preview.customer_name || preview.customer || preview.supplier_name || preview.supplier}
          </p>
          <FinanceGstPreview preview={preview} />
        </>
      ) : (
        <p className="finance-cell-muted">No preview available.</p>
      )}
    </Modal>
  );
}

function ChainDocInner({
  title,
  listMethod,
  getMethod,
  createMethod,
  createParamName,
  actionLabel,
  columns,
  primaryField,
  dateField,
  dateLabel,
  pctField,
  pctLabel,
  enableStatusFilter = false,
  statusFilterOptions = [],
  canCreateFromView = null,
  useApprovalToast = false,
  getCreateActionLabel = null,
  invoiceLabel = "Sales Invoice",
  invoiceContext = "delivery",
  verifyMethod = null,
  verifyParamName = "",
  showVerificationPanel = false,
  confirmBeforeInvoiceCreate = false,
  previewMethod = "",
  previewParamName = "",
  modalTitle = "Confirm Invoice",
  sourceLabel = "Document",
  sourceSecondaryLabel = "",
  sourceSecondaryField = "",
  createPermissionAction = "canCreateSalesChain",
  auditDoctype = "",
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueFilter = searchParams.get("queue") || "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState(null);
  const [acting, setActing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);
  const { showToast } = useFinanceToast(5000);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (queueFilter) params.queue = queueFilter;
      const message = await callMethodGet(toMethodGetUrl(listMethod, params));
      setRows(message || []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [listMethod, debouncedSearch, queueFilter]);

  const clearQueueFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("queue");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (name) => {
    try {
      const message = await callMethodGet(toMethodGetUrl(getMethod, { name }));
      if (message?.name) {
        setView(message);
      } else {
        showToast("Could not load document — empty response from server.");
      }
    } catch {
      showToast("Could not load document.");
    }
  };

  const runCreate = async (name) => {
    if (confirmBeforeInvoiceCreate) {
      setInvoiceConfirmOpen(true);
      return;
    }
    await executeCreate(name);
  };

  const executeCreate = async (name) => {
    setActing(true);
    try {
      const body = { [createParamName]: name };
      const m = await callMethodWithTimeout(createMethod, body, CREATE_TIMEOUT_MS);
      if (m?.status === "success") {
        if (useApprovalToast) {
          showApprovalCreateToast(showToast, m, "Created.");
        } else {
          showToast(m.message || "Created.");
        }
        if (m.pending_cfo_approval) {
          try {
            const updated = await callMethodGet(toMethodGetUrl(getMethod, { name }));
            if (updated?.name) setView(updated);
          } catch {
            setView(null);
          }
        } else {
          setView(null);
        }
        load();
      } else {
        showToast(`Error: ${m?.message || "Failed"}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message || "request failed"}`);
    }
    setActing(false);
  };

  const runVerify = async (name) => {
    if (!verifyMethod || !verifyParamName) return;
    setVerifying(true);
    try {
      const m = await callMethodWithTimeout(
        verifyMethod,
        { [verifyParamName]: name },
        CREATE_TIMEOUT_MS
      );
      if (m?.status === "success") {
        showToast(m.message || "Delivery verified.");
        try {
          const updated = await callMethodGet(toMethodGetUrl(getMethod, { name }));
          if (updated?.name) setView(updated);
        } catch {
          /* keep current view */
        }
        load();
      } else {
        showToast(`Error: ${m?.message || "Verification failed"}`);
      }
    } catch (e) {
      showToast(`Error: ${e.message || "request failed"}`);
    }
    setVerifying(false);
  };

  const statuses = enableStatusFilter
    ? mergeStatusOptions(statusFilterOptions, rows.map((r) => r.status))
    : [];
  const filteredRows = enableStatusFilter && statusFilter
    ? rows.filter((row) => row.status === statusFilter)
    : rows;

  const tableColumns = useMemo(
    () => [
      ...columns.map((c) => ({
        key: c.key,
        label: c.label,
        render: c.render
          ? c.render
          : c.fmt
            ? (row) => c.fmt(row[c.key])
            : c.key === "name"
              ? (row) => <span className="finance-cell-accent">{row[c.key]}</span>
              : c.key === "transaction_date" || c.key === "posting_date"
                ? (row) => <span className="finance-cell-muted">{row[c.key] ?? "—"}</span>
                : (row) => row[c.key] ?? "—",
      })),
      financeViewTableColumn({ key: "_view" }),
    ],
    [columns]
  );

  if (view) {
    const actionAllowed = canCreateFromView ? canCreateFromView(view) : true;
    const buttonLabel = getCreateActionLabel
      ? getCreateActionLabel(view, actionLabel)
      : actionAllowed
        ? actionLabel
        : "Completed";
    const needsVerify = showVerificationPanel && !view.finance_verified;
    const verifyFields = view.finance_verify_fields || [];
    const verification = view.verification || {};
    const partyLabel = view.supplier_name || view.customer_name || view[primaryField] || "—";
    const partyTitle =
      primaryField === "supplier" ? "Supplier" : primaryField === "customer" ? "Customer" : primaryField;

    return (
      <div className="pm-page finance-page">
        {confirmBeforeInvoiceCreate ? (
          <InvoiceConfirmModal
            open={invoiceConfirmOpen}
            sourceName={view.name}
            sourceLabel={sourceLabel}
            sourceSecondaryLabel={sourceSecondaryLabel}
            sourceSecondaryValue={sourceSecondaryField ? view[sourceSecondaryField] : ""}
            previewMethod={previewMethod}
            previewParamName={previewParamName}
            onClose={() => setInvoiceConfirmOpen(false)}
            onCreated={() => {
              setView(null);
              load();
            }}
            createMethod={createMethod}
            createParamName={createParamName}
            modalTitle={modalTitle}
            createdFallbackMessage={`${invoiceLabel} created.`}
            showToast={showToast}
            useApprovalToast={useApprovalToast}
            createPermissionAction={createPermissionAction}
          />
        ) : null}
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setView(null)}>
          ← Back to list
        </button>
        <div className="pm-card">
          {needsVerify && (
            <p className="finance-detail-sub finance-detail-sub--warning">
              {invoiceContext === "receipt"
                ? "Verify supplier, purchase order reference, quantity, tax, and warehouse before creating a Purchase Invoice."
                : "Verify customer, sales order reference, quantity, tax, and warehouse before creating a Sales Invoice."}
            </p>
          )}
          {view.finance_verified && (
            <p className="finance-detail-sub finance-detail-sub--success">
              Delivery verified
              {view.finance_verified_by ? ` by ${view.finance_verified_by}` : ""}
              {view.finance_verified_at ? ` · ${view.finance_verified_at}` : ""}.
            </p>
          )}
          {view.has_pending_invoice && (
            <p className="finance-detail-sub finance-detail-sub--warning">
              {invoiceLabel} {view.pending_invoice_name} is pending CFO approval. Approve it under
              Pending Approvals before creating another invoice.
            </p>
          )}
          {view.has_submitted_invoice && !view.has_pending_invoice && (
            <p className="finance-detail-sub finance-detail-sub--success">
              {invoiceLabel} {view.submitted_invoice_name} is already submitted for this {invoiceContext}.
            </p>
          )}
          <FinanceDocumentHeader
            title={view.name}
            subtitle={`${partyTitle}: ${partyLabel}`}
            status={
              <StatusPill tone={DN_STATUS_TONE[view.status] || "default"}>
                {view.status || "Draft"}
              </StatusPill>
            }
            actions={
              <FinanceCan action={createPermissionAction}>
                <div className="finance-detail-actions__buttons">
                  {showVerificationPanel && needsVerify ? (
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost"
                      disabled={verifying}
                      onClick={() => runVerify(view.name)}
                    >
                      {verifying ? "Verifying…" : "Verify delivery"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary"
                    disabled={acting || !actionAllowed}
                    onClick={() => runCreate(view.name)}
                  >
                    {acting
                      ? "Working…"
                      : buttonLabel === actionLabel
                        ? `Review & ${actionLabel.charAt(0).toLowerCase()}${actionLabel.slice(1)}`
                        : buttonLabel}
                  </button>
                </div>
              </FinanceCan>
            }
          />
          <div className="finance-field-grid--stats">
            <div>
              <div className="finance-field-label">{(dateLabel || dateField).toUpperCase()}</div>
              <div className="finance-field-value">{view[dateField] || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">STATUS</div>
              <div className="finance-field-value">{view.status || "—"}</div>
            </div>
            {view.sales_order ? (
              <div>
                <div className="finance-field-label">SALES ORDER</div>
                <div className="finance-field-value">{view.sales_order}</div>
              </div>
            ) : null}
            {view.purchase_order ? (
              <div>
                <div className="finance-field-label">PURCHASE ORDER</div>
                <div className="finance-field-value">{view.purchase_order}</div>
              </div>
            ) : null}
            {view.set_warehouse ? (
              <div>
                <div className="finance-field-label">WAREHOUSE</div>
                <div className="finance-field-value">{view.set_warehouse}</div>
              </div>
            ) : null}
            {pctField != null && (
              <div>
                <div className="finance-field-label">{pctLabel}</div>
                <div className="finance-field-value">
                  {view[pctField] != null ? `${view[pctField]}%` : "—"}
                </div>
              </div>
            )}
            <div>
              <div className="finance-field-label">GRAND TOTAL</div>
              <div className="finance-field-value finance-field-value--success">{fmt(view.grand_total)}</div>
            </div>
          </div>
          {showVerificationPanel ? (
            <FinanceVerificationChecklist
              fields={verifyFields}
              title="Delivery verification"
            />
          ) : null}
          <div className="finance-control-section">
            <h3 className="finance-control-section__title finance-control-section__title--items">Items</h3>
            <FinanceItemsTable items={view.items} emptyMessage="No items on this document." />
          </div>
          <FinanceBomBreakdownTable items={view.bom_items} total={view.bom_total} />
          {showVerificationPanel ? (
            <FinanceTaxesSection
              taxes={verification.taxes}
              taxesTemplate={verification.taxes_and_charges}
              netTotal={verification.net_total ?? view.net_total}
              totalTaxes={verification.total_taxes ?? view.total_taxes}
              grandTotal={view.grand_total}
              emptyMessage="No tax lines on this document."
            />
          ) : null}
          {auditDoctype && view?.name ? (
            <FinanceDocumentHistory doctype={auditDoctype} name={view.name} showToast={showToast} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader title={title}>
        {queueFilter ? (
          <p className="finance-detail-sub finance-text-sm--flush">
            Filter: <strong>{QUEUE_LABELS[queueFilter] || queueFilter}</strong>
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
          statusValue={enableStatusFilter ? statusFilter : ""}
          statusOptions={
            enableStatusFilter
              ? [{ value: "", label: "All Status" }, ...statuses.map((s) => ({ value: s, label: s }))]
              : undefined
          }
          onStatusChange={enableStatusFilter ? setStatusFilter : undefined}
        />
      </FinancePageHeader>

      <FinanceDataTable
        columns={tableColumns}
        rows={filteredRows}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${statusFilter}|${queueFilter}`}
        loading={loading}
        emptyMessage="No records found."
        getRowKey={(row) => row.name}
        onRowClick={(row) => openDetail(row.name)}
      />
    </div>
  );
}

export function DeliveryNotePage() {
  return (
    <ChainDocInner
      title="Delivery Notes"
      listMethod="finance_app.api.document_chains.get_delivery_notes"
      getMethod="finance_app.api.document_chains.get_delivery_note"
      createMethod="finance_app.api.document_chains.create_sales_invoice_from_delivery_note"
      createParamName="delivery_note"
      actionLabel="Create sales invoice"
      primaryField="customer"
      dateField="posting_date"
      pctField={null}
      pctLabel=""
      enableStatusFilter
      statusFilterOptions={DELIVERY_NOTE_FILTER_STATUSES}
      canCreateFromView={canCreateSalesInvoiceFromDeliveryNote}
      getCreateActionLabel={deliveryNoteActionLabel}
      useApprovalToast
      invoiceLabel="Sales Invoice"
      invoiceContext="delivery"
      showVerificationPanel
      confirmBeforeInvoiceCreate
      previewMethod="finance_app.api.document_chains.preview_sales_invoice_from_delivery_note"
      previewParamName="delivery_note"
      modalTitle="Confirm Sales Invoice"
      sourceLabel="Delivery Note"
      sourceSecondaryLabel="Sales Order"
      sourceSecondaryField="sales_order"
      verifyMethod="finance_app.api.document_chains.mark_delivery_note_verified"
      verifyParamName="delivery_note"
      auditDoctype="Delivery Note"
      columns={[
        { key: "name", label: "ID" },
        { key: "customer", label: "Customer" },
        { key: "posting_date", label: "Posting" },
        { key: "status", label: "Status" },
        { key: "grand_total", label: "Amount", fmt: fmt },
      ]}
    />
  );
}

export function PurchaseReceiptPage() {
  return (
    <ChainDocInner
      title="Purchase Receipts"
      createPermissionAction="canCreatePurchaseChain"
      listMethod="finance_app.api.document_chains.get_purchase_receipts"
      getMethod="finance_app.api.document_chains.get_purchase_receipt"
      createMethod="finance_app.api.document_chains.create_purchase_invoice_from_purchase_receipt"
      createParamName="purchase_receipt"
      actionLabel="Create purchase invoice"
      primaryField="supplier"
      dateField="posting_date"
      pctField={null}
      pctLabel=""
      enableStatusFilter
      statusFilterOptions={PURCHASE_RECEIPT_FILTER_STATUSES}
      canCreateFromView={canCreatePurchaseInvoiceFromPurchaseReceipt}
      getCreateActionLabel={purchaseReceiptActionLabel}
      useApprovalToast
      invoiceLabel="Purchase Invoice"
      invoiceContext="receipt"
      confirmBeforeInvoiceCreate
      previewMethod="finance_app.api.document_chains.preview_purchase_invoice_from_purchase_receipt"
      previewParamName="purchase_receipt"
      modalTitle="Confirm Purchase Invoice"
      sourceLabel="Purchase Receipt"
      sourceSecondaryLabel="Purchase Order"
      sourceSecondaryField="purchase_order"
      auditDoctype="Purchase Receipt"
      columns={[
        { key: "name", label: "ID" },
        { key: "supplier", label: "Supplier" },
        { key: "posting_date", label: "Posting" },
        { key: "status", label: "Status" },
        { key: "grand_total", label: "Amount", fmt: fmt },
      ]}
    />
  );
}
