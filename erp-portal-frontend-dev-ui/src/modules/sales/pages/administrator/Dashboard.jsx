import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/apiUtils";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { toFriendlyError } from "../../lib/apiUtils";
import { salesToday, applyPastFromDate, applyPastToDate } from "../../lib/dateValidation.js";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import { StatusPill } from "../../../../common/components/StatusPill.jsx";
import { SALES_WORKFLOW_STAGE_ROUTES } from "../../lib/salesWorkflowNav.js";
import { SALES_PRODUCT_DEV_DASHBOARD_REFRESH } from "../../lib/productDevEvents.js";

const fmtFull = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtK = (n) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(0)}k` : `₹${Number(n || 0)}`;

/** Per-opportunity ceiling (10 Cr) — ignores bad demo/typo amounts in KPI totals. */
const MAX_OPPORTUNITY_AMOUNT = 1e8;
const CLOSED_OPP_STATUSES = new Set(["Won", "Lost", "Closed", "Closed Won", "Closed Lost"]);

const parseAmount = (n) => {
  if (n == null || n === "") return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  const val = Number(String(n).replace(/,/g, "").trim());
  return Number.isFinite(val) ? val : 0;
};

const normalizeOppRevenue = (n) => {
  const num = parseAmount(n);
  if (num <= 0 || num > MAX_OPPORTUNITY_AMOUNT) return 0;
  return num;
};

const oppRevenue = (row) =>
  normalizeOppRevenue(row?.expected_revenue ?? row?.opportunity_amount ?? row?.amount);

/** Compact Indian currency for KPI cards (Cr / L / plain). */
const fmtKpiMoney = (n) => {
  const num = parseAmount(n);
  if (num >= 1e7) {
    return `₹${(num / 1e7).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Cr`;
  }
  if (num >= 1e5) {
    return `₹${(num / 1e5).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
  }
  return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const fmtKpiMoneyOrDash = (n) => {
  const num = parseAmount(n);
  return num > 0 ? fmtKpiMoney(num) : "—";
};

const isOpenOpportunity = (row) => !CLOSED_OPP_STATUSES.has(String(row?.status || "").trim());
const truncLabel = (s, max = 14) => {
  const t = String(s ?? "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const toNum = (v) => Number(v || 0);

const SALES_ORDER_ROUTE = "/sales/orders";
const DASH_KPI_ICON_SIZE = 20;

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
};

const inDateRange = (value, from, to) => {
  const d = parseDate(value);
  if (!d) return true;
  if (from) {
    const f = parseDate(from);
    if (f && d < f) return false;
  }
  if (to) {
    const t = parseDate(to);
    if (t && d > t) return false;
  }
  return true;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currentMonthLabel = () => {
  const now = new Date();
  return `${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
};

const CHART_TICK = { fontSize: 11, fill: C.muted, fontWeight: 600 };
const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 4 };

const ORDER_STATUS_COLORS = [
  "#38bdf8",
  "#4ade80",
  "#fbbf24",
  "#f87171",
  "#818cf8",
  "#2dd4bf",
  "#c084fc",
  "#94a3b8",
];

const TABLE_TABS = [
  { id: "orders", label: "Recent orders" },
  { id: "crm", label: "CRM activities" },
];

/** Lead status tones — same map as Lead.jsx */
const LEAD_PILL_TONE = {
  Open: "info",
  Contacted: "default",
  Qualified: "success",
  Replied: "default",
  Interested: "success",
  Opportunity: "warn",
  Converted: "success",
  Dropped: "danger",
};

/** Opportunity status colors — same map as Opportunity.jsx */
const OPP_STATUS_PILL = {
  Open: [C.blue, C.blueDim],
  Quotation: [C.indigo, C.indigoLt],
  Converted: [C.cyan, C.cyanLt],
  Won: [C.green, C.greenDim],
  Lost: [C.red, C.redDim],
  Closed: [C.muted, C.surface2],
};

/** Quotation status colors — same map as Quotation.jsx */
const QUOTATION_STATUS_PILL = {
  draft: { fg: C.muted, bg: C.surface2 },
  "pending approval": { fg: C.amber, bg: C.amberLt },
  "awaiting approval": { fg: C.amber, bg: C.amberLt },
  rejected: { fg: C.red, bg: C.redDim },
  open: { fg: C.teal, bg: C.tealLt },
  replied: { fg: C.indigo, bg: C.indigoLt },
  "partially ordered": { fg: C.amber, bg: C.amberLt },
  ordered: { fg: C.green, bg: C.greenDim },
  lost: { fg: C.sub, bg: C.surface2 },
  cancelled: { fg: C.red, bg: C.redDim },
  expired: { fg: C.red, bg: C.redLt },
  submitted: { fg: C.indigo, bg: C.indigoLt },
};

const quotationPillTheme = (statusRaw) => {
  const key = String(statusRaw ?? "").trim().toLowerCase() || "draft";
  return QUOTATION_STATUS_PILL[key] || { fg: C.sub, bg: C.surface2 };
};

const fmtCrmDate = (v) => {
  const d = parseDate(v);
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

function CrmActivityStatus({ type, status }) {
  const label = String(status || "").trim();
  if (!label || label === "—") return <span>—</span>;

  if (type === "Lead") {
    return (
      <span className="dash-crm-status-wrap">
        <StatusPill tone={LEAD_PILL_TONE[label] || "default"}>{label}</StatusPill>
      </span>
    );
  }

  let fg;
  let bg;
  if (type === "Opportunity") {
    [fg, bg] = OPP_STATUS_PILL[label] || [C.sub, C.surface2];
  } else {
    const theme = quotationPillTheme(label);
    fg = theme.fg;
    bg = theme.bg;
  }

  return (
    <span className="dash-crm-status" style={{ "--pill-fg": fg, "--pill-bg": bg }}>
      {label}
    </span>
  );
}

const ChartTip = ({ active, payload, label, valueMode = "currency" }) => {
  if (!active || !payload?.length) return null;
  const fmtVal = (v) => {
    if (typeof v !== "number") return v;
    return valueMode === "currency" ? fmtK(v) : Number(v).toLocaleString("en-IN");
  };
  return (
    <div className="dash-tip">
      {label != null && label !== "" && <p className="dash-tip-label">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="dash-tip-row">
          <span className="dash-tip-dot" style={{ "--tip-color": p.color || p.fill || C.blue }} />
          <span className="dash-tip-text">
            {p.name}
            <span className="dash-tip-val">{fmtVal(p.value)}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

const DashCard = ({ title, children, chartWrap, meta, onClick, active }) => (
  <div
    className={`dash-card${onClick ? " dash-card--click" : ""}${active ? " dash-card--active" : ""}`}
    onClick={onClick}
    onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {title && (
      <div className="dash-card-hd">
        <span className="dash-card-title">{title}</span>
        {meta ? <span className="dash-card-meta">{meta}</span> : null}
      </div>
    )}
    <div className={chartWrap ? "dash-card-body dash-card-body--chart" : "dash-card-body"}>{children}</div>
  </div>
);

const SelectFilter = ({ label, value, onChange, options }) => (
  <div className="pm-list-filters__field">
    <label className="pm-list-filters__label">{label}</label>
    <select className="pm-select pm-list-filters__select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {truncLabel(o, 28)}
        </option>
      ))}
    </select>
  </div>
);

const unwrap = (res) => res?.data?.message ?? null;

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [listsLoading, setListsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sales, setSales] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [oppDash, setOppDash] = useState(null);
  const [quotDash, setQuotDash] = useState(null);
  const [custDash, setCustDash] = useState(null);
  const [leads, setLeads] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [collections, setCollections] = useState(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [executive, setExecutive] = useState("");
  const [customer, setCustomer] = useState("");
  const [drill, setDrill] = useState(null);

  const [ordersPageSize, setOrdersPageSize] = useState(8);
  const [crmPageSize, setCrmPageSize] = useState(8);
  const [activeTableTab, setActiveTableTab] = useState("orders");
  const { toast, showToast } = useSalesToast(4000);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [salesR, pipeR, oppR, quotR, custR, collectionsR] = await Promise.allSettled([
        api.get("/api/method/sales_app.api.sales_order.dashboard_data"),
        api.get("/api/method/sales_app.api.lead.pipeline_dashboard"),
        api.get("/api/method/sales_app.api.opportunity.dashboard_data"),
        api.get("/api/method/sales_app.api.quotation.dashboard_data"),
        api.get("/api/method/sales_app.api.customer.dashboard_data"),
        api.get("/api/method/sales_app.api.invoice.get_invoice_dashboard"),
      ]);

      setSales(salesR.status === "fulfilled" ? unwrap(salesR.value) : null);
      setPipeline(pipeR.status === "fulfilled" ? unwrap(pipeR.value) : null);
      setOppDash(oppR.status === "fulfilled" ? unwrap(oppR.value) : null);
      setQuotDash(quotR.status === "fulfilled" ? unwrap(quotR.value) : null);
      setCustDash(custR.status === "fulfilled" ? unwrap(custR.value) : null);
      setCollections(collectionsR.status === "fulfilled" ? unwrap(collectionsR.value) : null);

      if (salesR.status === "rejected" && pipeR.status === "rejected") {
        const msg = "Failed to load dashboard data";
        setError(msg);
        showToast(msg, "error");
      }
    } catch {
      const msg = "Failed to load dashboard";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }

    setListsLoading(true);
    try {
      const [leadsR, oppsR, quotsR, custListR] = await Promise.allSettled([
        api.get("/api/method/sales_app.api.lead.get_leads", { params: { page_size: 500 } }),
        api.get("/api/method/sales_app.api.opportunity.get_opportunities"),
        api.get("/api/method/sales_app.api.quotation.get_quotations"),
        api.get("/api/method/sales_app.api.customer.get_customers"),
      ]);
      setLeads(leadsR.status === "fulfilled" ? unwrap(leadsR.value) || [] : []);
      setOpportunities(oppsR.status === "fulfilled" ? unwrap(oppsR.value) || [] : []);
      setQuotations(quotsR.status === "fulfilled" ? unwrap(quotsR.value) || [] : []);
      setCustomers(custListR.status === "fulfilled" ? unwrap(custListR.value) || [] : []);
    } finally {
      setListsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const onRefresh = () => {
      loadDashboard();
    };
    window.addEventListener(SALES_PRODUCT_DEV_DASHBOARD_REFRESH, onRefresh);
    return () => window.removeEventListener(SALES_PRODUCT_DEV_DASHBOARD_REFRESH, onRefresh);
  }, [loadDashboard]);

  const productDevAlerts = oppDash?.product_dev_alerts ?? { count: 0, items: [] };
  const productDevItems = Array.isArray(productDevAlerts.items) ? productDevAlerts.items : [];

  const viewProductDevResult = useCallback(async (opportunityId) => {
    if (!opportunityId) return;
    try {
      await api.post("/api/method/sales_app.api.opportunity.acknowledge_product_dev_sales_alert", {
        opportunity_id: opportunityId,
      });
    } catch {
      /* still navigate */
    }
    navigate(`/sales/opportunities?open=${encodeURIComponent(opportunityId)}`);
    loadDashboard();
  }, [loadDashboard, navigate]);

  const matchRowFilters = useCallback(
    (row, { dateField = "creation", custField = "customer", execField }) => {
      if (dateFrom || dateTo) {
        const dv = row[dateField] || row.posting_date || row.transaction_date;
        if (!inDateRange(dv, dateFrom, dateTo)) return false;
      }
      const cust = row[custField] || row.party_name || row.customer_name || row.company || "";
      if (customer && cust !== customer) return false;
      if (executive) {
        const ex = row[execField] || row.lead_owner || row.owner || "";
        if (ex !== executive) return false;
      }
      if (drill?.type === "status" && row.status !== drill.value) return false;
      return true;
    },
    [dateFrom, dateTo, customer, executive, drill]
  );

  const ordersAll = useMemo(
    () => (sales?.orders_detail?.length ? sales.orders_detail : sales?.recent_orders || []),
    [sales]
  );

  const leadsFiltered = useMemo(
    () => leads.filter((r) => matchRowFilters(r, { execField: "lead_owner" })),
    [leads, matchRowFilters]
  );

  const oppsFiltered = useMemo(
    () =>
      opportunities.filter((r) =>
        matchRowFilters(
          {
            ...r,
            customer: r.customer_name || r.party_label || r.party_name,
            creation: r.creation,
          },
          { custField: "customer" }
        )
      ),
    [opportunities, matchRowFilters]
  );

  const quotsFiltered = useMemo(
    () =>
      quotations.filter((r) =>
        matchRowFilters(r, { custField: "party_name", dateField: "creation" })
      ),
    [quotations, matchRowFilters]
  );

  const execCustomerSet = useMemo(() => {
    if (!executive) return null;
    return new Set(leadsFiltered.map((l) => l.company).filter(Boolean));
  }, [executive, leadsFiltered]);

  const ordersFiltered = useMemo(
    () =>
      ordersAll.filter((r) => {
        if (execCustomerSet && r.customer && !execCustomerSet.has(r.customer)) return false;
        return matchRowFilters(r, { dateField: "creation", custField: "customer" });
      }),
    [ordersAll, matchRowFilters, execCustomerSet]
  );

  const revenueThisMonth = useMemo(() => {
    const label = currentMonthLabel();
    const fromSo = (sales?.monthly_sales || []).find((m) => m.month === label);
    return toNum(fromSo?.total);
  }, [sales]);

  const kpis = useMemo(() => {
    const totalRevenue =
      toNum(sales?.total_sales) || toNum(custDash?.total_revenue);
    const pipelineValue = oppsFiltered
      .filter(isOpenOpportunity)
      .reduce((sum, row) => sum + oppRevenue(row), 0);
    const submittedOrders = ordersFiltered.filter((o) => Number(o.docstatus) === 1).length;
    const activeCustomers =
      custDash?.active_customers ??
      new Set(ordersFiltered.map((o) => o.customer).filter(Boolean)).size;
    const openOpps = oppsFiltered.filter(isOpenOpportunity).length;

    return {
      totalRevenue,
      revenueThisMonth,
      pipelineValue,
      submittedOrders,
      activeCustomers,
      openOpps,
    };
  }, [
    sales,
    custDash,
    ordersFiltered,
    oppsFiltered,
    revenueThisMonth,
  ]);

  const collectionKpis = useMemo(() => {
    const invoiceOutstanding = toNum(collections?.outstanding);
    const pendingBillValue = ordersFiltered
      .filter((o) => {
        if (Number(o.docstatus) !== 1) return false;
        const billingStatus = String(o.billing_status || "").trim();
        return !billingStatus || billingStatus === "Not Billed";
      })
      .reduce((sum, o) => sum + toNum(o.grand_total), 0);

    const outstanding = invoiceOutstanding + pendingBillValue;

    let outstandingSub = "Unpaid invoice balance";
    if (invoiceOutstanding > 0 && pendingBillValue > 0) {
      outstandingSub = "Invoices + unbilled orders";
    } else if (pendingBillValue > 0) {
      outstandingSub = "Pending billing on orders";
    }

    const toDeliverFromApi = toNum(sales?.to_deliver);
    const toDeliver = toDeliverFromApi || ordersFiltered.filter((o) => {
      if (Number(o.docstatus) !== 1) return false;
      const deliveryStatus = String(o.delivery_status || "Not Delivered").trim();
      return deliveryStatus === "Not Delivered" || deliveryStatus === "Partially Delivered";
    }).length;

    return { outstanding, outstandingSub, toDeliver };
  }, [collections, sales, ordersFiltered]);

  const funnelData = useMemo(() => {
    return [
      { name: "Lead", value: pipeline?.total_leads ?? leadsFiltered.length, key: "lead" },
      { name: "Opportunity", value: oppDash?.total ?? oppsFiltered.length, key: "opp" },
      { name: "Quotation", value: quotDash?.total ?? quotsFiltered.length, key: "quot" },
      { name: "Sales Order", value: ordersFiltered.length, key: "so" },
    ];
  }, [
    pipeline,
    leadsFiltered,
    oppDash,
    oppsFiltered,
    quotDash,
    quotsFiltered,
    ordersFiltered,
  ]);

  const monthlyRevenue = useMemo(() => {
    return (sales?.monthly_sales || []).map((m) => ({
      month: m.month,
      total: toNum(m.total),
    }));
  }, [sales]);

  const topCustomersChart = useMemo(() => {
    const map = new Map();
    for (const o of ordersFiltered) {
      const name = o.customer || "Unknown";
      map.set(name, (map.get(name) || 0) + toNum(o.grand_total));
    }
    return [...map.entries()]
      .map(([fullCustomer, total]) => ({
        customer: truncLabel(fullCustomer, 16),
        fullCustomer,
        total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [ordersFiltered]);

  const orderStatusChart = useMemo(() => {
    const map = new Map();
    for (const o of ordersFiltered) {
      const status = String(
        o.status || (Number(o.docstatus) === 0 ? "Draft" : "Submitted")
      ).trim();
      map.set(status, (map.get(status) || 0) + 1);
    }
    return [...map.entries()]
      .map(([name, value]) => ({
        name: truncLabel(name, 16),
        fullStatus: name,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [ordersFiltered]);

  const crmActivities = useMemo(() => {
    const acts = [];
    for (const l of leadsFiltered.slice(0, 40)) {
      acts.push({
        id: `lead-${l.name}`,
        type: "Lead",
        ref: l.name,
        customer: l.company || l.lead_name || "—",
        amount: null,
        date: l.modified || l.creation,
        dateLabel: fmtCrmDate(l.modified || l.creation),
        status: l.status,
      });
    }
    for (const o of oppsFiltered.slice(0, 40)) {
      const revenue = oppRevenue(o);
      acts.push({
        id: `opp-${o.name}`,
        type: "Opportunity",
        ref: o.name,
        customer: o.party_label || o.party_name || "—",
        amount: revenue > 0 ? revenue : null,
        date: o.modified || o.creation,
        dateLabel: fmtCrmDate(o.modified || o.creation),
        status: o.status,
      });
    }
    for (const q of quotsFiltered.slice(0, 30)) {
      const amount = parseAmount(q.grand_total);
      acts.push({
        id: `qt-${q.name}`,
        type: "Quotation",
        ref: q.name,
        customer: q.party_name || "—",
        amount: amount > 0 ? amount : null,
        date: q.modified || q.creation,
        dateLabel: fmtCrmDate(q.modified || q.creation),
        status: q.display_status || q.status || "Draft",
      });
    }
    return acts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [leadsFiltered, oppsFiltered, quotsFiltered]);

  const filterOptions = useMemo(() => {
    const execs = [...new Set(leads.map((l) => l.lead_owner).filter(Boolean))].sort();
    const custs = [
      ...new Set([
        ...ordersAll.map((o) => o.customer),
        ...quotations.map((q) => q.party_name),
      ].filter(Boolean)),
    ].sort();
    return { execs, custs };
  }, [leads, ordersAll, quotations]);

  const setDrillStatus = (status) =>
    setDrill((d) => (d?.type === "status" && d?.value === status ? null : { type: "status", value: status }));

  const openSalesOrder = useCallback(
    (orderName) => {
      const name = String(orderName || "").trim();
      if (!name) return;
      navigate(`${SALES_ORDER_ROUTE}?open=${encodeURIComponent(name)}`);
    },
    [navigate]
  );

  const openCrmDocument = useCallback(
    (type, docName) => {
      const name = String(docName || "").trim();
      if (!name) return;
      const route = SALES_WORKFLOW_STAGE_ROUTES[type];
      if (!route) return;
      navigate(`${route}?open=${encodeURIComponent(name)}`);
    },
    [navigate]
  );

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setExecutive("");
    setCustomer("");
    setDrill(null);
  };

  const hasFilters = dateFrom || dateTo || executive || customer || drill;

  const maxFunnel = useMemo(() => {
    const peak = Math.max(...funnelData.map((d) => d.value), 1);
    return Math.ceil(peak * 1.12);
  }, [funnelData]);

  const maxMonthly = useMemo(() => {
    const peak = Math.max(...monthlyRevenue.map((d) => toNum(d.total)), 1);
    return Math.ceil(peak * 1.12);
  }, [monthlyRevenue]);

  const maxTopCustomers = useMemo(() => {
    const peak = Math.max(...topCustomersChart.map((d) => toNum(d.total)), 1);
    return Math.ceil(peak * 1.12);
  }, [topCustomersChart]);

  const ordersPaged = usePagedRows(ordersFiltered, ordersPageSize);
  const crmPaged = usePagedRows(crmActivities, crmPageSize);

  const tableTabCounts = useMemo(
    () => ({
      orders: ordersFiltered.length,
      crm: crmActivities.length,
    }),
    [ordersFiltered, crmActivities]
  );

  if (error && !sales) {
    return (
    <>
        <SalesToast toast={toast} />
        <div className="pm-page lm-pg dash-page">
          <div className="dash-state">
            <p className="dash-err">{error}</p>
            <button type="button" className="dash-btn" onClick={loadDashboard}>
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  if (loading && !sales) {
    return (
      <div className="pm-page lm-pg dash-page dash-page--center">
        <SalesPageLoader label="Loading administrator dashboard…" />
      </div>
    );
  }

  return (
    <>
      <SalesToast toast={toast} />
      <div className="pm-page lm-pg dash-page">
        <section className="lm-kpi-section dash-section" aria-label="Sales overview">
          <p className="lm-kpi-section-label">Sales overview</p>
          <div className="dash-kpi-grid">
            <SalesKpiCard
              label="Total revenue"
              value={fmtKpiMoney(kpis.totalRevenue)}
              sub="Invoiced & order value"
              icon="sales"
              accent={C.blue}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="Revenue this month"
              value={fmtKpiMoney(kpis.revenueThisMonth)}
              sub={currentMonthLabel()}
              icon="chart"
              accent={C.cyan}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="Submitted orders"
              value={kpis.submittedOrders}
              sub="Confirmed sales orders"
              icon="package"
              accent={C.blue}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="Active customers"
              value={kpis.activeCustomers}
              sub="With sales activity"
              icon="users"
              accent={C.teal}
              iconSize={DASH_KPI_ICON_SIZE}
            />
          </div>
        </section>

        <section className="lm-kpi-section dash-section" aria-label="Pipeline and collections">
          <p className="lm-kpi-section-label">Pipeline &amp; collections</p>
          <div className="dash-kpi-grid">
            <SalesKpiCard
              label="Pipeline value"
              value={fmtKpiMoney(kpis.pipelineValue)}
              sub="Open opportunity value"
              icon="magnet"
              accent={C.purple}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="Open opportunities"
              value={kpis.openOpps}
              sub="In sales pipeline"
              icon="briefcase"
              accent={C.amber}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="Outstanding"
              value={fmtKpiMoneyOrDash(collectionKpis.outstanding)}
              sub={collectionKpis.outstandingSub}
              icon="cash"
              accent={C.red}
              iconSize={DASH_KPI_ICON_SIZE}
            />
            <SalesKpiCard
              label="To deliver"
              value={collectionKpis.toDeliver}
              sub="Pending delivery"
              icon="truck"
              accent={C.cyan}
              iconSize={DASH_KPI_ICON_SIZE}
            />
          </div>
        </section>

        {productDevItems.length > 0 ? (
          <div className="dash-alert-stack" role="status" aria-live="polite">
            {productDevItems.map((item) => {
              const approved = item.outcome === "approved";
              const productLabel = item.product || "New product";
              const oppLabel = item.opportunity || "—";
              return (
                <div
                  key={item.opportunity}
                  className={`dash-alert-banner${approved ? " dash-alert-banner--success" : ""}`}
                >
                  <p className="dash-alert-banner__text">
                    <strong>
                      {approved
                        ? "Manufacturing approved new product"
                        : "Manufacturing cannot produce this product"}
                    </strong>
                    <span>
                      {" "}
                      — {productLabel} on {oppLabel}
                      {approved
                        ? ". Create quotation when ready."
                        : ". Opportunity marked Closed Lost."}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="dash-btn dash-btn--sm"
                    onClick={() => viewProductDevResult(item.opportunity)}
                  >
                    View now
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="dash-filter-bar" aria-label="Dashboard filters">
          <div className="pm-list-filters dash-list-filters">
            <div className="pm-list-filters__field">
              <label className="pm-list-filters__label" htmlFor="dash-date-from">From</label>
              <input
                id="dash-date-from"
                type="date"
                className="pm-input pm-list-filters__input"
                value={dateFrom}
                max={salesToday()}
                onChange={(e) => {
                  const next = applyPastFromDate(e.target.value, dateTo);
                  setDateFrom(next.from);
                  setDateTo(next.to);
                }}
              />
            </div>
            <div className="pm-list-filters__field">
              <label className="pm-list-filters__label" htmlFor="dash-date-to">To</label>
              <input
                id="dash-date-to"
                type="date"
                className="pm-input pm-list-filters__input"
                value={dateTo}
                min={dateFrom || undefined}
                max={salesToday()}
                onChange={(e) => setDateTo(applyPastToDate(e.target.value, dateFrom))}
              />
            </div>
            <SelectFilter label="Executive" value={executive} onChange={setExecutive} options={filterOptions.execs} />
            <SelectFilter label="Customer" value={customer} onChange={setCustomer} options={filterOptions.custs} />
          </div>
          {hasFilters && (
            <button type="button" className="dash-btn dash-btn--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          {drill && (
            <p className="dash-drill-hint">
              Chart filter: <strong>{drill.type}</strong> → {String(drill.value)}
              <button type="button" className="dash-link-btn" onClick={() => setDrill(null)}>
                Clear
              </button>
            </p>
          )}
        </div>

        <section className="dash-section">
          <p className="lm-kpi-section-label">Analytics</p>
        <div className="dash-charts-grid">
          <DashCard
            title="Sales funnel"
            chartWrap
            meta="Lead → Sales Order"
            active={drill?.type === "funnel"}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={funnelData}
                margin={{ ...CHART_MARGIN, left: 4, bottom: 8 }}
                barCategoryGap="22%"
                onClick={(state) => {
                  const row = state?.activePayload?.[0]?.payload;
                  if (row?.key) setDrill((d) => (d?.value === row.key ? null : { type: "funnel", value: row.key }));
                }}
              >
                <CartesianGrid strokeDasharray="4 8" stroke={C.chartGrid} vertical={false} strokeOpacity={0.6} />
                <XAxis dataKey="name" tick={CHART_TICK} axisLine={{ stroke: C.chartAxis }} tickLine={false} interval={0} />
                <YAxis width={40} domain={[0, maxFunnel]} allowDecimals={false} tick={CHART_TICK} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip valueMode="count" />} cursor={{ fill: "rgba(56,189,248,0.08)" }} />
                <Bar dataKey="value" name="Count" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={44} className="dash-bar-interactive" />
              </BarChart>
            </ResponsiveContainer>
          </DashCard>

          <DashCard title="Monthly revenue trend" chartWrap meta="Sales orders">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthlyRevenue} margin={{ ...CHART_MARGIN, left: 8, bottom: 6 }}>
                <CartesianGrid strokeDasharray="4 8" stroke={C.chartGrid} vertical={false} strokeOpacity={0.6} />
                <XAxis dataKey="month" tick={CHART_TICK} axisLine={{ stroke: C.chartAxis }} tickLine={false} />
                <YAxis width={48} domain={[0, maxMonthly]} tickFormatter={(v) => fmtK(v)} tick={CHART_TICK} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip valueMode="currency" />} />
                <Line type="monotone" dataKey="total" name="Revenue" stroke={C.blue} strokeWidth={2} dot={{ r: 3, fill: C.blue }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </DashCard>

          <DashCard
            title="Top customers by revenue"
            chartWrap
            meta="Sales orders"
            active={Boolean(customer)}
          >
            {topCustomersChart.length === 0 ? (
              <p className="dash-chart-empty">No customer revenue data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={268}>
                <BarChart
                  data={topCustomersChart}
                  margin={{ top: 8, right: 8, left: 4, bottom: 56 }}
                  barCategoryGap="22%"
                  onClick={(state) => {
                    const row = state?.activePayload?.[0]?.payload;
                    if (!row?.fullCustomer) return;
                    setCustomer((c) => (c === row.fullCustomer ? "" : row.fullCustomer));
                  }}
                >
                  <CartesianGrid strokeDasharray="4 8" stroke={C.chartGrid} vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="customer"
                    interval={0}
                    height={56}
                    tick={{ fontSize: 11, fill: C.muted, fontWeight: 600 }}
                    angle={-38}
                    textAnchor="end"
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    width={48}
                    domain={[0, maxTopCustomers]}
                    tickFormatter={(v) => fmtK(v)}
                    tick={CHART_TICK}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<ChartTip valueMode="currency" />}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullCustomer || ""}
                  />
                  <Bar
                    dataKey="total"
                    name="Revenue"
                    fill={C.green}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                    className="dash-bar-interactive"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DashCard>

          <DashCard
            title="Order status mix"
            chartWrap
            meta="Filtered sales orders"
            active={drill?.type === "status"}
          >
            {orderStatusChart.length === 0 ? (
              <p className="dash-chart-empty">No orders match filters.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={orderStatusChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="46%"
                    innerRadius={54}
                    outerRadius={86}
                    paddingAngle={2}
                    stroke="transparent"
                    isAnimationActive={false}
                    onClick={(entry) => {
                      const status = entry?.fullStatus || entry?.name;
                      if (status) setDrillStatus(status);
                    }}
                  >
                    {orderStatusChart.map((row, index) => (
                      <Cell
                        key={row.fullStatus || row.name}
                        fill={ORDER_STATUS_COLORS[index % ORDER_STATUS_COLORS.length]}
                        className="dash-bar-interactive"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => (
                      <ChartTip
                        active={active}
                        payload={payload}
                        label={payload?.[0]?.payload?.fullStatus || payload?.[0]?.name}
                        valueMode="count"
                      />
                    )}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", paddingTop: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </DashCard>
          </div>
        </section>

        <section className="dash-section">
          <p className="lm-kpi-section-label">Recent activity</p>
          <div className="dash-nav-pane lm-card" aria-label="Recent records">
          <nav className="dash-nav-tabs" role="tablist">
            {TABLE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTableTab === tab.id}
                className={`dash-nav-tab${activeTableTab === tab.id ? " dash-nav-tab--active" : ""}`}
                onClick={() => setActiveTableTab(tab.id)}
              >
                {tab.label}
                <span className="dash-nav-tab-count">{tableTabCounts[tab.id]}</span>
              </button>
            ))}
          </nav>

          <div className="dash-nav-panel" role="tabpanel">
            {activeTableTab === "orders" && (
              ordersFiltered.length === 0 ? (
                <p className="dash-chart-empty">No orders match filters.</p>
          ) : (
            <>
            <div className="dash-table-wrap">
              <table className="pm-table dash-table">
                <thead>
                  <tr>
                          <th>Order</th>
                    <th>Customer</th>
                          <th>Status</th>
                          <th className="dash-th-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                        {ordersPaged.pageRows.map((o, i) => (
                          <tr
                            key={o.name || i}
                            className="dash-row dash-row--click"
                            role="button"
                            tabIndex={0}
                            onClick={() => openSalesOrder(o.name)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openSalesOrder(o.name);
                              }
                            }}
                          >
                            <td><span className="dash-ref">{o.name}</span></td>
                            <td>{truncLabel(o.customer, 24)}</td>
                            <td><span className="dash-pill">{o.status || "—"}</span></td>
                            <td className="dash-td-right">{fmtFull(o.grand_total)}</td>
                    </tr>
                        ))}
                </tbody>
              </table>
            </div>
              <div className="sales-table-pagination">
                <label className="sales-table-pagination__size">
                  <span>Per page</span>
                  <select
                    value={ordersPageSize}
                    aria-label="Rows per page"
                    className="sales-table-pagination__select"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) {
                        setOrdersPageSize(n);
                        ordersPaged.resetPage();
                      }
                    }}
                  >
                    {SALES_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <ListPagination
                  page={ordersPaged.page}
                  totalPages={ordersPaged.totalPages}
                  total={ordersPaged.total}
                  pageSize={ordersPageSize}
                  onPageChange={ordersPaged.setPage}
                />
              </div>
                </>
              )
            )}

            {activeTableTab === "crm" && (
              crmActivities.length === 0 ? (
                <p className="dash-chart-empty">No CRM activity.</p>
              ) : (
                <>
                  <div className="dash-table-wrap">
                    <table className="pm-table dash-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Document</th>
                          <th>Customer</th>
                          <th>Updated</th>
                          <th className="dash-th-right">Value</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {crmPaged.pageRows.map((a, i) => (
                          <tr key={a.id || i} className="dash-row">
                            <td><span className="dash-type">{a.type}</span></td>
                            <td className="dash-col-doc">
                              <SalesDocumentId
                                id={a.ref}
                                onClick={() => openCrmDocument(a.type, a.ref)}
                              />
                            </td>
                            <td title={a.customer}>{truncLabel(a.customer, 32)}</td>
                            <td className="dash-col-date">{a.dateLabel}</td>
                            <td className="dash-td-right">{a.amount != null ? fmtFull(a.amount) : "—"}</td>
                            <td><CrmActivityStatus type={a.type} status={a.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sales-table-pagination">
                    <label className="sales-table-pagination__size">
                      <span>Per page</span>
                      <select
                        value={crmPageSize}
                        aria-label="Rows per page"
                        className="sales-table-pagination__select"
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) {
                            setCrmPageSize(n);
                            crmPaged.resetPage();
                          }
                        }}
                      >
                        {SALES_PAGE_SIZE_OPTIONS.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <ListPagination
                      page={crmPaged.page}
                      totalPages={crmPaged.totalPages}
                      total={crmPaged.total}
                      pageSize={crmPageSize}
                      onPageChange={crmPaged.setPage}
                    />
                  </div>
                </>
              )
            )}
          </div>
          </div>
        </section>
      </div>
    </>
  );
}

