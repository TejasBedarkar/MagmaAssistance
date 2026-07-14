import { useCallback, useEffect, useState } from "react";
import { HiOutlineArrowDownTray } from "react-icons/hi2";
import FinancePageLoader from "./FinancePageLoader.jsx";
import { buildAuditBody } from "../lib/financeActivityBody.js";
import {
  financeActivityActionClassName,
  financeActivityTone,
} from "../lib/financeActivityConstants.js";
import {
  exportDocumentAuditHistoryCsv,
  fetchDocumentAuditHistory,
} from "../lib/financeDocumentHistoryApi.js";

const TIME_ZONE = "Asia/Kolkata";

function parseTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = hasTimezone ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtTs(value) {
  const d = parseTimestamp(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Contextual audit trail for a finance document detail view. */
export default function FinanceDocumentHistory({ doctype, name, showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!doctype || !name) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const payload = await fetchDocumentAuditHistory(doctype, name);
      setRows(payload?.rows || []);
    } catch (e) {
      setRows([]);
      showToast?.({ type: "error", text: e?.message || "Could not load document history." });
    }
    setLoading(false);
  }, [doctype, name, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = useCallback(async () => {
    if (!doctype || !name) return;
    setExporting(true);
    try {
      const payload = await exportDocumentAuditHistoryCsv(doctype, name);
      if (!payload?.content) {
        showToast?.({ type: "error", text: "Export failed." });
        return;
      }
      const blob = new Blob([payload.content], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = payload.filename || "finance_audit.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      showToast?.({ type: "error", text: e?.message || "Export failed." });
    }
    setExporting(false);
  }, [doctype, name, showToast]);

  if (!doctype || !name) return null;

  return (
    <section className="finance-doc-history pm-card pm-task-timeline">
      <div className="pm-task-timeline__head finance-doc-history__header">
        <h2 className="pm-panel__title pm-task-timeline__title">Activity</h2>
        {rows.length > 0 ? (
          <button
            type="button"
            className="pm-btn pm-btn-ghost finance-doc-history__export"
            disabled={exporting}
            onClick={handleExport}
          >
            <HiOutlineArrowDownTray aria-hidden />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        ) : null}
      </div>

      {loading ? (
        <FinancePageLoader message="Loading activity…" />
      ) : rows.length === 0 ? (
        <p className="pm-form-field-hint pm-form-field-hint--flush finance-doc-history__empty">
          No activity recorded yet for this document.
        </p>
      ) : (
        <div
          className={`pm-task-timeline__scroll${
            rows.length > 4 ? " pm-task-timeline__scroll--limited" : ""
          }`}
          role="region"
          aria-label="Document activity log"
          tabIndex={rows.length > 4 ? 0 : undefined}
        >
          <ul className="pm-task-timeline__list">
            {rows.map((row) => {
              const action = row.action || "Action";
              const body = buildAuditBody(row);
              const tone = financeActivityTone(action);
              const actionClass = financeActivityActionClassName(tone);
              const author = row.user_label || row.user || "—";
              const metaSuffix = row.role ? ` (${row.role})` : "";

              return (
                <li key={row.id} className="pm-task-timeline__entry pm-task-timeline__entry--system">
                  <div className="pm-activity-item">
                    <div className="pm-activity-item__meta">
                      <span className={`pm-activity-item__action ${actionClass}`}>[{action}]</span>
                      {author}
                      {metaSuffix}
                      {row.timestamp ? ` · ${fmtTs(row.timestamp)}` : ""}
                    </div>
                    <div className="pm-activity-item__body">{body}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Compact latest-event hint for approval queue rows. */
export function FinanceAuditHint({ audit }) {
  if (!audit?.action) return <span className="finance-cell-muted">—</span>;
  return (
    <span className="finance-doc-history-hint" title={audit.remarks || undefined}>
      <span className="finance-doc-history-hint__action">{audit.action}</span>
      {audit.user ? <span className="finance-doc-history-hint__user"> · {audit.user}</span> : null}
    </span>
  );
}
