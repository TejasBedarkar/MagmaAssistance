import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { callMethodGet } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinanceDocumentHeader from "../components/FinanceDocumentHeader.jsx";
import FinanceItemsTable from "../components/FinanceItemsTable.jsx";
import FinanceBomBreakdownTable from "../components/FinanceBomBreakdownTable.jsx";
import FinanceOrderPreviewPanel from "../components/FinanceOrderPreviewPanel.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinanceTaxesSection from "../components/FinanceTaxesSection.jsx";
import FinanceVerificationChecklist from "../components/FinanceVerificationChecklist.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { financeFmt } from "../lib/financeFmt.js";
import { financeViewTableColumn } from "../components/FinanceViewAction.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { SALES_ORDER_FILTER_STATUSES, mergeStatusOptions } from "../lib/statusFilters.js";
import { callMethodWithTimeout, toMethodGetUrl } from "../lib/methodUrl.js";

const fmt = financeFmt;
const CREATE_TIMEOUT_MS = 120000;

const SO_STATUS_TONE = {
  Draft: "default",
  Completed: "success",
  "To Bill": "warn",
  "To Deliver and Bill": "info",
  "To Deliver": "info",
  Cancelled: "danger",
};

const PIPELINE_LABELS = {
  awaiting_submit: "Awaiting submit",
  sent_to_finance: "Handed off from Sales",
  awaiting_finance_flag: "Awaiting Finance flag",
  ready_for_delivery_note: "Ready for Delivery Note",
  delivery_note_created: "Delivery Note created",
  finance_verify: "Delivery Note — verify",
};

