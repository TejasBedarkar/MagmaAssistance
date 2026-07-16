import { useCallback, useEffect, useMemo, useState } from "react";
import { HiOutlineArrowDownTray, HiOutlineClipboardDocumentList } from "react-icons/hi2";
import ListPagination from "../../../../common/components/ListPagination.jsx";
import { SALES_PAGE_SIZE_OPTIONS } from "../../lib/pagination.js";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import SalesEmptyState from "../../components/SalesEmptyState.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import SalesDetailModal from "../../components/SalesDetailModal.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { SALES_COLORS as C } from "../../theme/tokens.js";
import {
  exportAuditLogsCsv,
  fetchAuditLogDetail,
  fetchAuditLogFilterOptions,
  fetchAuditLogStats,
  fetchAuditLogs,
} from "../../lib/auditLogApi.js";

const AUDIT_LOG_TIME_ZONE = "Asia/Kolkata";

function parseAuditTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = hasTimezone ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtTs(value) {
  const d = parseAuditTimestamp(value);
  if (!d) return value ? String(value) : "—";

  return d.toLocaleString("en-IN", {
    timeZone: AUDIT_LOG_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function JsonBlock({ title, data }) {
  const text = useMemo(() => {
    if (!data || (typeof data === "object" && !Object.keys(data).length)) return "{}";
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  return (
    <div className="audit-json-block">
      <p className="audit-json-title">{title}</p>
      <pre className="audit-json-pre">{text}</pre>
    </div>
  );
}

function DiffView({ oldValues, newValues }) {
  const keys = useMemo(() => {
    const set = new Set([
      ...Object.keys(oldValues || {}),
      ...Object.keys(newValues || {}),
    ]);
    return [...set].sort();
  }, [oldValues, newValues]);

  if (!keys.length) {
    return <p className="audit-detail-empty">No field-level changes recorded.</p>;
  }

  return (
    <div className="audit-diff-table-wrap">
      <table className="pm-table audit-diff-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Old value</th>
            <th>New value</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td>{key}</td>
              <td>{oldValues?.[key] == null ? "—" : String(oldValues[key])}</td>
              <td>{newValues?.[key] == null ? "—" : String(newValues[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hasJsonData(data) {
  return Boolean(data && typeof data === "object" && Object.keys(data).length);
}

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({
    today: 0,
    create: 0,
    update: 0,
    delete: 0,
    approvals: 0,
    failed: 0,
    total: 0,
  });
  const [options, setOptions] = useState({
    modules: [],
    actions: [],
    users: [],
    roles: [],
    document_types: [],
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("all");
  const [documentIdFilter, setDocumentIdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { toast, showToast } = useSalesToast(3200);

  const filterParams = useMemo(
    () => ({
      module: moduleFilter !== "all" ? moduleFilter : undefined,
      action: actionFilter !== "all" ? actionFilter : undefined,
      user: userFilter !== "all" ? userFilter : undefined,
      role: roleFilter !== "all" ? roleFilter : undefined,
      document_type: documentTypeFilter !== "all" ? documentTypeFilter : undefined,
      document_id: documentIdFilter.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: search.trim() || undefined,
    }),
    [
      moduleFilter,
      actionFilter,
      userFilter,
      roleFilter,
      documentTypeFilter,
      documentIdFilter,
      dateFrom,
      dateTo,
      search,
    ],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listPayload, statsPayload] = await Promise.all([
        fetchAuditLogs({ ...filterParams, page, page_size: pageSize }),
        fetchAuditLogStats(filterParams),
      ]);
      setRows(Array.isArray(listPayload?.rows) ? listPayload.rows : []);
      setTotal(Number(listPayload?.total) || 0);
      setStats({
        today: Number(statsPayload?.today) || 0,
        create: Number(statsPayload?.create) || 0,
        update: Number(statsPayload?.update) || 0,
        delete: Number(statsPayload?.delete) || 0,
        approvals: Number(statsPayload?.approvals) || 0,
        failed: Number(statsPayload?.failed) || 0,
        total: Number(statsPayload?.total) || 0,
      });
    } catch (e) {
      setRows([]);
      setTotal(0);
      showToast(e?.message || "Unable to load audit logs.", "error");
    } finally {
      setLoading(false);
    }
  }, [filterParams, page, pageSize, showToast]);

  useEffect(() => {
    fetchAuditLogFilterOptions()
      .then((payload) => setOptions(payload || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openDetail = async (row) => {
    if (!row?.id) return;
    setDetailLoading(true);
    setSelected(row);
    try {
      const detail = await fetchAuditLogDetail(row.id);
      setSelected(detail || row);
    } catch (e) {
      showToast(e?.message || "Unable to load audit details.", "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const payload = await exportAuditLogsCsv(filterParams);
      const blob = new Blob([payload?.content || ""], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payload?.filename || "sales_audit_logs.csv";
      link.click();
      URL.revokeObjectURL(url);
      showToast("Audit logs exported.", "success");
    } catch (e) {
      showToast(e?.message || "Export failed.", "error");
    } finally {
      setExporting(false);
    }
  };

  const kpiCards = [
    { key: "today", label: "Today logs", value: stats.today },
    { key: "create", label: "Create actions", value: stats.create },
    { key: "update", label: "Update actions", value: stats.update },
    { key: "delete", label: "Delete actions", value: stats.delete },
    { key: "approvals", label: "Approvals", value: stats.approvals },
    { key: "failed", label: "Failed operations", value: stats.failed, tone: stats.failed > 0 ? "danger" : "default" },
  ];

  return (
    <div className="pm-page audit-logs-page">
      <div className="pm-page-hd audit-logs-hd">
        <div>
          <h1 className="pm-page-title">Audit logs</h1>
          <p className="pm-page-sub">Sales module activity across leads, opportunities, quotations, orders, customers, and returns.</p>
        </div>
        <button
          type="button"
          className="pm-btn pm-btn-secondary audit-export-btn"
          onClick={handleExport}
          disabled={exporting || loading}
        >
          <HiOutlineArrowDownTray size={16} aria-hidden />
          <span>{exporting ? "Exporting…" : "Export CSV"}</span>
        </button>
      </div>

      <div className="audit-kpis pipe-kpis pipe-dash-kpis--static">
        {kpiCards.map((card) => (
          <SalesKpiCard
            key={card.key}
            compact
            label={card.label}
            value={card.value}
            tone={card.tone}
            aria-label={`${card.label}: ${card.value}`}
          />
        ))}
      </div>

      <div className="audit-filters sl-card">
        <div className="sl-card-hd">
          <span className="sl-card-title">Filters</span>
        </div>
        <div className="sl-card-body audit-filters-grid">
          <input
            className="pipe-search"
            placeholder="Search document, user, action…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select className="pipe-select" value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }}>
            <option value="all">All modules</option>
            {(options.modules || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select className="pipe-select" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
            <option value="all">All actions</option>
            {(options.actions || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select className="pipe-select" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}>
            <option value="all">All users</option>
            {(options.users || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select className="pipe-select" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="all">All roles</option>
            {(options.roles || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select className="pipe-select" value={documentTypeFilter} onChange={(e) => { setDocumentTypeFilter(e.target.value); setPage(1); }}>
            <option value="all">All document types</option>
            {(options.document_types || []).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input
            className="pipe-search"
            placeholder="Document ID"
            value={documentIdFilter}
            onChange={(e) => { setDocumentIdFilter(e.target.value); setPage(1); }}
          />
          <input type="date" className="pipe-search" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          <input type="date" className="pipe-search" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          <button type="button" className="pm-btn pm-btn-primary" onClick={() => { setPage(1); load(); }}>
            Apply
          </button>
        </div>
      </div>

      {loading ? (
        <SalesPageLoader label="Loading audit logs…" />
      ) : (
        <div className="sl-card audit-table-card">
          <div className="sl-card-hd">
            <span className="sl-card-title">
              <HiOutlineClipboardDocumentList size={16} aria-hidden />
              Activity log
            </span>
            <span className="audit-total-label">{total.toLocaleString("en-IN")} records</span>
          </div>
          <div className="sl-card-body">
            {rows.length === 0 ? (
              <SalesEmptyState title="No audit logs found" subtitle="Try adjusting filters or perform a sales action to generate logs." />
            ) : (
              <>
                <div className="pipe-table-wrap">
                  <table className="pm-table pipe-table audit-table">
                    <thead>
                      <tr>
                        <th>Date &amp; time</th>
                        <th>Module</th>
                        <th>Document ID</th>
                        <th>Action</th>
                        <th>User</th>
                        <th>Role</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="pipe-row-click" onClick={() => openDetail(row)}>
                          <td className="audit-cell-time">{fmtTs(row.timestamp)}</td>
                          <td className="audit-cell-module">{row.module || "—"}</td>
                          <td className="audit-cell-id">{row.document_id || "—"}</td>
                          <td className="audit-cell-action">
                            <span className="audit-action-pill" title={row.action || "—"}>
                              {row.action || "—"}
                            </span>
                          </td>
                          <td className="audit-cell-user">{row.user_label || row.user || "—"}</td>
                          <td className="audit-cell-role">{row.role || "—"}</td>
                          <td className="audit-remarks-cell" title={row.remarks || "—"}>{row.remarks || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ListPagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  pageSizeOptions={SALES_PAGE_SIZE_OPTIONS}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {selected ? (
        <SalesDetailModal
          title={`Audit log #${selected.id}`}
          wide
          list
          onClose={() => setSelected(null)}
        >
          {detailLoading ? (
            <SalesPageLoader label="Loading details…" />
          ) : (
            <div className="audit-detail">
              <div className="audit-detail-grid">
                <div><span className="audit-detail-label">Timestamp</span><p>{fmtTs(selected.timestamp)}</p></div>
                <div><span className="audit-detail-label">Module</span><p>{selected.module || "—"}</p></div>
                <div><span className="audit-detail-label">Document ID</span><p>{selected.document_id || "—"}</p></div>
                <div><span className="audit-detail-label">Action</span><p>{selected.action || "—"}</p></div>
                <div><span className="audit-detail-label">User</span><p>{selected.user_label || selected.user || "—"}</p></div>
                <div><span className="audit-detail-label">Role</span><p>{selected.role || "—"}</p></div>
                <div><span className="audit-detail-label">IP address</span><p>{selected.ip_address || "—"}</p></div>
              </div>
              {selected.remarks ? (
                <div className="audit-detail-remarks">
                  <span className="audit-detail-label">Remarks</span>
                  <p>{selected.remarks}</p>
                </div>
              ) : null}
              {hasJsonData(selected.old_values) || hasJsonData(selected.new_values) ? (
                <>
                  <DiffView oldValues={selected.old_values} newValues={selected.new_values} />
                  <div className="audit-json-grid">
                    <JsonBlock title="Old values (JSON)" data={selected.old_values} />
                    <JsonBlock title="New values (JSON)" data={selected.new_values} />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </SalesDetailModal>
      ) : null}

      <SalesToast toast={toast} />
    </div>
  );
}
