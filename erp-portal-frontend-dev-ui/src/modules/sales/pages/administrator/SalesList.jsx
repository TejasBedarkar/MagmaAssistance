import { useEffect, useState, useCallback } from "react";
import { HiOutlineClipboardDocumentList } from "react-icons/hi2";
import api from "../../lib/apiUtils";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import usePagedRows from "../../../../common/hooks/usePagedRows.js";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import StatusBadge from "../../components/StatusBadge.jsx";
import SalesDocumentId from "../../components/SalesDocumentId.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import SalesModalFooter from "../../components/SalesModalFooter.jsx";
import { salesToday, applyPastFromDate, applyPastToDate } from "../../lib/dateValidation.js";

const TYPE_STYLE = {
  "Sales Order": { fg: C.blue,   bg: C.blueLt,   dot: C.blue   },
  "Quotation":   { fg: C.amber,  bg: C.amberLt,  dot: C.amber  },
  "Invoice":     { fg: C.green,  bg: C.greenLt,  dot: C.green  },
};

const KPI_SPECS = [
  { id: "so", label: "Sales Orders", accent: C.blue, icon: "package", countKey: "total_so", valueKey: "total_so_value", sub: "Total order value" },
  { id: "quot", label: "Quotations", accent: C.amber, icon: "document", countKey: "total_quotations", valueKey: "total_quot_value", sub: "Quoted amount" },
  {
    id: "records",
    label: "All Records",
    accent: C.teal,
    icon: "folder",
    count: (summary) => (
      Number(summary?.total_so || 0)
      + Number(summary?.total_quotations || 0)
      + Number(summary?.total_invoices || 0)
    ),
    sub: "Orders + quotations",
  },
  {
    id: "pipeline_value",
    label: "Pipeline Value",
    accent: C.purple,
    icon: "sales",
    format: "amount",
    value: (summary) => (
      Number(summary?.total_so_value || 0)
      + Number(summary?.total_quot_value || 0)
    ),
    sub: "Orders + quotations",
  },
];

function applySalesListViewFilters(rows, { activeTab, search }) {
  const tabRows = activeTab === "so"
    ? rows.filter((i) => i.doctype === "Sales Order")
    : activeTab === "quot"
      ? rows.filter((i) => i.doctype === "Quotation")
      : rows;
  const q = search.trim().toLowerCase();
  return tabRows
    .filter((i) =>
      !q || [i.id, i.customer, i.status, i.reference].join(" ").toLowerCase().includes(q),
    );
}

const SALES_LIST_CSV_HEADERS = [
  "id",
  "type",
  "customer",
  "date",
  "due_date",
  "amount",
  "currency",
  "status",
  "billing_status",
  "delivery_status",
  "reference",
  "outstanding",
];

