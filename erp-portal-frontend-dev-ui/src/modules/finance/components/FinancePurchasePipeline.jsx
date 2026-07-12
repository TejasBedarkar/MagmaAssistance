import { Link } from "react-router-dom";
import { StatusPill } from "../../../common/components/StatusPill.jsx";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const TONE_MAP = {
  warn: "warn",
  info: "info",
  accent: "default",
  success: "success",
};

export default function FinancePurchasePipeline({ pipeline }) {
  const queues = pipeline?.queues || [];
  const actionable = queues.filter((q) =>
    ["draft_po", "ready_for_receipt", "ready_to_invoice"].includes(q.key)
  );
  if (!actionable.length) return null;

  return (
    <div className="pm-card finance-dash-card finance-billing-pipeline">
      <div className="finance-dash-card__head finance-billing-pipeline__head">
        <div>
          <span>Purchase procurement pipeline</span>
          {pipeline?.total_actionable > 0 ? (
            <p className="finance-billing-pipeline__meta">
              {pipeline.total_actionable} item{pipeline.total_actionable === 1 ? "" : "s"} need attention
            </p>
          ) : (
            <p className="finance-billing-pipeline__meta">No pending procurement actions</p>
          )}
        </div>
      </div>
      <div className="finance-billing-pipeline__grid">
        {actionable.map((queue) => (
          <Link key={queue.key} to={queue.href} className="finance-billing-pipeline__card">
            <div className="finance-billing-pipeline__card-top">
              <StatusPill tone={TONE_MAP[queue.tone] || "default"}>{queue.label}</StatusPill>
              <strong className="finance-billing-pipeline__count">{queue.count ?? 0}</strong>
            </div>
            <p className="finance-billing-pipeline__desc">{queue.description}</p>
            {(queue.samples || []).length > 0 ? (
              <ul className="finance-billing-pipeline__samples">
                {queue.samples.slice(0, 3).map((row) => (
                  <li key={row.name}>
                    <span>{row.name}</span>
                    <span className="finance-cell-muted">{row.supplier || "—"}</span>
                    {row.amount != null ? (
                      <span className="finance-cell-accent">{fmt(row.amount)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="finance-cell-muted finance-text-sm--flush">No items in this queue.</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
