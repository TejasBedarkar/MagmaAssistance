import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callMethod } from "../../../common/api/client.js";
import useFinanceToast from "../hooks/useFinanceToast.js";

export default function FinanceEwayDashboardAlert({ alert, onSaved }) {
  const items = alert?.items || [];
  const count = alert?.count ?? items.length;
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const { showToast } = useFinanceToast(5000);

  useEffect(() => {
    const next = {};
    items.forEach((row) => {
      next[row.work_order] = "";
    });
    setDrafts(next);
  }, [items]);

  const onSave = useCallback(
    async (row) => {
      const ewayBillNo = (drafts[row.work_order] || "").trim();
      if (!ewayBillNo) {
        showToast({ ok: false, message: "Enter an e-way bill number." });
        return;
      }
      setSaving(row.work_order);
      try {
        const result = await callMethod("finance_app.api.eway_bill.save_eway_bill", {
          work_order: row.work_order,
          eway_bill_no: ewayBillNo,
          dispatch_note: row.dispatch_note || undefined,
        });
        showToast({ ok: true, message: result?.message || "E-way bill saved." });
        onSaved?.();
      } catch (e) {
        showToast({ ok: false, message: e.message || "Could not save e-way bill." });
      }
      setSaving(null);
    },
    [drafts, onSaved, showToast]
  );

  if (count <= 0) return null;

  const first = items[0];
  const summary =
    count === 1 && first?.work_order
      ? ` for ${first.work_order}${first.customer_name ? ` (${first.customer_name})` : ""}.`
      : " before shipment.";

  return (
    <div className="finance-eway-alert">
      <div className="finance-alert-banner" role="alert">
        <div>
          <strong>
            {count} work order{count === 1 ? "" : "s"} ready for dispatch
          </strong>
          <span> — Generate e-way bill{summary}</span>
        </div>
        {count > 3 ? (
          <Link to="/finance/eway-bills" className="pm-btn pm-btn-sm">
            View all
          </Link>
        ) : null}
      </div>

      <div className="finance-eway-alert__panel pm-card">
        <div className="finance-eway-alert__head">
          <span className="finance-eway-alert__title">Pending e-way bills</span>
          <Link to="/finance/eway-bills" className="finance-eway-alert__link">
            Open full list
          </Link>
        </div>
        <div className="finance-eway-alert__rows">
          {items.slice(0, 3).map((row) => (
            <div key={row.work_order} className="finance-eway-alert__row">
              <div className="finance-eway-alert__meta">
                <span className="finance-eway-alert__wo">{row.work_order}</span>
                <span className="finance-eway-alert__sub">
                  {row.customer_name || "Customer"}
                  {row.deliverable ? ` · ${row.deliverable}` : ""}
                </span>
              </div>
              <div className="finance-eway-alert__actions">
                <label className="finance-eway-alert__field">
                  <span className="finance-eway-alert__field-label">E-way bill no.</span>
                  <input
                    className="pm-input finance-eway-alert__input"
                    placeholder="e.g. 123456789012"
                    value={drafts[row.work_order] ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [row.work_order]: e.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary pm-btn-sm finance-eway-alert__save"
                  disabled={saving === row.work_order}
                  onClick={() => onSave(row)}
                >
                  {saving === row.work_order ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