function escapeCsvField(val) {
  const s = val == null ? "" : String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function salesListToCsv(rows) {
  const head = SALES_LIST_CSV_HEADERS.map(escapeCsvField).join(",");
  const body = rows.map((r) =>
    SALES_LIST_CSV_HEADERS.map((h) => escapeCsvField(r[h] ?? "")).join(","),
  ).join("\r\n");
  return `${head}\r\n${body}\r\n`;
}

function salesItemToCsvRow(item) {
  return {
    id: item.id ?? "",
    type: item.type_label || item.doctype || "",
    customer: item.customer ?? "",
    date: item.date ?? "",
    due_date: item.due_date ?? "",
    amount: item.amount ?? "",
    currency: item.currency ?? "",
    status: item.status ?? "",
    billing_status: item.billing_status ?? "",
    delivery_status: item.delivery_status ?? "",
    reference: item.reference ?? "",
    outstanding: item.outstanding ?? "",
  };
}

const fmt  = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n/1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n/1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n/1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const Card = ({ title, children, flexClass, action }) => (
  <div className={`sl-card${flexClass ? ` ${flexClass}` : ""}`}>
    {title ? (
      <div className="sl-card-hd">
        <span className="sl-card-title">{title}</span>
        {action}
      </div>
    ) : null}
    <div className="sl-card-body">{children}</div>
  </div>
);

/* ─── Type Badge ─────────────────────────────────────────────── */
const TypeBadge = ({ label }) => {
  const s = TYPE_STYLE[label] || { fg: C.muted, bg: C.surface2, dot: C.muted };
  return (
    <span className="sl-type-badge" style={{ "--pill-fg": s.fg, "--pill-bg": s.bg, "--pill-dot": s.dot || s.fg }}>
      <span className="sl-type-dot" />
      {label}
    </span>
  );
};

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function SalesList({ initialTab = "all" }) {
  const [items, setItems]       = useState([]);
  const [summary, setSummary]   = useState(null);
  const [filterOpts, setFilterOpts] = useState({ customers: [], doctypes: [], so_statuses: [] });
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [typeFilter, setTypeFilter]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [custFilter, setCustFilter]   = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
    const [viewItem, setViewItem] = useState(null);
  const [activeTab, setActiveTab] = useState(
    () => (["all", "so", "quot"].includes(initialTab) ? initialTab : "all"),
  );
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const [error, setError] = useState(null);

  const { toast, showToast } = useSalesToast(3000);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (typeFilter)   params.doctype_filter   = typeFilter;
      if (statusFilter) params.status_filter    = statusFilter;
      if (custFilter)   params.customer_filter  = custFilter;
      if (fromDate)     params.from_date        = fromDate;
      if (toDate)       params.to_date          = toDate;

      const [listR, sumR, optR] = await Promise.allSettled([
        api.get("/api/method/sales_app.api.sales_order.get_sales_list", { params }),
        api.get("/api/method/sales_app.api.sales_order.get_sales_summary"),
        api.get("/api/method/sales_app.api.sales_order.get_sales_filter_options"),
      ]);

      // Check for 417 — means file not found / Frappe not restarted
      const check417 = (r) => r.status === "rejected" &&
        (r.reason?.response?.status === 417 || r.reason?.response?.status === 404);

      if (check417(listR) || check417(sumR)) {
        setError("417");
        setItems([]);
        return;
      }

      if (listR.status === "fulfilled")
        setItems(listR.value?.data?.message || []);
      else { console.error("list error", listR.reason); setItems([]); }

      if (sumR.status === "fulfilled")
        setSummary(sumR.value?.data?.message || null);

      if (optR.status === "fulfilled" && optR.value?.data?.message)
        setFilterOpts(optR.value.data.message);

    } finally { setLoading(false); }
  }, [typeFilter, statusFilter, custFilter, fromDate, toDate]);

  const exportSalesListCsv = useCallback(async () => {
    setExporting(true);
    try {
      const params = { limit: 10000 };
      if (typeFilter) params.doctype_filter = typeFilter;
      if (statusFilter) params.status_filter = statusFilter;
      if (custFilter) params.customer_filter = custFilter;
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;

      const res = await api.get("/api/method/sales_app.api.sales_order.get_sales_list", { params });
      const fetched = res?.data?.message || [];
      const rows = applySalesListViewFilters(fetched, { activeTab, search });

      if (!rows.length) {
        showToast("No records to export for the current filters", "error");
        return;
      }

      const blob = new Blob([salesListToCsv(rows.map(salesItemToCsvRow))], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      let fname = `sales_list_export_${stamp}`;
      if (fromDate || toDate) fname += `_${fromDate || "start"}_${toDate || "end"}`;
      a.download = `${fname}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const rangeNote = fromDate || toDate
        ? ` (${fromDate || "…"} to ${toDate || "…"})`
        : "";
      showToast(`Downloaded ${rows.length} record${rows.length === 1 ? "" : "s"}${rangeNote}`);
    } catch (err) {
      console.error("sales list csv export", err);
      showToast("Failed to download CSV. Please try again.", "error");
    } finally {
      setExporting(false);
    }
  }, [typeFilter, statusFilter, custFilter, fromDate, toDate, activeTab, search]);

  useEffect(() => { loadData(); }, [loadData]);

  // Tab counts
  const soItems   = items.filter(i => i.doctype === "Sales Order");
  const quotItems = items.filter(i => i.doctype === "Quotation");

  const tabItems = activeTab === "so"   ? soItems
                 : activeTab === "quot" ? quotItems
                 : items;

  const filtered = tabItems
    .filter((i) =>
      [i.id, i.customer, i.status, i.reference].join(" ").toLowerCase().includes(search.toLowerCase()),
    );

  const { page, setPage, totalPages, pageRows: pagedItems, total, resetPage } =
    usePagedRows(filtered, pageSize);

  const onSearchChange = (v) => {
    setSearch(v);
    resetPage();
  };

  useEffect(() => {
    resetPage();
  }, [activeTab, typeFilter, statusFilter, custFilter, fromDate, toDate, pageSize]);

  const totalFiltered = filtered.reduce((s, i) => s + (i.amount || 0), 0);

  // ── 417 / file-not-found error screen ──────────────────────
  if (error === "417") return (
    <>
      <SalesToast toast={toast} />
      <div className="pm-page sl-page">
        <div className="sales-api-err">
          <div className="sales-api-err__icon" aria-hidden>⚙️</div>
          <h2 className="sales-api-err__title">API Not Registered (417)</h2>
          <p className="sales-api-err__desc">
            Frappe cannot find the <code className="sales-api-err__code-inline">sales_list</code> module.
            You need to place the file and restart Frappe.
          </p>
          <div className="sales-api-err__panel">
            <p className="sales-api-err__panel-title">✅ Two steps to fix this:</p>
            <div className="sales-api-err__steps">
              {[
                { step: "1", label: "Place the file", desc: "Save sales_list.py to your app at:", code: "your_frappe_site/apps/sales_app/sales_app/api/sales_list.py" },
                { step: "2", label: "Restart Frappe", desc: "Then run in terminal:", code: "bench restart" },
              ].map((s) => (
                <div key={s.step} className="sales-api-err__step">
                  <div className="sales-api-err__step-num">{s.step}</div>
                  <div className="sales-api-err__step-body">
                    <div className="sales-api-err__step-label">{s.label}</div>
                    <div className="sales-api-err__step-desc">{s.desc}</div>
                    <code className="sales-api-err__code">{s.code}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="sl-btn-retry sl-api-retry" onClick={loadData}>
            Retry
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <SalesToast toast={toast} />

      <div className="pm-page sl-page">

        <div className="sl-export-toolbar" aria-label="Export and date range">
          <span className="sl-export-toolbar-label">Date range</span>
          <div className="sl-date-group" aria-label="Date range">
            <input
              className="sl-date"
              type="date"
              value={fromDate}
              max={salesToday()}
              onChange={(e) => {
                const next = applyPastFromDate(e.target.value, toDate);
                setFromDate(next.from);
                setToDate(next.to);
              }}
              title="From date"
              aria-label="From date"
            />
            <span className="sl-date-sep">→</span>
            <input
              className="sl-date"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              max={salesToday()}
              onChange={(e) => setToDate(applyPastToDate(e.target.value, fromDate))}
              title="To date"
              aria-label="To date"
            />
          </div>
          <button
            type="button"
            className="sl-btn-export"
            disabled={loading || exporting}
            onClick={exportSalesListCsv}
            title={
              fromDate || toDate
                ? "Download CSV for the selected date range and filters"
                : "Download CSV for all records matching the current filters"
            }
          >
            <DownloadIcon />
            <span>{exporting ? "Exporting…" : "Export CSV"}</span>
          </button>
        </div>

        {/* ── KPI STRIP ── */}
        <section className="sl-kpi-section" aria-label="Sales list KPIs">
          <p className="sl-kpi-section-label">Sales List KPIs</p>
          <div className="sl-kpi-grid">
          {KPI_SPECS.map((spec) => {
            const isAmountKpi = spec.format === "amount";
            const amount = typeof spec.value === "function"
              ? Number(spec.value(summary) || 0)
              : Number(summary?.[spec.valueKey] || 0);
            const count = typeof spec.count === "function"
              ? Number(spec.count(summary) || 0)
              : spec.countKey ? (summary?.[spec.countKey] || 0) : null;
            const value = isAmountKpi ? fmtK(amount) : count;
            const valueSub = isAmountKpi || !spec.valueKey ? null : fmtK(amount);
            return (
              <SalesKpiCard
                key={spec.id}
                label={spec.label}
                value={value}
                valueSub={valueSub}
                sub={spec.sub}
                accent={spec.accent}
                icon={spec.icon}
              />
            );
          })}
          </div>
        </section>

        <div className="sl-filter-bar" aria-label="Sales list filters">
          <div className="pm-list-filters sl-list-filters">
            <div className="pm-list-filters__field">
              <label className="pm-list-filters__label" htmlFor="sl-type-filter">Type</label>
              <select
                id="sl-type-filter"
                className="pm-select pm-list-filters__select"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
              >
                <option value="">All Types</option>
                {filterOpts.doctypes.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="pm-list-filters__field">
              <label className="pm-list-filters__label" htmlFor="sl-customer-filter">Customer</label>
              <select
                id="sl-customer-filter"
                className="pm-select pm-list-filters__select"
                value={custFilter}
                onChange={(e) => setCustFilter(e.target.value)}
                aria-label="Filter by customer"
              >
                <option value="">All Customers</option>
                {filterOpts.customers.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
              </select>
            </div>
            <div className="pm-list-filters__field pm-list-filters__field--grow">
              <label className="pm-list-filters__label" htmlFor="sl-search-filter">Search</label>
              <input
                id="sl-search-filter"
                className="pm-input"
                type="search"
                placeholder="Search…"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
          {(typeFilter || custFilter || search || fromDate || toDate) && (
            <button
              type="button"
              className="sl-clear-btn"
              onClick={() => {
                setTypeFilter("");
                setCustFilter("");
                setSearch("");
                setFromDate("");
                setToDate("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ── LIST TABLE ── */}
        <div>
        <Card>
          <div className="sl-table-toolbar">
            <div className="sl-tabs">
              {[
                { id: "all",  label: "All",         count: items.length },
                { id: "so",   label: "Sales Orders", count: soItems.length },
                { id: "quot", label: "Quotations",   count: quotItems.length },
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={`sl-tab ${activeTab === t.id ? "sl-tab-active" : ""}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                  <span className="sl-tab-count">{t.count}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <SalesPageLoader label="Loading sales records…" />
          ) : filtered.length === 0 ? (
            <SalesEmptyState
              icon={HiOutlineClipboardDocumentList}
              title="No records found"
              description={search ? "Try adjusting filters, search, or clear the search term." : "Try adjusting your filters or search term."}
            />
          ) : (
            <>
              <div className="sales-table-scroll sl-table-scroll">
                <table className="pm-table sl-table">
                  <thead>
                    <tr>
                      <th className="sl-col-num">#</th>
                      <th className="sl-col-id">ID</th>
                      <th className="sl-col-type">Type</th>
                      <th className="sl-col-customer">Customer</th>
                      <th className="sl-col-date">Date</th>
                      <th className="sl-col-due">Due / Valid Till</th>
                      <th className="sl-col-amount">Amount</th>
                      <th className="sl-col-status">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((item, i) => {
                      const isOverdue = item.due_date && new Date(item.due_date) < new Date()
                        && !["Completed", "Paid", "Cancelled", "Closed"].includes(item.status);
                      const rowIdx = (page - 1) * pageSize + i;
                      return (
                        <tr key={`${item.doctype}-${item.id}`} className="sl-row" style={{ "--i": rowIdx }}
                          onClick={() => setViewItem(item)} title="Click to view details">
                          <td className="sl-td-num sl-col-num">{rowIdx + 1}</td>
                          <td className="sl-col-id">
                            <SalesDocumentId id={item.id} />
                            {item.reference && <div className="sl-ref-sub">{item.reference}</div>}
                          </td>
                          <td className="sl-col-type"><TypeBadge label={item.type_label} /></td>
                          <td className="sl-td-customer sl-col-customer">{item.customer || "—"}</td>
                          <td className="sl-td-muted sl-col-date">{item.date || "—"}</td>
                          <td className="sl-col-due">
                            <span className={isOverdue ? "sl-td-overdue" : "sl-td-muted"}>
                              {item.due_date || "—"}
                              {isOverdue && <span className="sl-late-tag">LATE</span>}
                            </span>
                          </td>
                          <td className="sl-td-amount sl-col-amount">{fmt(item.amount)}</td>
                          <td className="sl-col-status"><StatusBadge status={item.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
              {/* Footer total */}
              <div className="sl-table-footer">
                <span>{filtered.length} records</span>
                <span className="sl-table-footer-total">{fmt(totalFiltered)}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      </div>

      {/* ── DETAIL MODAL (center popup) ── */}
      {viewItem && (
        <SalesDetailModal
          list
          title={viewItem.id}
          onClose={() => setViewItem(null)}
        >
          <div className="sl-view-modal">
            <div className="sl-view-type-row">
              <TypeBadge label={viewItem.type_label} />
            </div>
            <div className="sl-view-hero">
              <div className="sl-view-hero-amount">{fmt(viewItem.amount)}</div>
              <div className="sl-view-hero-customer">{viewItem.customer || "—"}</div>
              <div className="sl-view-hero-badges">
                <StatusBadge status={viewItem.status} />
                {viewItem.billing_status ? <StatusBadge status={viewItem.billing_status} /> : null}
                {viewItem.delivery_status ? <StatusBadge status={viewItem.delivery_status} /> : null}
              </div>
            </div>
            <div className="sl-view-grid">
              {[
                { label: "Document Type", value: viewItem.doctype },
                { label: "Customer", value: viewItem.customer },
                { label: "Date", value: viewItem.date },
                { label: "Due / Valid Till", value: viewItem.due_date },
                { label: "Currency", value: viewItem.currency },
                { label: "Reference", value: viewItem.reference },
                viewItem.outstanding != null && { label: "Outstanding", value: fmt(viewItem.outstanding) },
              ]
                .filter(Boolean)
                .filter((r) => r.value)
                .map(({ label, value }) => (
                  <div key={label} className="sl-view-field">
                    <div className="sl-view-field-label">{label}</div>
                    <div className="sl-view-field-val">{value}</div>
                  </div>
                ))}
            </div>
          </div>
          <SalesModalFooter>
            <button type="button" className="pm-btn pm-btn-ghost sl-btn-ghost" onClick={() => setViewItem(null)}>
              Close
            </button>
          </SalesModalFooter>
        </SalesDetailModal>
      )}
    </>
  );
}

/* ─── CSS ─────────────────────────────────────────────────────── */
