import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { HiOutlineShoppingCart } from "react-icons/hi2";
import api, { prefetchCsrf } from "../../lib/apiUtils";
import ListFilters from "../../../../common/components/ListFilters.jsx";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesModalFooter from "../../components/SalesModalFooter.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { toFriendlyError } from "../../lib/apiUtils";
import { financeDeliveryNotePath, salesOrderCreatedToast } from "../../lib/salesWorkflowNav.js";
import useDebouncedValue from "../../lib/useDebouncedValue.js";
import { explodeBomForItem } from "../../../supply_chain/api/bom.js";
import { CONSUME_OPERATION_OPTIONS } from "../../../supply_chain/utils/consumeOperations.js";

const SO_INVENTORY_RESERVATION_API =
  "/api/method/sales_app.api.sales_order.get_sales_order_inventory_reservation";
const SO_FINANCE_DELIVERY_API =
  "/api/method/sales_app.api.sales_order.get_sales_order_finance_delivery_handoff";
const SO_FINANCE_PAYMENT_API =
  "/api/method/sales_app.api.sales_order.get_sales_order_finance_payment_handoff";
const SO_MANUFACTURING_PIPELINE_API =
  "/api/method/sales_app.api.sales_order.get_sales_order_manufacturing_pipeline";
const SO_CREATE_WORK_ORDER_API =
  "/api/method/sales_app.api.sales_order.create_work_order_for_sales_order";
const SO_CREATE_DELIVERY_NOTE_API =
  "/api/method/sales_app.api.sales_order.create_delivery_note_from_sales_order";

const SO_MFG_PIPELINE_POLL_MS = 30000;
const SO_INVENTORY_POLL_MS = 30000;
const SO_FINANCE_DELIVERY_POLL_MS = 30000;
const SO_FINANCE_PAYMENT_POLL_MS = 30000;

function fmtStockQty(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function salesOrderBomItems(order) {
  return (order?.bom_items || []).filter((row) => String(row?.item_code || "").trim());
}

/** Manufacturing UI only for BOM / work-order / make-to-order orders — not plain New Order sales. */
function salesOrderNeedsManufacturingPanel(order, pipeline = {}) {
  if (!order) return false;
  const data = pipeline || order?.manufacturing_pipeline || {};
  if (order.linked_work_order || data.work_order) return true;
  if (salesOrderBomItems(order).length > 0) return true;
  if (String(order.deliverable || "").trim()) return true;
  if (Boolean(order?.inventory_reservation?.production_completion?.make_to_order)) return true;
  return false;
}

const greenDim = C.greenDim;
const greenMid = C.tealMid;
const blueDim = C.blueDim;
const amberDim = C.amberDim;
const redDim = C.redDim;
const purpleDim = C.purpleDim;

const STATUS_STYLE = {
  "Draft":                { fg: C.muted,     bg: C.surface2 },
  "To Deliver and Bill":  { fg: C.amber,   bg: C.amberDim },
  "To Deliver":           { fg: C.cyan,    bg: C.cyanDim },
  "To Bill":              { fg: C.blue,    bg: C.blueDim },
  "Completed":            { fg: C.green,   bg: C.greenDim },
  "Cancelled":            { fg: C.red,     bg: C.redDim },
  "Closed":               { fg: C.muted,   bg: C.surface2 },
  "On Hold":              { fg: C.purple,  bg: C.purpleDim },
};

const DELIVERY_STYLE = {
  "Not Delivered":       { fg: C.red,    bg: C.redDim },
  "Partially Delivered": { fg: C.amber,  bg: C.amberDim },
  "Fully Delivered":     { fg: C.green,  bg: C.greenDim },
};

const BILLING_STYLE = {
  "Not Billed":       { fg: C.red,   bg: C.redDim },
  "Partially Billed": { fg: C.amber, bg: C.amberDim },
  "Fully Billed":     { fg: C.green, bg: C.greenDim },
};

/** Statuses shown in the toolbar filter (matches Sales Order workflow). */
const SO_FILTER_STATUSES = [
  "Draft",
  "To Deliver and Bill",
  "To Deliver",
  "To Bill",
  "Completed",
  "Cancelled",
];

const SO_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...SO_FILTER_STATUSES.map((s) => ({ value: s, label: s })),
];

const fmt  = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const RECENT_DAYS = 7;

const isDraftOrder = (o) => o?.docstatus === 0 || o?.status === "Draft";

const isRecentOrder = (o, days = RECENT_DAYS) => {
  if (!o?.creation) return false;
  const created = new Date(String(o.creation).replace(" ", "T"));
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return created >= cutoff;
};

const formatCreated = (creation) => {
  if (!creation) return "—";
  const s = String(creation);
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return `Today ${s.slice(11, 16)}`;
  return s.slice(0, 16).replace("T", " ");
};

const WORKFLOW_STEPS = [
  { id: "draft", label: "Draft", hint: "Save order" },
  { id: "submit", label: "Order confirmed", hint: "Customer confirmed" },
  { id: "reserved", label: "Stock blocked", hint: "Supply Chain reserve" },
  { id: "dispatch", label: "Ready for dispatch", hint: "Delivery Note" },
];

function canEditOrder(order) {
  return isDraftOrder(order);
}

function workflowStepState(order) {
  if (!order) return 0;
  if (order.status === "Cancelled" || order.status === "Closed") return -1;
  const inv = order.inventory_reservation || {};
  const stage = String(inv.reservation_stage || "").trim();
  const makeToOrder = Boolean(inv.production_completion?.make_to_order);
  if (isDraftOrder(order)) return 0;
  if (makeToOrder) {
    if (stage === "ready_for_dispatch" || stage === "fully_delivered" || order.status === "Completed") return 4;
    if (stage === "awaiting_fg_receipt") return 3;
    if (stage === "awaiting_fg_production" || stage === "stock_blocked") return 2;
    if (stage === "reserved" || inv.order_confirmed) return 1;
    return order.docstatus === 1 ? 1 : 0;
  }
  if (stage === "ready_for_dispatch" || stage === "fully_delivered" || order.status === "Completed") return 3;
  if (stage === "stock_blocked") return 2;
  if (stage === "reserved" || inv.order_confirmed) return 1;
  return order.docstatus === 1 ? 1 : 0;
}

/** Primary order KPIs shown on the page (one row). */
const KPI_SPECS = [
  { id: "total", label: "Total Value", accent: C.green, icon: "briefcase", valueKey: "total_val", countKey: "total", valueFmt: "money", sub: (d) => `${d?.total || 0} orders` },
  {
    id: "active",
    label: "Active Orders",
    accent: C.blue,
    icon: "refresh",
    valueFmt: "count",
    value: (d) => Math.max(
      Number(d?.total || 0)
        - Number(d?.completed || 0)
        - Number(d?.cancelled || 0)
        - Number(d?.draft || 0),
      0,
    ),
    sub: () => "To deliver / bill",
  },
  { id: "to_deliver", label: "To Deliver", accent: C.cyan, icon: "truck", valueKey: null, countKey: "to_deliver", valueFmt: "count", sub: () => "Pending delivery" },
  { id: "to_bill", label: "To Bill", accent: C.indigo, icon: "invoice", valueKey: null, countKey: "to_bill", valueFmt: "count", sub: () => "Pending billing" },
];

const ORDER_TABS = [
  { id: "recent", label: "Recently created" },
  { id: "all", label: "All orders" },
];

function kpiDisplayValue(spec, dash) {
  if (spec.valueFmt === "money") return fmtK(dash?.[spec.valueKey] || 0);
  const count = typeof spec.value === "function" ? spec.value(dash) : dash?.[spec.countKey];
  const numericCount = Number(count || 0);
  return numericCount > 0 ? numericCount : "—";
}