const READINESS_TONE = {
  ready: "success",
  fully_delivered: "success",
  dn_in_progress: "info",
  awaiting_fg: "warn",
  awaiting_inventory: "warn",
  awaiting_reservation: "warn",
  default: "default",
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const readinessKey = (doc) => {
  if (!doc) return "default";
  if (doc.delivery_complete || toNumber(doc.per_delivered) >= 100) return "fully_delivered";
  if (
    doc.delivery_note_in_progress ||
    doc.latest_delivery_note ||
    doc.pipeline_step === "finance_verify" ||
    doc.pipeline_step === "delivery_note_created"
  ) {
    return "dn_in_progress";
  }
  if (doc.delivery_ready) return "ready";
  const prod = doc.production_completion || {};
  if (prod.make_to_order && !prod.finished_goods_ready) return "awaiting_fg";
  if (prod.make_to_order && !prod.fg_stock_received) return "awaiting_inventory";
  return "awaiting_reservation";
};

const readinessLabel = (doc) => {
  const key = readinessKey(doc);
  if (key === "ready") return "Ready for DN";
  if (key === "fully_delivered") return "Fully delivered";
  if (key === "dn_in_progress") return "Delivery Note in progress";
  if (key === "awaiting_fg") return "Awaiting FG";
  if (key === "awaiting_inventory") return "Awaiting inventory";
  return "Awaiting reservation";
};

const canCreateDeliveryNote = (doc) => {
  if (!doc) return false;
  if (doc.can_create_delivery_note === false) return false;
  if (!doc.delivery_ready) return false;
  if (toNumber(doc.per_delivered) >= 100) return false;
  return (doc.items || []).some((it) => toNumber(it.delivered_qty) < toNumber(it.qty));
};

const deliveryNoteButtonLabel = (doc, acting) => {
  if (acting) return "Working…";
  if (!canCreateDeliveryNote(doc)) {
    if (toNumber(doc?.per_delivered) >= 100) return "Fully delivered";
    if (!doc?.delivery_ready) return "Not ready for delivery";
    return "Cannot create DN";
  }
  return "Review & create delivery note";
};

function DeliveryReadinessPanel({ doc }) {
  const prod = doc.production_completion || {};
  const tone = READINESS_TONE[readinessKey(doc)] || READINESS_TONE.default;

  return (
    <div className="finance-control-section">
      <h3 className="finance-control-section__title">Delivery readiness</h3>
      <div className="finance-field-grid--auto">
        <div>
          <div className="finance-field-label">STATUS</div>
          <StatusPill tone={tone}>{readinessLabel(doc)}</StatusPill>
        </div>
        {doc.pipeline_step ? (
          <div>
            <div className="finance-field-label">PIPELINE</div>
            <div className="finance-field-value">
              {PIPELINE_LABELS[doc.pipeline_step] || doc.pipeline_step}
            </div>
          </div>
        ) : null}
        {prod.linked_work_order ? (
          <div>
            <div className="finance-field-label">WORK ORDER</div>
            <div className="finance-field-value">{prod.linked_work_order}</div>
          </div>
        ) : null}
        {prod.make_to_order ? (
          <>
            <div>
              <div className="finance-field-label">FG READY</div>
              <div className="finance-field-value">{prod.finished_goods_ready ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="finance-field-label">INVENTORY UPDATED</div>
              <div className="finance-field-value">{prod.fg_stock_received ? "Yes" : "No"}</div>
            </div>
          </>
        ) : null}
      </div>
      {!doc.delivery_ready && doc.delivery_block_reason ? (
        <p className="finance-detail-sub finance-detail-sub--warning finance-text-sm--flush">
          {doc.delivery_block_reason}
        </p>
      ) : null}
      {doc.delivery_complete || toNumber(doc.per_delivered) >= 100 ? (
        <p className="finance-detail-sub finance-detail-sub--success finance-text-sm--flush">
          Delivery is complete on this order. Continue under Delivery Notes (verify / invoice) or Payment
          Entries if billing is pending.
        </p>
      ) : null}
      {!doc.delivery_complete &&
      toNumber(doc.per_delivered) < 100 &&
      (doc.delivery_note_in_progress || doc.latest_delivery_note) ? (
        <p className="finance-detail-sub finance-detail-sub--success finance-text-sm--flush">
          {doc.latest_delivery_note
            ? `Delivery Note ${doc.latest_delivery_note} exists — verify and invoice under Delivery Notes.`
            : "A Delivery Note exists for this order — continue under Delivery Notes."}
        </p>
      ) : null}
      {doc.delivery_ready ? (
        <p className="finance-detail-sub finance-detail-sub--success finance-text-sm--flush">
          Finished goods and inventory checks passed — review details, then create the Delivery Note.
        </p>
      ) : null}
    </div>
  );
}

function DeliveryNoteConfirmModal({ open, salesOrder, onClose, onCreated, showToast }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !salesOrder) {
      setPreview(null);
      return undefined;
    }

    let cancelled = false;
    const fetchPreview = async () => {
      setLoading(true);
      try {
        const msg = await callMethodGet(
          toMethodGetUrl("finance_app.api.document_chains.preview_delivery_note_from_sales_order", {
            sales_order: salesOrder,
          })
        );
        if (cancelled) return;
        if (msg?.status === "error") {
          showToast(msg.message || "Could not load preview.");
          setPreview(null);
        } else {
          setPreview(msg);
        }
      } catch (e) {
        if (!cancelled) showToast(e.message || "Could not load preview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [open, salesOrder, showToast]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const m = await callMethodWithTimeout(
        "finance_app.api.document_chains.create_delivery_note_from_sales_order",
        { sales_order: salesOrder, set_warehouse: preview?.set_warehouse || "" },
        CREATE_TIMEOUT_MS
      );
      if (m?.status === "success") {
        showToast(m.message || "Delivery Note created.");
        onCreated?.();
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

  return (
    <Modal
      wide
      title={`Confirm Delivery Note — ${salesOrder}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="pm-btn pm-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="pm-btn pm-btn-primary"
            disabled={loading || submitting || !preview?.items?.length}
            onClick={handleConfirm}
          >
            {submitting ? "Submitting…" : "Create & submit Delivery Note"}
          </button>
        </>
      )}
    >
      {loading && !preview ? (
        <p className="finance-cell-muted">Loading preview…</p>
      ) : null}
      <FinanceOrderPreviewPanel preview={preview} loading={loading && !preview} />
    </Modal>
  );
}

const QUEUE_LABELS = {
  awaiting_fg: "Awaiting FG / inventory",
  ready_for_dn: "Ready for Delivery Note",
  fully_paid: "Fully paid",
  awaiting_payment: "Awaiting payment",
};

export default function SalesOrderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueFilter = searchParams.get("queue") || "";
  const openName = searchParams.get("open") || "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.document_chains.get_sales_orders", params)
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

  const openDetail = useCallback(async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.document_chains.get_sales_order", { name })
      );
      if (message?.status === "error") {
        showToast(message.message || "Could not load document.");
        return;
      }
      if (message?.name) setView(message);
      else showToast("Could not load document.");
    } catch {
      showToast("Could not load document.");
    }
  }, [showToast]);

  useEffect(() => {
    if (openName) openDetail(openName);
  }, [openName, openDetail]);

  const clearQueueFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("queue");
    setSearchParams(next, { replace: true });
  };

  const statuses = mergeStatusOptions(
    SALES_ORDER_FILTER_STATUSES,
    rows.map((r) => r.status)
  );
  const filteredRows = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  const columns = useMemo(
    () => [
      {
        key: "name",
        label: "ID",
        render: (row) => <span className="finance-cell-accent">{row.name}</span>,
      },
      {
        key: "customer",
        label: "Customer",
        render: (row) => row.customer_name || row.customer,
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
          <StatusPill tone={SO_STATUS_TONE[row.status] || "default"}>{row.status || "Draft"}</StatusPill>
        ),
      },
      {
        key: "grand_total",
        label: "Amount",
        render: (row) => <span className="finance-cell-success">{fmt(row.grand_total)}</span>,
      },
      {
        key: "per_delivered",
        label: "% Del.",
        render: (row) => (row.per_delivered != null ? `${row.per_delivered}%` : "—"),
      },
      financeViewTableColumn({ key: "_view" }),
    ],
    []
  );

  if (view) {
    const allowCreateDeliveryNote = canCreateDeliveryNote(view);
    const shipping = view.shipping || {};

    return (
      <div className="pm-page finance-page">
        <DeliveryNoteConfirmModal
          open={confirmOpen}
          salesOrder={view.name}
          onClose={() => setConfirmOpen(false)}
          onCreated={() => {
            setView(null);
            load();
          }}
          showToast={showToast}
        />
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setView(null)}>
          ← Back to list
        </button>
        <div className="pm-card">
          <FinanceDocumentHeader
            title={view.name}
            subtitle={`Customer: ${view.customer_name || view.customer}`}
            status={
              <StatusPill tone={READINESS_TONE[readinessKey(view)] || READINESS_TONE.default}>
                {readinessLabel(view)}
              </StatusPill>
            }
            actions={
              <FinanceCan action="canCreateSalesChain">
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  disabled={!allowCreateDeliveryNote}
                  onClick={() => setConfirmOpen(true)}
                >
                  {deliveryNoteButtonLabel(view, false)}
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
              <div className="finance-field-label">% DELIVERED</div>
              <div className="finance-field-value">
                {view.per_delivered != null ? `${view.per_delivered}%` : "—"}
              </div>
            </div>
            <div>
              <div className="finance-field-label">GRAND TOTAL</div>
              <div className="finance-field-value finance-field-value--success">{fmt(view.grand_total)}</div>
            </div>
          </div>

          <FinanceVerificationChecklist fields={view.finance_verify_fields} title="Pre-delivery review" />
          <DeliveryReadinessPanel doc={view} />

          {(shipping.shipping_address || shipping.set_warehouse) ? (
            <div className="finance-control-section">
              <h3 className="finance-control-section__title">Shipping</h3>
              <div className="finance-field-grid--stats">
                {shipping.set_warehouse ? (
                  <div>
                    <div className="finance-field-label">DEFAULT WAREHOUSE</div>
                    <div className="finance-field-value">{shipping.set_warehouse}</div>
                  </div>
                ) : null}
                {shipping.shipping_address ? (
                  <div>
                    <div className="finance-field-label">SHIP TO</div>
                    <div className="finance-field-value finance-field-value--sm">{shipping.shipping_address}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="finance-control-section">
            <h3 className="finance-control-section__title finance-control-section__title--items">
              Items {view.delivery_lines?.length ? "(qty to deliver)" : ""}
            </h3>
            <FinanceItemsTable
              items={view.delivery_lines?.length ? view.delivery_lines : view.items}
              qtyKey={view.delivery_lines?.length ? "qty_to_deliver" : "qty"}
              emptyMessage="No items on this order."
            />
          </div>

          <FinanceBomBreakdownTable items={view.bom_items} total={view.bom_total} />

          <FinanceTaxesSection
            taxes={view.taxes}
            taxesTemplate={view.taxes_and_charges}
            netTotal={view.net_total}
            totalTaxes={view.total_taxes}
            grandTotal={view.grand_total}
            emptyMessage="No tax lines on this order."
          />

          {view.latest_delivery_note ? (
            <p className="finance-detail-sub finance-detail-sub--success">
              Latest Delivery Note: {view.latest_delivery_note} — verify under Delivery Notes before invoicing.
            </p>
          ) : null}
          <FinanceDocumentHistory doctype="Sales Order" name={view.name} showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">
      <FinancePageHeader title="Sales Orders">
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
          statusValue={statusFilter}
          statusOptions={[
            { value: "", label: "All Status" },
            ...statuses.map((s) => ({ value: s, label: s })),
          ]}
          onStatusChange={setStatusFilter}
        />
      </FinancePageHeader>

      <FinanceDataTable
        columns={columns}
        rows={filteredRows}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${statusFilter}|${queueFilter}`}
        loading={loading}
        emptyMessage="No sales orders handed off from Sales yet."
        getRowKey={(row) => row.name}
        onRowClick={(row) => openDetail(row.name)}
      />
    </div>
  );
}