function stripHtml(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function frappeErrorMessage(err, fallback = "Request failed.") {
  const data = err?.response?.data;
  if (data?._server_messages) {
    try {
      const raw = JSON.parse(data._server_messages);
      const parts = (Array.isArray(raw) ? raw : [raw]).map((entry) => {
        const o = typeof entry === "string" ? JSON.parse(entry) : entry;
        return stripHtml(o?.message || String(entry));
      }).filter(Boolean);
      if (parts.length) return parts.join(" · ");
    } catch {
      /* ignore */
    }
  }
  if (data?.exception && typeof data.exception === "string") {
    const exc = data.exception.replace(/^[\w.]+:\s*/, "").trim();
    if (exc) return stripHtml(exc);
  }
  if (data?.message && typeof data.message === "string") {
    const msg = stripHtml(data.message);
    if (msg) return msg;
  }
  const status = err?.response?.status;
  if (status === 417 && !data?._server_messages && !data?.exception) {
    return "API not available (417). Restart the bench (`bench restart`) and confirm the sales_app is installed on this site.";
  }
  return fallback;
}

const initItem = { item_code: "", qty: 1, rate: 0, uom: "Nos", warehouse: "", delivery_date: "" };
const emptyBomRow = () => ({
  item_code: "",
  item_name: "",
  required_qty: 1,
  rate: 0,
  consume_at_operation: "",
  uom: "Nos",
});

/** Merge exploded BOM lines; preserve user step/rate per item_code when re-scaling. */
function mergeExplodedBomRows(currentRows, explosionItems) {
  if (!explosionItems?.length) return null;
  const preserved = new Map();
  for (const row of currentRows || []) {
    const code = String(row.item_code || "").trim();
    if (!code) continue;
    preserved.set(code, {
      consume_at_operation: (row.consume_at_operation || "").trim() ? row.consume_at_operation : "",
      rate: Number(row.rate) || 0,
    });
  }
  return explosionItems.map((item) => {
    const code = String(item.item_code || "").trim();
    const prev = preserved.get(code);
    return {
      item_code: code,
      item_name: item.item_name || "",
      required_qty: Number(item.qty) || 0,
      rate: prev && prev.rate > 0 ? prev.rate : (Number(item.rate) || 0),
      consume_at_operation: (prev?.consume_at_operation || "").trim()
        ? prev.consume_at_operation
        : (item.consume_at_operation || ""),
      uom: item.uom || "Nos",
    };
  });
}
const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"];
const initForm = {
  customer: "",
  deliverable: "",
  qty: 1,
  priority: "Medium",
  delivery_date: "",
  order_type: "Sales",
  po_no: "",
  note: "",
  bom_items: [emptyBomRow()],
  items: [{ ...initItem }],
};

function mapOrderToEditForm(d) {
  if (!d) return null;
  const items =
    d.items?.length > 0
      ? d.items.map((it) => ({
          item_code: it.item_code || "",
          qty: it.qty ?? 1,
          rate: it.rate ?? 0,
          uom: it.uom || "Nos",
          warehouse: it.warehouse || "",
          delivery_date: it.delivery_date || d.delivery_date || "",
        }))
      : [{ ...initItem }];
  return {
    name: d.name,
    docstatus: d.docstatus,
    status: d.status,
    customer: d.customer || "",
    deliverable: d.deliverable || items[0]?.item_code || "",
    qty: d.deliverable ? (Number(d.total_qty) || items[0]?.qty || 1) : (items[0]?.qty ?? 1),
    priority: d.priority || "Medium",
    delivery_date: d.delivery_date || "",
    order_type: d.order_type || "Sales",
    po_no: d.po_no || "",
    note: d.note || "",
    bom_items: (d.bom_items?.length ? d.bom_items : [emptyBomRow()]).map((row) => {
      const qty = Number(row.required_qty) || 1;
      const amount = Number(row.amount) || 0;
      const storedRate = Number(row.rate);
      return {
        item_code: row.item_code || "",
        item_name: row.item_name || "",
        required_qty: qty,
        rate: Number.isFinite(storedRate) && storedRate > 0
          ? storedRate
          : (qty > 0 && amount > 0 ? amount / qty : 0),
        consume_at_operation: row.consume_at_operation || "",
      };
    }),
    items,
  };
}

/* ─── Status Pill ────────────────────────────────────────────── */
const Pill = ({ label, styleMap }) => {
  const { fg, bg } = (styleMap || {})[label] || { fg: C.muted, bg: C.surface2 };
  return (
    <span className="so-status-pill" style={{ "--pill-fg": fg, "--pill-bg": bg, "--pill-bd": `${fg}44` }}>
      {label || "—"}
    </span>
  );
};

function SoWorkflowStrip({ order }) {
  const active = workflowStepState(order);
  if (active < 0) {
    return (
      <div className="so-workflow so-workflow--muted">
        <span>Order is {order?.status}. Workflow actions are not available.</span>
      </div>
    );
  }
  return (
    <div className="so-workflow" aria-label="Order workflow">
      {WORKFLOW_STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div
            key={step.id}
            className={`so-wf-step${done ? " so-wf-step--done" : ""}${current ? " so-wf-step--current" : ""}`}
          >
            <span className="so-wf-dot">{done ? "✓" : i + 1}</span>
            <span className="so-wf-label">{step.label}</span>
            <span className="so-wf-hint">{step.hint}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Toast ──────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function SalesOrderDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openedFromUrlRef = useRef("");
  const [dash, setDash]       = useState(null);
  const [orders, setOrders]   = useState([]);
  const [opts, setOpts]       = useState({ customers: [], items: [], warehouses: [], order_type: [], status: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [viewOrder, setViewOrder]   = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [editOrder, setEditOrder]   = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const [form, setForm]       = useState(initForm);
  const [saving, setSaving]   = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [orderTab, setOrderTab] = useState("recent");
  /** @deprecated use orderTab — kept so stale HMR bundles do not throw listView is not defined */
  const listView = orderTab;
  const setListView = setOrderTab;
  const [workflowBusy, setWorkflowBusy] = useState(null);
  const tableRef = useRef(null);

  const { toast, showToast } = useSalesToast(3200);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dR, oR, opR] = await Promise.all([
        api.get("/api/method/sales_app.api.sales_order.dashboard_data"),
        api.get("/api/method/sales_app.api.sales_order.get_sales_orders"),
        api.get("/api/method/sales_app.api.sales_order.get_options"),
      ]);
      setDash(dR.data.message);
      setOrders(oR.data.message || []);
      if (opR.data.message) setOpts(opR.data.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { prefetchCsrf().catch(() => {}); }, []);

  useEffect(() => {
    if (loading) return;
    const openId = String(searchParams.get("open") || "").trim();
    if (!openId || openedFromUrlRef.current === openId) return;

    const openFromUrl = async () => {
      openedFromUrlRef.current = openId;
      const inList = orders.find((o) => o.name === openId);
      if (inList) {
        setViewOrder(inList);
      } else {
        try {
          const res = await api.get("/api/method/sales_app.api.sales_order.get_sales_order", {
            params: { name: openId },
          });
          const doc = res.data?.message;
          if (doc) setViewOrder(doc);
          else showToast(`Sales order ${openId} not found.`, "error");
        } catch {
          showToast(`Sales order ${openId} not found.`, "error");
        }
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("open");
      setSearchParams(nextParams, { replace: true });
    };

    void openFromUrl();
  }, [loading, orders, searchParams, setSearchParams, showToast]);

  const openNewOrderForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      ...initForm,
      delivery_date: today,
      items: [{ ...initItem }],
      bom_items: [emptyBomRow()],
    });
    setShowForm(true);
  };

  const post = (url, data) => {
    const p = new URLSearchParams();
    Object.entries(data).forEach(([k, v]) => {
      if (v !== "" && v != null)
        p.append(k, typeof v === "object" ? JSON.stringify(v) : v);
    });
    return api.post(url, p, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  };

  const saveOrder = async () => {
    if (!form.customer) return;
    let lineItems = form.items
      .filter((it) => String(it.item_code || "").trim())
      .map((it) => ({
        ...it,
        qty: Math.max(1, Number(it.qty) || 1),
        rate: Number(it.rate) || 0,
        uom: (it.uom || "Nos").trim() || "Nos",
      }));
    if (!lineItems.length) {
      showToast("Add at least one line item with a product.", "error");
      return;
    }
    const bomPayload = (form.bom_items || [])
      .filter((row) => String(row.item_code || "").trim())
      .map((row) => {
        const qty = Math.max(0, Number(row.required_qty) || 0);
        const rate = Math.max(0, Number(row.rate) || 0);
        return {
          item_code: row.item_code.trim(),
          item_name: (row.item_name || "").trim() || undefined,
          required_qty: qty,
          amount: qty * rate,
          ...(row.consume_at_operation ? { consume_at_operation: row.consume_at_operation } : {}),
        };
      })
      .filter((row) => row.required_qty > 0);
    const firstLine = lineItems[0];
    const deliverable = String(firstLine.item_code || "").trim();
    const mfgQty = Math.max(1, Number(firstLine.qty) || 1);
    const shouldSendMfg = bomPayload.length > 0;
    setSaving(true);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.sales_order.create_sales_order", {
        customer: form.customer,
        delivery_date: form.delivery_date,
        order_type: "Sales",
        note: form.note,
        items: lineItems,
        submit: 1,
        ...(shouldSendMfg
          ? {
              deliverable,
              qty: mfgQty,
              priority: form.priority || "Medium",
              bom_items: bomPayload,
              create_work_order: opts.manufacturing_available ? 1 : 0,
            }
          : {}),
      });
      const msg = res?.data?.message;
      const name = msg?.name;
      setShowForm(false);
      setForm(initForm);
      await loadAll();
      if (!name) throw new Error("Sales order failed");
      showToast(salesOrderCreatedToast(), "success", 3200);
    } catch (err) {
      showToast(frappeErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const updateOrder = async () => {
    if (!editOrder?.name) return;
    if (!canEditOrder(editOrder)) {
      showToast(
        "Only draft orders can be edited. Submitted orders must be amended in ERPNext desk.",
        "warn",
        7000,
      );
      setEditOrder(null);
      return;
    }
    const validItems = (editOrder.items || [])
      .filter((it) => String(it.item_code || "").trim())
      .map((it) => ({
        ...it,
        qty: Math.max(1, Number(it.qty) || 1),
        rate: Number(it.rate) || 0,
        uom: (it.uom || "Nos").trim() || "Nos",
      }));
    setSaving(true);
    try {
      await prefetchCsrf().catch(() => {});
      await post("/api/method/sales_app.api.sales_order.update_sales_order", {
        name:          editOrder.name,
        customer:      editOrder.customer,
        delivery_date: editOrder.delivery_date,
        note:          editOrder.note,
        items:         validItems.length ? validItems : undefined,
      });
      setEditOrder(null);
      await loadAll();
      showToast(`Sales Order ${editOrder.name} updated`);
    } catch (err) {
      showToast(frappeErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const reloadOrderDetail = async (name) => {
    const res = await api.get("/api/method/sales_app.api.sales_order.get_sales_order", { params: { name } });
    const doc = res.data?.message;
    if (doc) setViewOrder(doc);
    return doc;
  };

  const submitSalesOrder = async (name) => {
    if (!name) return;
    setWorkflowBusy(`submit:${name}`);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post("/api/method/sales_app.api.sales_order.submit_sales_order", { name });
      const doc = res?.data?.message;
      await loadAll();
      if (viewOrder?.name === name && doc) setViewOrder(doc);
      else if (viewOrder?.name === name) await reloadOrderDetail(name);
      showToast(doc?.status ? `Submitted — now ${doc.status}` : "Sales Order submitted");
    } catch (err) {
      showToast(frappeErrorMessage(err, "Failed to submit sales order."), "error");
    } finally {
      setWorkflowBusy(null);
    }
  };

  const createDeliveryFromSalesOrder = async (name) => {
    if (!name) return;
    setWorkflowBusy(`dispatch:${name}`);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await post(SO_CREATE_DELIVERY_NOTE_API, { name, submit: 1, auto_receive_stock: 0 });
      const msg = res?.data?.message || {};
      await loadAll();
      if (viewOrder?.name === name) await reloadOrderDetail(name);
      if (msg?.status === "draft") {
        showToast(msg.message || `Delivery Note ${msg.delivery_note} saved as draft.`, "error");
      } else {
        showToast(msg.message || `Delivery Note ${msg.delivery_note} created.`);
      }
    } catch (err) {
      showToast(frappeErrorMessage(err, "Failed to create Delivery Note."), "error");
    } finally {
      setWorkflowBusy(null);
    }
  };

  const confirmDeleteOrder = async () => {
    if (!deleteTarget?.id) return;
    setDeleteLoading(true);
    try {
      await post("/api/method/sales_app.api.sales_order.delete_sales_order", { name: deleteTarget.id });
      setDeleteTarget(null);
      await loadAll();
      showToast("Sales Order deleted.", "error");
    } catch {
      showToast("Unable to delete sales order.", "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRowClick = (name) => {
    if (!name || viewLoading) return;
    openView(name);
  };

  const stopRowClick = (e) => {
    e.stopPropagation();
  };

  const openView = async (name) => {
    if (!name) return;
    setEditOrder(null);
    setShowForm(false);
    setViewOrder(null);
    setViewLoading(true);
    setActionBusy(name);
    try {
      const res = await api.get("/api/method/sales_app.api.sales_order.get_sales_order", { params: { name } });
      const doc = res.data?.message;
      if (!doc) {
        showToast("Could not load sales order.", "error");
        return;
      }
      setViewOrder(doc);
    } catch {
      showToast("Could not load sales order.", "error");
    } finally {
      setViewLoading(false);
      setActionBusy(null);
    }
  };

  const openEdit = async (name) => {
    if (!name) return;
    setViewOrder(null);
    setShowForm(false);
    setEditLoading(true);
    setActionBusy(name);
    try {
      const res = await api.get("/api/method/sales_app.api.sales_order.get_sales_order", { params: { name } });
      const doc = res.data?.message;
      if (!doc) {
        showToast("Could not load sales order for edit.", "error");
        return;
      }
      if (!canEditOrder(doc)) {
        showToast(
          "Only draft orders can be edited here. Open View to use Submit / Invoice / In Transit, or amend in ERPNext desk.",
          "warn",
          7000,
        );
        return;
      }
      const formData = mapOrderToEditForm(doc);
      if (!formData) {
        showToast("Could not load sales order for edit.", "error");
        return;
      }
      setEditOrder(formData);
    } catch {
      showToast("Could not load sales order for edit.", "error");
    } finally {
      setEditLoading(false);
      setActionBusy(null);
    }
  };

  const filtered = useMemo(() => orders.filter((o) => {
    if (orderTab === "recent" && !isRecentOrder(o)) return false;
    if (orderTab === "draft" && !isDraftOrder(o)) return false;
    const ms = [o.name, o.customer, o.status, o.order_type, o.billing_status, o.delivery_status, o.po_no]
      .join(" ").toLowerCase().includes(search.toLowerCase());
    const mf = !statusFilter || o.status === statusFilter;
    return ms && mf;
  }), [orders, search, statusFilter, orderTab]);

  const { page, setPage, totalPages, pageRows: pagedOrders, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const recentCount = useMemo(() => orders.filter((o) => isRecentOrder(o)).length, [orders]);

  const handleOrderTab = (tabId) => {
    setOrderTab(tabId);
    resetPage();
  };

  const onStatusChange = (v) => {
    setStatusFilter(v);
    resetPage();
  };

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  if (loading) return <SalesPageLoader label="Loading orders…" />;

  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page so-page">

        <section className="so-kpi-section" aria-label="Sales Order KPIs">
          <div className="so-kpi-section-row">
            <p className="so-kpi-section-label">Sales Order KPIs</p>
            <button type="button" className="pm-btn pm-btn-primary so-btn-primary" onClick={openNewOrderForm}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M12 5v14M5 12h14"/></svg>
              New Order
            </button>
          </div>
          <div className="so-kpi-grid">
            {KPI_SPECS.map((spec) => (
              <SalesKpiCard
                key={spec.id}
                label={spec.label}
                value={kpiDisplayValue(spec, dash)}
                sub={spec.sub(dash)}
                accent={spec.accent}
                icon={spec.icon}
              />
            ))}
          </div>
        </section>

        <div className="so-filter-bar">
          <ListFilters
            statusValue={statusFilter}
            statusOptions={SO_STATUS_OPTIONS}
            onStatusChange={onStatusChange}
            searchValue={search}
            onSearchChange={onSearchChange}
            searchPlaceholder="Search orders…"
          />
          {(search || statusFilter) ? (
            <button
              type="button"
              className="pm-btn pm-btn-ghost so-btn-ghost so-btn-compact"
              onClick={() => { setSearch(""); setStatusFilter(""); resetPage(); }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {/* ── ORDERS (tabbed: Recent / All / Draft) ── */}
        <div ref={tableRef} className="so-orders-panel">
          <div className="so-card">
            <div className="so-card-hd so-card-hd--tabs">
              <div className="so-panel-tabs" role="tablist" aria-label="Sales orders">
                {ORDER_TABS.map((tab) => {
                  const count = tab.id === "recent" ? recentCount : orders.length;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={orderTab === tab.id}
                      className={`so-panel-tab${orderTab === tab.id ? " so-panel-tab--active" : ""}`}
                      onClick={() => handleOrderTab(tab.id)}
                    >
                      {tab.label}
                      <span className="so-panel-tab-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="so-card-body so-card-body--flush">
              {filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineShoppingCart}
              title={search || statusFilter ? "No matching orders" : "No sales orders yet"}
              description={search || statusFilter ? "Adjust filters or clear the search." : 'Click "New Order" to create your first sales order in ERPNext.'}
            />
          ) : (
            <>
            <div className="sales-table-scroll">
              {orderTab === "recent" ? (
              <table className="so-table so-table-compact">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th className="sales-th-right">Total</th>
                    <th className="sales-th-center so-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrders.map((o) => (
                    <tr
                      key={o.name}
                      className="so-row so-row-clickable"
                      onClick={() => handleRowClick(o.name)}
                      title="Click to view sales order"
                    >
                      <td className="so-col-id">
                        <SalesDocumentId
                          id={o.name}
                          onClick={(e) => { stopRowClick(e); openView(o.name); }}
                        />
                      </td>
                      <td className="so-col-customer">{o.customer || "—"}</td>
                      <td className="so-col-date">{formatCreated(o.creation)}</td>
                      <td><Pill label={o.status} styleMap={STATUS_STYLE} /></td>
                      <td className="so-col-total sales-th-right">{fmt(o.grand_total)}</td>
                      <td className="so-col-actions" onClick={stopRowClick}>
                        <div className="so-actions">
                          {isDraftOrder(o) && (
                            <button
                              type="button"
                              className="so-act so-act-submit"
                              title="Submit order"
                              aria-label="Submit order"
                              disabled={!!workflowBusy}
                              onClick={() => submitSalesOrder(o.name)}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
                            </button>
                          )}
                          <button
                            type="button"
                            className="so-act so-act-view"
                            title="View order"
                            aria-label="View order"
                            onClick={() => openView(o.name)}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          {isDraftOrder(o) && (
                            <button
                              type="button"
                              className="so-act so-act-del"
                              title="Delete draft order"
                              aria-label="Delete draft order"
                              disabled={actionBusy === o.name}
                              onClick={() => setDeleteTarget({ id: o.name, label: o.name })}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              ) : (
              <table className={`pm-table so-table so-table--list${orderTab === "draft" ? " so-table--draft" : ""}`}>
                <thead>
                  <tr>
                    <th className="so-col-idx">#</th>
                    <th className="so-col-id">Order ID</th>
                    <th className="so-col-customer">Customer</th>
                    <th className="so-col-date">Order Date</th>
                    <th className="so-col-date so-col-delivery-date">Delivery Date</th>
                    <th className="so-col-total">Grand Total</th>
                    <th className="so-col-status">Status</th>
                    <th className="sales-th-center so-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrders.map((o, i) => {
                    const isOverdue = o.delivery_date && new Date(o.delivery_date) < new Date() && !["Completed", "Cancelled", "Closed"].includes(o.status);
                    const rowIdx = (page - 1) * pageSize + i;
                    return (
                      <tr
                        key={o.name}
                        className="so-row so-row-clickable"
                        style={{ "--i": rowIdx }}
                        onClick={() => handleRowClick(o.name)}
                        title="Click to view sales order"
                      >
                        <td className="so-td-idx so-col-idx">{rowIdx + 1}</td>
                        <td className="so-col-id">
                          <SalesDocumentId
                            id={o.name}
                            onClick={(e) => { stopRowClick(e); openView(o.name); }}
                          />
                          {o.po_no && <div className="so-po">PO: {o.po_no}</div>}
                        </td>
                        <td className="so-col-customer" title={o.customer || ""}>{o.customer || "—"}</td>
                        <td className="so-col-date">{o.transaction_date || "—"}</td>
                        <td className="so-col-date so-col-delivery-date">
                          <span className={`so-td-late${isOverdue ? " so-td-late--overdue" : ""}`}>
                            {o.delivery_date || "—"}
                            {isOverdue ? <span className="so-late-tag">LATE</span> : null}
                          </span>
                        </td>
                        <td className="so-col-total">{fmt(o.grand_total)}</td>
                        <td className="so-col-status">
                          <Pill label={o.status} styleMap={STATUS_STYLE} />
                        </td>
                        <td className="so-col-actions" onClick={stopRowClick}>
                          <div className="so-actions">
                            {isDraftOrder(o) && (
                              <button
                                type="button"
                                className="so-act so-act-submit"
                                title="Submit order"
                                disabled={actionBusy === o.name || workflowBusy === `submit:${o.name}`}
                                onClick={() => submitSalesOrder(o.name)}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
                              </button>
                            )}
                            <button
                              type="button"
                              className="so-act so-act-view"
                              title="View order"
                              disabled={actionBusy === o.name}
                              onClick={() => openView(o.name)}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            {isDraftOrder(o) && (
                              <button
                                type="button"
                                className="so-act so-act-edit"
                                title="Edit draft order"
                                disabled={actionBusy === o.name || editLoading}
                                onClick={() => openEdit(o.name)}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            )}
                            {isDraftOrder(o) && (
                            <button
                              type="button"
                              className="so-act so-act-del"
                              title="Delete draft order"
                              disabled={actionBusy === o.name}
                              onClick={() => setDeleteTarget({ id: o.name, label: o.name })}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              )}
            </div>
            {filtered.length > 0 && (
              <div className="sales-table-pagination">
                <label className="sales-table-pagination__size">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    aria-label="Rows per page"
                    className="sales-table-pagination__select"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) {
                        setPageSize(n);
                        resetPage();
                      }
                    }}
                  >
                    {SALES_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </div>
            )}
            </>
          )}
            </div>
          </div>
        </div>

      </div>

      {/* ── CREATE MODAL ── */}
      {showForm && (
        <SalesDetailModal title="New Sales Order" wide order form onClose={() => { setShowForm(false); setForm(initForm); }}>
          <SoForm form={form} setForm={setForm} opts={opts} isNew />
          <MFooter>
            <button type="button" className="pm-btn pm-btn-ghost so-btn-ghost" onClick={() => { setShowForm(false); setForm(initForm); }}>
              Cancel
            </button>
            <button type="button" className="pm-btn pm-btn-primary so-btn-primary" onClick={saveOrder} disabled={saving || !form.customer}>
              {saving ? "Saving…" : "Save Order"}
            </button>
          </MFooter>
        </SalesDetailModal>
      )}

      {/* ── EDIT MODAL ── */}
      {editOrder && (
        <SalesDetailModal title={`Edit Sales Order — ${editOrder.name}`} wide order onClose={() => setEditOrder(null)}>
          <SoForm form={editOrder} setForm={setEditOrder} opts={opts} />
          <MFooter>
            <button className="pm-btn pm-btn-ghost so-btn-ghost" onClick={() => setEditOrder(null)}>Cancel</button>
            <button className="pm-btn pm-btn-primary so-btn-primary" onClick={updateOrder} disabled={saving}>
              {saving ? "Updating…" : "Update"}
            </button>
          </MFooter>
        </SalesDetailModal>
      )}

      {/* ── VIEW MODAL ── */}
      {(viewOrder || viewLoading) && (
        <SalesDetailModal title="Sales Order Detail" onClose={() => setViewOrder(null)} wide order>
          {viewLoading
            ? <div className="sales-modal-body-loading"><SalesPageLoader label="Loading order…" /></div>
            : (
              <>
                <SoView order={viewOrder} />
              </>
            )}
          <MFooter>
            <button className="pm-btn pm-btn-ghost so-btn-ghost" onClick={() => setViewOrder(null)}>Close</button>
            {viewOrder && isDraftOrder(viewOrder) && (
              <button
                type="button"
                className="so-btn-wf so-btn-wf-submit"
                disabled={!!workflowBusy}
                onClick={() => submitSalesOrder(viewOrder.name)}
              >
                {workflowBusy === `submit:${viewOrder.name}` ? "Submitting…" : "Submit order"}
              </button>
            )}
            {viewOrder && canEditOrder(viewOrder) && (
              <button
                type="button"
                className="pm-btn pm-btn-primary so-btn-primary"
                disabled={editLoading}
                onClick={() => { const n = viewOrder?.name; setViewOrder(null); if (n) openEdit(n); }}
              >
                {editLoading ? "Loading…" : "Edit"}
              </button>
            )}
          </MFooter>
        </SalesDetailModal>
      )}

      <ConfirmDeleteModal
        target={deleteTarget}
        title="Delete Sales Order"
        loading={deleteLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteOrder}
      />
    </>
  );
}

/* ─── Sales Order Form ───────────────────────────────────────── */
function SoForm({ form, setForm, opts, isNew }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const showMfg = Boolean(opts.manufacturing_available);
  const mainLine = form.items?.[0] || initItem;
  const mainItemCode = String(mainLine.item_code || "").trim();
  const mainQty = Math.max(1, Number(mainLine.qty) || 1);
  const debouncedMainQty = useDebouncedValue(mainQty, 400);
  const prevMainItemCodeRef = useRef(mainItemCode);
  const lastExplodeKeyRef = useRef("");
  const editExplodeSeededRef = useRef(false);

  const explodeQty =
    prevMainItemCodeRef.current !== mainItemCode ? mainQty : debouncedMainQty;

  useEffect(() => {
    prevMainItemCodeRef.current = mainItemCode;
  }, [mainItemCode]);

  useEffect(() => {
    if (isNew) {
      editExplodeSeededRef.current = false;
      lastExplodeKeyRef.current = "";
      return;
    }
    if (editExplodeSeededRef.current) return;
    editExplodeSeededRef.current = true;
    lastExplodeKeyRef.current = `${mainItemCode}:${mainQty}`;
  }, [isNew, form.name, mainItemCode, mainQty]);

  useEffect(() => {
    if (!showMfg || !mainItemCode) return undefined;

    const key = `${mainItemCode}:${explodeQty}`;
    if (lastExplodeKeyRef.current === key) return undefined;

    let cancelled = false;
    const run = async () => {
      try {
        const result = await explodeBomForItem(mainItemCode, explodeQty);
        if (cancelled) return;
        const exploded = result?.items || [];
        if (!exploded.length) {
          lastExplodeKeyRef.current = key;
          return;
        }
        setForm((prev) => {
          const merged = mergeExplodedBomRows(prev.bom_items, exploded);
          if (!merged?.length) return prev;
          return { ...prev, bom_items: merged };
        });
        lastExplodeKeyRef.current = key;
      } catch {
        /* keep manual BOM rows on network / API errors */
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mainItemCode, explodeQty, showMfg, setForm]);

  const addBomRow = () => setForm((f) => ({ ...f, bom_items: [...(f.bom_items || []), emptyBomRow()] }));
  const removeBomRow = (i) =>
    setForm((f) => ({
      ...f,
      bom_items: (f.bom_items || []).length > 1 ? f.bom_items.filter((_, j) => j !== i) : f.bom_items,
    }));
  const setBomRow = (i, k, v) =>
    setForm((f) => {
      const bom_items = [...(f.bom_items || [emptyBomRow()])];
      const row = { ...bom_items[i] };
      if (k === "required_qty") {
        row.required_qty = v === "" ? "" : Math.max(0, Number(v) || 0);
      } else if (k === "rate") {
        row.rate = v === "" ? "" : Math.max(0, Number(v) || 0);
      } else if (k === "item_code") {
        row[k] = v;
        const found = opts.items?.find((o) => o.code === v);
        if (found?.rate) {
          row.rate = found.rate;
        } else if (String(v || "").trim()) {
          api.get("/api/method/sales_app.api.sales_order.get_item_internal_rate", {
            params: { item_code: String(v).trim() },
          }).then((res) => {
            const rate = Number(res.data?.message?.rate) || 0;
            if (rate > 0) {
              setForm((prev) => {
                const bom_items = [...(prev.bom_items || [])];
                if (!bom_items[i] || bom_items[i].item_code !== v) return prev;
                bom_items[i] = { ...bom_items[i], rate };
                return { ...prev, bom_items };
              });
            }
          }).catch(() => {});
        }
      } else {
        row[k] = v;
      }
      bom_items[i] = row;
      return { ...f, bom_items };
    });

  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, { ...initItem }] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }));
  const setItem = (i, k, v) =>
    setForm((f) => {
      const items = [...f.items];
      const row = { ...items[i] };
      if (k === "qty") {
        row.qty = v === "" ? "" : Math.max(1, Number(v) || 1);
      } else if (k === "rate") {
        row.rate = v === "" ? "" : Math.max(0, Number(v) || 0);
      } else {
        row[k] = v;
      }
      if (k === "item_code") {
        const found = productLineOptions.find((o) => o.code === v);
        if (found) {
          row.rate = found.rate || 0;
          row.uom = found.uom || "Nos";
        }
      }
      items[i] = row;
      return { ...f, items };
    });

  const productLineOptions = useMemo(() => {
    const items = opts.items || [];
    // "Select finished good" line dropdown must ALWAYS restrict to finished
    // goods, regardless of showMfg — raw materials / spares must never appear.
    return items.filter(
      (o) =>
        o.is_fg === true
        || String(o.code || "").toUpperCase().startsWith("FG-")
        || String(o.code || "").toUpperCase().startsWith("SFG-"),
    );
  }, [opts.items]);

  const lineAmount = (it) => (Number(it.qty) || 0) * (Number(it.rate) || 0);
  const bomLineAmount = (row) => (Number(row.required_qty) || 0) * (Number(row.rate) || 0);
  const productTotal = form.items.reduce((s, it) => s + lineAmount(it), 0);
  const subProductTotal = (form.bom_items || []).reduce(
    (s, row) => s + bomLineAmount(row),
    0,
  );
  const grandTotal = productTotal;
  const bomMargin = productTotal - subProductTotal;
  const bomExceedsProduct = showMfg && productTotal > 0 && subProductTotal > productTotal;

  return (
    <div className={`so-form${isNew ? " so-form--new" : ""}`}>
      <div className="so-order-card">
        <div className="so-order-card__section">
          <div className="so-form-grid so-form-grid--flush">
            <F label="Customer *">
              {opts.customers?.length ? (
                <select className="so-input" value={form.customer || ""} onChange={(e) => set("customer", e.target.value)}>
                  <option value="">Select customer</option>
                  {opts.customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="so-input"
                  placeholder="Customer name"
                  value={form.customer || ""}
                  onChange={(e) => set("customer", e.target.value)}
                />
              )}
            </F>
            <F label="Expected Delivery Date">
              <input
                className="so-input so-input-date"
                type="date"
                value={form.delivery_date || ""}
                onChange={(e) => set("delivery_date", e.target.value)}
              />
            </F>
          </div>
        </div>

        <div className="so-order-card__divider" aria-hidden="true" />

        <div className="so-order-card__section">
          <div className="so-form-section-head">
            <span className="so-form-section-title">Products</span>
            <button type="button" className="pm-btn pm-btn-ghost so-btn-ghost so-btn-add-row so-btn-add-row--sm" onClick={addItem}>
              + Add
            </button>
          </div>
          <div className="so-line-items-table-wrap">
            <table className="pm-table so-line-items-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th title="Quantity">Qty</th>
                  <th>Rate (₹)</th>
                  <th className="so-line-items-th-amt" title="Qty × Rate">Amount (₹)</th>
                  <th className="so-line-items-th-act" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i}>
                    <td className="so-line-items-td-item">
                      {productLineOptions.length ? (
                        <select
                          className="so-input so-input-sm"
                          value={it.item_code}
                          onChange={(e) => setItem(i, "item_code", e.target.value)}
                        >
                          <option value="">Select finished good</option>
                          {productLineOptions.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label || `${o.code} — ${o.name}`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="so-input so-input-sm"
                          placeholder="Item code"
                          value={it.item_code}
                          onChange={(e) => setItem(i, "item_code", e.target.value)}
                        />
                      )}
                    </td>
                    <td className="so-td-qty">
                      <input
                        className="so-input so-input-sm so-input-qty"
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={it.qty === "" ? "" : Number(it.qty) || 1}
                        onChange={(e) => setItem(i, "qty", e.target.value)}
                        onBlur={(e) => {
                          if (!e.target.value || Number(e.target.value) < 1) setItem(i, "qty", 1);
                        }}
                      />
                    </td>
                    <td className="so-td-rate">
                      <input
                        className="so-input so-input-sm so-input-rate"
                        type="number"
                        min={0}
                        step="any"
                        placeholder="0"
                        title="Price per unit"
                        value={it.rate === "" ? "" : it.rate}
                        onChange={(e) => setItem(i, "rate", e.target.value)}
                      />
                    </td>
                    <td className="so-line-items-amt">{fmt(lineAmount(it))}</td>
                    <td className="so-line-items-act">
                      {form.items.length > 1 ? (
                        <button type="button" className="so-row-remove" onClick={() => removeItem(i)} aria-label="Remove row">
                          ×
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {showMfg ? (
          <>
            <div className="so-order-card__divider" aria-hidden="true" />
            <div className="so-order-card__section so-order-card__section--bom">
              <div className="so-bom-toolbar-row">
                <div className="so-bom-title-block">
                  <span className="so-form-section-title">Sub-products (BOM)</span>
                  <span className="so-bom-inline-hint">Internal cost inside product price — not billed separately</span>
                </div>
                <div className="so-bom-toolbar">
                  <label className="so-bom-priority-field">
                    <span className="so-field-label">Priority</span>
                    <select
                      className="so-input so-input-sm"
                      value={form.priority || "Medium"}
                      onChange={(e) => set("priority", e.target.value)}
                    >
                      {(opts.priorities?.length ? opts.priorities : PRIORITY_OPTIONS).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="pm-btn pm-btn-ghost so-btn-ghost so-btn-add-row so-btn-add-row--sm" onClick={addBomRow}>
                    + Add
                  </button>
                </div>
              </div>
              <div className="so-line-items-table-wrap so-bom-table-wrap">
                <div className="so-bom-grid so-bom-grid--head" aria-hidden="true">
                  <span>Item code</span>
                  <span>Name (optional)</span>
                  <span>Qty</span>
                  <span>Step / Operation</span>
                  <span>Internal rate (₹)</span>
                  <span title="Qty × Rate · included in product price">Cost (₹)</span>
                  <span />
                </div>
                {(form.bom_items || [emptyBomRow()]).map((row, idx) => (
                  <div key={idx} className="so-bom-grid so-bom-row">
                    <input
                      className="so-input so-input-sm"
                      placeholder="e.g. RM-GEAR-01"
                      value={row.item_code || ""}
                      onChange={(e) => setBomRow(idx, "item_code", e.target.value)}
                    />
                    <input
                      className="so-input so-input-sm"
                      placeholder="Description"
                      value={row.item_name || ""}
                      onChange={(e) => setBomRow(idx, "item_name", e.target.value)}
                    />
                    <input
                      className="so-input so-input-sm"
                      type="number"
                      min={0}
                      step="any"
                      value={row.required_qty === "" ? "" : row.required_qty}
                      onChange={(e) => setBomRow(idx, "required_qty", e.target.value)}
                    />
                    <select
                      className="so-input so-input-sm"
                      value={row.consume_at_operation || ""}
                      onChange={(e) => setBomRow(idx, "consume_at_operation", e.target.value)}
                      title="Operation that consumes this material (optional)"
                    >
                      <option value="">Any step</option>
                      {CONSUME_OPERATION_OPTIONS.filter(Boolean).map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    <input
                      className="so-input so-input-sm so-input-rate"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0"
                      title="Internal cost per unit (included in product price)"
                      value={row.rate === "" ? "" : row.rate}
                      onChange={(e) => setBomRow(idx, "rate", e.target.value)}
                    />
                    <span className="so-bom-line-amt">{fmt(bomLineAmount(row))}</span>
                    <button
                      type="button"
                      className="so-row-remove"
                      onClick={() => removeBomRow(idx)}
                      aria-label="Remove BOM row"
                      disabled={(form.bom_items || []).length <= 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <div className="so-line-items-total so-line-items-total--breakdown">
          <div className="so-total-row">
            <span className="so-total-row-label">Product amount (customer price)</span>
            <span className="so-total-row-value">{fmt(productTotal)}</span>
          </div>
          {showMfg ? (
            <>
              <div className="so-total-row so-total-row--internal">
                <span className="so-total-row-label">Material breakdown (included)</span>
                <span className="so-total-row-value">{fmt(subProductTotal)}</span>
              </div>
              {productTotal > 0 && subProductTotal > 0 ? (
                <div className={`so-total-row so-total-row--internal${bomExceedsProduct ? " so-total-row--warn" : ""}`}>
                  <span className="so-total-row-label">
                    {bomExceedsProduct ? "Breakdown exceeds product price" : "Margin (product − materials)"}
                  </span>
                  <span className="so-total-row-value">{fmt(bomMargin)}</span>
                </div>
              ) : null}
              {bomExceedsProduct ? (
                <p className="so-bom-cost-warning" role="status">
                  Material cost ({fmt(subProductTotal)}) is higher than the product price ({fmt(productTotal)}).
                  Adjust rates or increase the product price.
                </p>
              ) : null}
            </>
          ) : null}
          <div className="so-total-row so-total-row--grand">
            <span className="so-line-items-total-label">Grand total (customer bill)</span>
            <span className="so-line-items-total-value">{fmt(grandTotal)}</span>
          </div>
        </div>

        <div className="so-order-card__divider" aria-hidden="true" />

        <div className="so-order-card__section so-order-card__section--notes">
          <F label="Notes">
            <textarea
              className="so-input so-textarea"
              placeholder="Internal notes…"
              rows={3}
              value={form.note || ""}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </F>
        </div>
      </div>
    </div>
  );
}

/* ─── Sales Order View ───────────────────────────────────────── */
function SalesOrderManufacturingPipelinePanel({ order, onRefreshOrder, showToast }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const orderName = String(order?.name || "").trim();

  useEffect(() => {
    if (!orderName || !salesOrderNeedsManufacturingPanel(order, order?.manufacturing_pipeline)) {
      setSnapshot(null);
      setLoading(false);
      return undefined;
    }

    if (order?.manufacturing_pipeline) {
      setSnapshot(order.manufacturing_pipeline);
    }

    let cancelled = false;
    let intervalId = null;

    const fetchPipeline = (silent = false) => {
      if (cancelled) return Promise.resolve();
      if (!silent) setLoading(true);
      return api.get(SO_MANUFACTURING_PIPELINE_API, { params: { name: orderName } })
        .then((res) => {
          if (cancelled) return;
          const msg = res.data?.message || {};
          if (msg?.status === "error") return;
          setSnapshot(msg);
          if (msg.finished_goods_ready && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    };

    fetchPipeline(!order?.manufacturing_pipeline);

    intervalId = setInterval(() => {
      fetchPipeline(true);
    }, SO_MFG_PIPELINE_POLL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [orderName, order, order?.manufacturing_pipeline, order?.docstatus, order?.linked_work_order]);

  if (!orderName || !salesOrderNeedsManufacturingPanel(order, snapshot || order?.manufacturing_pipeline)) {
    return null;
  }

  const data = snapshot || order?.manufacturing_pipeline || {};
  const panelTone = !data.manufacturing_available
    ? "muted"
    : data.finished_goods_ready
      ? "ok"
      : data.work_order
        ? "warn"
        : isDraftOrder(order)
          ? "muted"
          : "warn";

  const createWorkOrder = async () => {
    if (!orderName || creating) return;
    setCreating(true);
    try {
      await prefetchCsrf().catch(() => {});
      const res = await api.post(SO_CREATE_WORK_ORDER_API, { name: orderName });
      const msg = res.data?.message || {};
      if (msg?.status === "error") throw new Error(msg.message || "Failed to create work order.");
      setSnapshot((prev) => ({ ...(prev || {}), ...msg }));
      if (onRefreshOrder) await onRefreshOrder(orderName);
      if (showToast) showToast(msg.message || `Work Order ${msg.work_order || ""} created.`.trim());
    } catch (err) {
      if (showToast) showToast(toFriendlyError(err, "Failed to create work order."), "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section
      className={`so-mfg-pipeline so-mfg-pipeline--${panelTone}`}
      role="region"
      aria-label="Manufacturing work order pipeline"
    >
      <div className="so-mfg-pipeline__head">
        <div>
          <p className="so-mfg-pipeline__title">Manufacturing</p>
        </div>
        {loading ? (
          <span className="so-mfg-pipeline__status">Loading pipeline…</span>
        ) : !data.manufacturing_available ? (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--muted">Manufacturing not installed</span>
        ) : data.finished_goods_ready ? (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--ok">Finished goods ready</span>
        ) : data.work_order ? (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--warn">{data.work_order_status || "In progress"}</span>
        ) : data.can_create_work_order ? (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--warn">Work order pending</span>
        ) : isDraftOrder(order) ? (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--muted">Awaiting order submit</span>
        ) : (
          <span className="so-mfg-pipeline__badge so-mfg-pipeline__badge--muted">Not started</span>
        )}
      </div>

      {data.manufacturing_available === false ? (
        <p className="so-mfg-pipeline__empty">Install Manufacturing Operations to track work orders from Sales.</p>
      ) : null}

      {!loading && data.manufacturing_available !== false ? (
        <div className="so-mfg-pipeline__summary">
          <div className="so-mfg-pipeline__metric">
            <span className="so-mfg-pipeline__metric-label">Deliverable</span>
            <strong>{data.deliverable || order?.deliverable || "—"}</strong>
          </div>
          <div className="so-mfg-pipeline__metric">
            <span className="so-mfg-pipeline__metric-label">Work order</span>
            <strong>{data.work_order || "—"}</strong>
          </div>
          <div className="so-mfg-pipeline__metric">
            <span className="so-mfg-pipeline__metric-label">Progress</span>
            <strong>{data.work_order ? `${Number(data.progress_percent || 0)}%` : "—"}</strong>
          </div>
          <div className="so-mfg-pipeline__metric">
            <span className="so-mfg-pipeline__metric-label">Completed qty</span>
            <strong>
              {data.work_order
                ? `${fmtStockQty(data.completed_qty)} / ${fmtStockQty(data.quantity)}`
                : "—"}
            </strong>
          </div>
          {data.latest_qc_result || data.latest_qc_status ? (
            <div className="so-mfg-pipeline__metric">
              <span className="so-mfg-pipeline__metric-label">Quality check</span>
              <strong>{data.latest_qc_result || data.latest_qc_status}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.can_create_work_order ? (
        <div className="so-mfg-pipeline__actions">
          <button
            type="button"
            className="pm-btn pm-btn-primary so-btn-primary so-btn-compact"
            disabled={creating}
            onClick={createWorkOrder}
          >
            {creating ? "Creating…" : "Create Work Order → Manufacturing"}
          </button>
        </div>
      ) : null}

      {isDraftOrder(order) && data.manufacturing_available !== false ? (
        <p className="so-mfg-pipeline__hint">Submit the order to start manufacturing.</p>
      ) : null}
    </section>
  );
}

function SalesOrderInventoryReservationPanel({ order, onCreateDelivery, dispatchBusy = "" }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const orderName = String(order?.name || "").trim();

  const refreshReservation = useCallback((silent = false) => {
    if (!orderName) return Promise.resolve();
    if (!silent) setLoading(true);
    return api.get(SO_INVENTORY_RESERVATION_API, { params: { name: orderName } })
      .then((res) => {
        const msg = res.data?.message || {};
        if (msg?.status === "error") return null;
        setSnapshot(msg);
        return msg;
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [orderName]);

  useEffect(() => {
    if (!orderName) {
      setSnapshot(null);
      return undefined;
    }

    if (order?.inventory_reservation) {
      setSnapshot(order.inventory_reservation);
    }

    let cancelled = false;
    let intervalId = null;

    const fetchReservation = (silent = false) => {
      if (cancelled) return Promise.resolve();
      return refreshReservation(silent).then((msg) => {
        if (msg?.delivery_ready && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      });
    };

    fetchReservation(!order?.inventory_reservation);

    intervalId = setInterval(() => {
      fetchReservation(true);
    }, SO_INVENTORY_POLL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [orderName, order?.inventory_reservation, order?.docstatus, order?.delivery_status, order?.manufacturing_pipeline?.finished_goods_ready, refreshReservation]);

  if (!orderName) return null;

  const data = snapshot || order?.inventory_reservation || {};
  const prod = data.production_completion || {};
  const makeToOrder = Boolean(prod.make_to_order);
  const stage = data.reservation_stage || (isDraftOrder(order) ? "awaiting_confirmation" : "reserved");
  const stockLines = (data.lines || []).filter((line) => line.is_stock_item !== false);
  const panelTone = data.delivery_ready || data.ready_for_dispatch
    ? "ok"
    : makeToOrder && prod.finished_goods_ready
      ? "warn"
      : data.order_confirmed && data.all_lines_reserved
        ? "ok"
        : isDraftOrder(order)
          ? "muted"
          : "warn";

  const stageBadge = () => {
    if (loading) return null;
    if (data.delivery_ready || data.ready_for_dispatch) {
      return <span className="so-reservation__badge so-reservation__badge--ok">Delivery ready</span>;
    }
    if (data.reservation_stage === "fully_delivered") {
      return <span className="so-reservation__badge so-reservation__badge--ok">Fully delivered</span>;
    }
    if (makeToOrder && stage === "awaiting_fg_receipt") {
      return <span className="so-reservation__badge so-reservation__badge--warn">Awaiting inventory update</span>;
    }
    if (makeToOrder && stage === "awaiting_fg_production") {
      return <span className="so-reservation__badge so-reservation__badge--warn">Awaiting FG production</span>;
    }
    if (data.order_confirmed && data.all_lines_reserved) {
      return <span className="so-reservation__badge so-reservation__badge--ok">Stock blocked</span>;
    }
    if (isDraftOrder(order)) {
      return <span className="so-reservation__badge so-reservation__badge--muted">Awaiting confirmation</span>;
    }
    return <span className="so-reservation__badge so-reservation__badge--warn">Reservation pending</span>;
  };

  const nextActionLabel = () => {
    if (data.next_action === "await_finance_delivery") return "Awaiting Finance (DN)";
    if (data.next_action === "create_delivery_note") return "Awaiting Finance (DN)";
    if (data.next_action === "submit_order") return "Submit order";
    if (data.next_action === "await_manufacturing") return "Await manufacturing";
    if (data.next_action === "await_inventory_update") return "Await inventory update";
    if (data.next_action === "await_dispatch") return "Await dispatch";
    return "—";
  };

  return (
    <section
      className={`so-reservation so-reservation--${panelTone}`}
      role="region"
      aria-label="Production completion and inventory"
    >
      <div className="so-reservation__head">
        <div>
          <p className="so-reservation__title">
            {makeToOrder ? "Inventory & delivery" : "Stock reservation"}
          </p>
        </div>
        {loading ? (
          <span className="so-reservation__status">Loading…</span>
        ) : stageBadge()}
      </div>

      {!loading && data.stock_line_count != null ? (
        <div className="so-reservation__summary">
          <div className="so-reservation__metric">
            <span className="so-reservation__metric-label">Delivery</span>
            <strong>{data.delivery_status || order?.delivery_status || "—"}</strong>
          </div>
          {!makeToOrder ? (
            <div className="so-reservation__metric">
              <span className="so-reservation__metric-label">Blocked qty</span>
              <strong>{fmtStockQty(data.blocked_qty_total)}</strong>
            </div>
          ) : null}
          <div className="so-reservation__metric">
            <span className="so-reservation__metric-label">Next step</span>
            <strong>{nextActionLabel()}</strong>
          </div>
        </div>
      ) : null}

      {stockLines.length ? (
        <div className="so-reservation__table-wrap">
          <table className="so-reservation__table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Warehouse</th>
                <th>Ordered</th>
                <th>Reserved</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {stockLines.map((line) => (
                <tr key={`${line.item_code}-${line.warehouse}`}>
                  <td>{line.item_code}</td>
                  <td>{line.warehouse || "—"}</td>
                  <td>{fmtStockQty(line.ordered_qty)}</td>
                  <td>{fmtStockQty(line.reserved_qty || line.blocked_qty)}</td>
                  <td>{fmtStockQty(line.available_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="so-reservation__empty">No stock items on this order.</p>
      )}

      {isDraftOrder(order) ? (
        <p className="so-reservation__hint">Submit the order to reserve inventory.</p>
      ) : null}

      {data.latest_delivery_note ? (
        <p className="so-reservation__hint">
          Delivery Note <strong>{data.latest_delivery_note}</strong> created.
        </p>
      ) : null}

      {data.can_create_delivery_note && onCreateDelivery ? (
        <div className="so-reservation__actions">
          <button
            type="button"
            className="pm-btn pm-btn-primary so-btn-primary so-btn-compact"
            disabled={dispatchBusy === `dispatch:${orderName}`}
            onClick={() => onCreateDelivery(orderName)}
          >
            {dispatchBusy === `dispatch:${orderName}` ? "Creating…" : "Create Delivery Note"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SalesOrderFinanceDeliveryPanel({ order, onCreateDelivery, dispatchBusy = "" }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const orderName = String(order?.name || "").trim();

  useEffect(() => {
    if (!orderName) {
      setSnapshot(null);
      return undefined;
    }
    if (order?.finance_delivery_handoff) {
      setSnapshot(order.finance_delivery_handoff);
    }
    let cancelled = false;
    let intervalId = null;

    const fetchHandoff = (silent = false) => {
      if (cancelled) return Promise.resolve();
      if (!silent) setLoading(true);
      return api.get(SO_FINANCE_DELIVERY_API, { params: { name: orderName } })
        .then((res) => {
          if (cancelled) return;
          const msg = res.data?.message || {};
          if (msg?.status === "error") return;
          setSnapshot(msg);
          if (msg.pipeline_step === "finance_verify" && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    };

    fetchHandoff(!order?.finance_delivery_handoff);
    intervalId = setInterval(() => fetchHandoff(true), SO_FINANCE_DELIVERY_POLL_MS);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [orderName, order?.finance_delivery_handoff, order?.docstatus, order?.delivery_status]);

  if (!orderName) return null;

  const data = snapshot || order?.finance_delivery_handoff || {};
  const verify = data.delivery_note_verification?.sales_order
    ? data.delivery_note_verification
    : data.verification || {};
  const panelTone = data.pipeline_step === "finance_verify"
    ? "ok"
    : data.visible_in_finance
      ? "warn"
      : isDraftOrder(order)
        ? "muted"
        : "warn";

  const badge = () => {
    if (loading) return null;
    if (data.pipeline_step === "finance_verify") {
      return <span className="so-finance-delivery__badge so-finance-delivery__badge--ok">Awaiting Finance verify</span>;
    }
    if (data.latest_delivery_note) {
      return <span className="so-finance-delivery__badge so-finance-delivery__badge--warn">Delivery Note created</span>;
    }
    if (data.visible_in_finance) {
      return <span className="so-finance-delivery__badge so-finance-delivery__badge--ok">Sent to Finance</span>;
    }
    if (isDraftOrder(order)) {
      return <span className="so-finance-delivery__badge so-finance-delivery__badge--muted">Submit order first</span>;
    }
    return <span className="so-finance-delivery__badge so-finance-delivery__badge--muted">Pending Finance handoff</span>;
  };

  return (
    <section
      className={`so-finance-delivery so-finance-delivery--${panelTone}`}
      role="region"
      aria-label="Finance delivery handoff"
    >
      <div className="so-finance-delivery__head">
        <div>
          <p className="so-finance-delivery__title">Finance delivery</p>
        </div>
        {loading ? (
          <span className="so-finance-delivery__status">Loading…</span>
        ) : badge()}
      </div>

      {!loading && verify.sales_order ? (
        <>
          <div className="so-finance-delivery__verify">
            {(data.finance_verify_fields || []).map((field) => (
              <div
                key={field.key}
                className={`so-finance-delivery__verify-item${field.ok ? " so-finance-delivery__verify-item--ok" : ""}`}
              >
                <span>{field.ok ? "✓" : "○"}</span>
                <span>{field.label}</span>
              </div>
            ))}
          </div>
          <div className="so-finance-delivery__summary">
            <div className="so-finance-delivery__metric">
              <span className="so-finance-delivery__metric-label">Customer</span>
              <strong>{verify.customer_name || verify.customer || "—"}</strong>
            </div>
            <div className="so-finance-delivery__metric">
              <span className="so-finance-delivery__metric-label">Sales Order</span>
              <strong>{verify.sales_order || orderName}</strong>
            </div>
            <div className="so-finance-delivery__metric">
              <span className="so-finance-delivery__metric-label">Qty to deliver</span>
              <strong>{fmtStockQty(verify.total_qty_to_deliver)}</strong>
            </div>
            <div className="so-finance-delivery__metric">
              <span className="so-finance-delivery__metric-label">Tax / Total</span>
              <strong>
                {verify.currency || "INR"} {Number(verify.total_taxes || 0).toLocaleString("en-IN")}
                {" / "}
                {Number(verify.grand_total || 0).toLocaleString("en-IN")}
              </strong>
            </div>
          </div>
          {(verify.lines || []).length ? (
            <div className="so-finance-delivery__table-wrap">
              <table className="so-finance-delivery__table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {verify.lines.map((line) => (
                    <tr key={`${line.item_code}-${line.qty_to_deliver}`}>
                      <td>{line.item_code}</td>
                      <td>{fmtStockQty(line.qty_to_deliver)}</td>
                      <td>{Number(line.rate || 0).toLocaleString("en-IN")}</td>
                      <td>{Number(line.amount || 0).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {(verify.taxes || []).length ? (
            <div className="so-finance-delivery__taxes">
              <p className="so-finance-delivery__taxes-title">Tax breakdown</p>
              <ul className="so-finance-delivery__taxes-list">
                {verify.taxes.map((tax, idx) => (
                  <li key={`${tax.description}-${idx}`}>
                    <span>{tax.description || tax.account_head || "Tax"}</span>
                    <strong>{Number(tax.tax_amount || 0).toLocaleString("en-IN")}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="so-finance-delivery__actions">
        {data.latest_delivery_note ? (
          <Link
            to={data.finance_delivery_note_href || financeDeliveryNotePath()}
            className="pm-btn pm-btn-ghost so-btn-ghost so-btn-compact"
          >
            View Delivery Note (read-only) →
          </Link>
        ) : null}
        {data.can_create_delivery_note && onCreateDelivery ? (
          <button
            type="button"
            className="pm-btn pm-btn-primary so-btn-primary so-btn-compact"
            disabled={dispatchBusy === `dispatch:${orderName}`}
            onClick={() => onCreateDelivery(orderName)}
          >
            {dispatchBusy === `dispatch:${orderName}` ? "Creating…" : "Create Delivery Note"}
          </button>
        ) : null}
        {data.delivery_ready && !(data.can_create_delivery_note && onCreateDelivery) ? (
          <p className="so-finance-delivery__hint">
            Delivery is ready — Finance will create the Delivery Note. You will be notified when it is submitted.
          </p>
        ) : null}
      </div>

      {isDraftOrder(order) ? (
        <p className="so-finance-delivery__hint">Submit the order before finance handoff.</p>
      ) : null}
    </section>
  );
}

function SalesOrderFinancePaymentPanel({ order }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const orderName = String(order?.name || "").trim();

  useEffect(() => {
    if (!orderName) {
      setSnapshot(null);
      return undefined;
    }
    if (order?.finance_payment_handoff) {
      setSnapshot(order.finance_payment_handoff);
    }
    let cancelled = false;
    let intervalId = null;

    const fetchHandoff = (silent = false) => {
      if (cancelled) return Promise.resolve();
      if (!silent) setLoading(true);
      return api.get(SO_FINANCE_PAYMENT_API, { params: { name: orderName } })
        .then((res) => {
          if (cancelled) return;
          const msg = res.data?.message || {};
          if (msg?.status === "error") return;
          setSnapshot(msg);
          if (msg.pipeline_step === "fully_paid" && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    };

    fetchHandoff(!order?.finance_payment_handoff);
    intervalId = setInterval(() => fetchHandoff(true), SO_FINANCE_PAYMENT_POLL_MS);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [orderName, order?.finance_payment_handoff, order?.billing_status]);

  if (!orderName) return null;

  const data = snapshot || order?.finance_payment_handoff || {};
  const panelTone = data.pipeline_step === "fully_paid"
    ? "ok"
    : data.has_submitted_invoice
      ? "warn"
      : "muted";

  const badge = () => {
    if (loading) return null;
    if (data.pipeline_step === "fully_paid") {
      return <span className="so-finance-payment__badge so-finance-payment__badge--ok">Fully paid</span>;
    }
    if (data.pipeline_step === "outstanding_updated") {
      return <span className="so-finance-payment__badge so-finance-payment__badge--warn">Partial payment</span>;
    }
    if (data.pipeline_step === "payment_entry_created") {
      return <span className="so-finance-payment__badge so-finance-payment__badge--warn">Payment entry created</span>;
    }
    if (data.has_submitted_invoice) {
      return <span className="so-finance-payment__badge so-finance-payment__badge--warn">Awaiting payment</span>;
    }
    return <span className="so-finance-payment__badge so-finance-payment__badge--muted">Awaiting invoice</span>;
  };

  const invoices = data.invoices || [];
  const paymentEntries = data.payment_entries || [];
  const receipts = data.receipts || [];

  return (
    <section
      className={`so-finance-payment so-finance-payment--${panelTone}`}
      role="region"
      aria-label="Finance payment collection"
    >
      <div className="so-finance-payment__head">
        <div>
          <p className="so-finance-payment__title">Finance payment</p>
        </div>
        {loading ? (
          <span className="so-finance-payment__status">Loading…</span>
        ) : badge()}
      </div>

      {(data.total_invoiced > 0 || invoices.length > 0) ? (
        <div className="so-finance-payment__summary">
          <div className="so-finance-payment__metric">
            <span className="so-finance-payment__metric-label">Invoiced</span>
            <strong>{fmt(data.total_invoiced)}</strong>
          </div>
          <div className="so-finance-payment__metric">
            <span className="so-finance-payment__metric-label">Collected</span>
            <strong>{fmt(data.total_paid)}</strong>
          </div>
          <div className="so-finance-payment__metric">
            <span className="so-finance-payment__metric-label">Outstanding</span>
            <strong>{fmt(data.total_outstanding)}</strong>
          </div>
          <div className="so-finance-payment__metric">
            <span className="so-finance-payment__metric-label">Collection rate</span>
            <strong>{Number(data.collection_rate || 0).toFixed(1)}%</strong>
          </div>
        </div>
      ) : null}

      {invoices.length > 0 ? (
        <div className="so-finance-payment__table-wrap">
          <table className="so-finance-payment__table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>Invoiced</th>
                <th>Paid</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.name}>
                  <td>{inv.name}</td>
                  <td>{inv.status || "—"}</td>
                  <td>{fmt(inv.grand_total)}</td>
                  <td>{fmt(inv.paid_amount)}</td>
                  <td>{fmt(inv.outstanding_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {paymentEntries.length > 0 ? (
        <div className="so-finance-payment__table-wrap">
          <table className="so-finance-payment__table">
            <thead>
              <tr>
                <th>Payment Entry</th>
                <th>Invoice</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {paymentEntries.map((pe) => (
                <tr key={pe.name}>
                  <td>{pe.name}</td>
                  <td>{pe.invoice || "—"}</td>
                  <td>{pe.submitted ? "Submitted" : "Draft"}</td>
                  <td>{fmt(pe.paid_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {receipts.length > 0 ? (
        <div className="so-finance-payment__table-wrap">
          <table className="so-finance-payment__table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Invoice</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.invoice || "—"}</td>
                  <td>{row.payment_date || "—"}</td>
                  <td>{fmt(row.paid_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data.dashboard_synced ? (
        <p className="so-finance-payment__hint so-finance-payment__hint--ok">
          Outstanding cleared — Sales dashboard and list KPIs reflect this payment.
        </p>
      ) : null}
    </section>
  );
}

function SoView({ order }) {
  if (!order) return null;
  const bomBreakdownTotal = (order.bom_items || []).reduce(
    (s, row) => s + (Number(row.amount) || 0),
    0,
  );
  return (
    <div className="so-view-stack">
      <p className="so-form-hint so-view-hint">
        Created {formatCreated(order.creation)}
        {isRecentOrder(order) ? " · marked as recent" : ""}
      </p>
      <div className="so-view-hero">
        <div>
          <div className="so-view-hero-tag">Sales Order</div>
          <div className="so-view-hero-id">{order.name}</div>
          <div className="so-view-hero-cust">{order.customer}</div>
        </div>
        <div className="so-view-hero-total-wrap">
          <div className="so-view-hero-total">{fmt(order.grand_total)}</div>
        </div>
      </div>

      <div className="so-meta-grid">
        {[
          { label: "Order Type", value: order.order_type },
          { label: "Order Date", value: order.transaction_date },
          { label: "Expected Delivery", value: order.delivery_date },
          { label: "Deliverable", value: order.deliverable },
          { label: "Priority", value: order.priority },
          { label: "PO Number", value: order.po_no },
          { label: "Currency", value: order.currency },
          { label: "Total Qty", value: order.total_qty },
          { label: "Net Total", value: fmt(order.net_total) },
          { label: "Advance Paid", value: fmt(order.advance_paid) },
          { label: "Modified", value: order.modified?.split(" ")[0] },
        ].filter((r) => r.value).map(({ label, value }) => (
          <div key={label} className="so-meta-cell">
            <div className="so-meta-label">{label}</div>
            <div className="so-meta-value">{value}</div>
          </div>
        ))}
      </div>

      {order.items?.length > 0 ? (
        <div>
          <div className="so-view-items-title">Line Items</div>
          <div className="so-view-items-box">
            <table className="so-view-items-table">
              <thead>
                <tr>
                  {["Item", "Qty", "Rate", "Amount", "Warehouse"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.items.map((it, i) => (
                  <tr key={i}>
                    <td className="so-td-item">{it.item_name || it.item_code}</td>
                    <td className="so-td-mono">{it.qty} {it.uom}</td>
                    <td className="so-td-mono">{fmt(it.rate)}</td>
                    <td className="so-td-amount">{fmt(it.amount)}</td>
                    <td className="so-td-wh">{it.warehouse || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="so-view-items-foot">
              <span className="so-view-items-foot-label">GRAND TOTAL</span>
              <span className="so-view-items-foot-total">{fmt(order.grand_total)}</span>
            </div>
          </div>
        </div>
      ) : null}

      {order.bom_items?.length > 0 ? (
        <div>
          <div className="so-view-items-title">BOM / Sub-products (included in product price)</div>
          <div className="so-view-items-box">
            <table className="so-view-items-table">
              <thead>
                <tr>
                  {["Item code", "Name", "Qty", "Internal rate (₹)", "Cost (₹)"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.bom_items.map((row, i) => {
                  const qty = Number(row.required_qty) || 0;
                  const amount = Number(row.amount) || 0;
                  const rate = Number(row.rate) || (qty > 0 && amount > 0 ? amount / qty : 0);
                  const lineCost = amount || qty * rate;
                  return (
                  <tr key={i}>
                    <td className="so-td-mono">{row.item_code}</td>
                    <td>{row.item_name || "—"}</td>
                    <td className="so-td-mono">{row.required_qty}</td>
                    <td className="so-td-amount">{rate ? fmt(rate) : "—"}</td>
                    <td className="so-td-amount">{lineCost ? fmt(lineCost) : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="so-view-items-foot so-view-items-foot--internal">
              <span className="so-view-items-foot-label">Material breakdown (not billed extra)</span>
              <span className="so-view-items-foot-total so-view-items-foot-total--muted">{fmt(bomBreakdownTotal)}</span>
            </div>
          </div>
        </div>
      ) : null}

      {order.note ? (
        <div className="so-view-notes">
          <div className="so-view-notes-label">Notes</div>
          <p className="so-view-notes-text">{order.note}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */
const F = ({ label, hint, children }) => (
  <div className="so-field">
    <label className="so-field-label">{label}</label>
    {hint ? <span className="so-field-hint">{hint}</span> : null}
    {children}
  </div>
);

const MFooter = SalesModalFooter;

/* ─── CSS ─────────────────────────────────────────────────────── */
