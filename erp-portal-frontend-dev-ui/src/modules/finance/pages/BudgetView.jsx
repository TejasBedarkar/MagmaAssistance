import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;
const fmtK = (n) => {
  n = Number(n || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const tooltipStyle = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
};

function budgetDocStatusLabel(docstatus) {
  return docstatus === 1 ? "Submitted" : docstatus === 0 ? "Draft" : "Cancelled";
}

function budgetDocStatusTone(docstatus) {
  return docstatus === 1 ? "info" : "default";
}

const emptyForm = () => ({
  naming_series: "BUDGET-.YYYY.-",
  budget_against: "Cost Center",
  company: "",
  cost_center: "",
  project: "",
  fiscal_year: "",
  monthly_distribution: "",
  applicable_on_material_request: false,
  applicable_on_purchase_order: false,
  applicable_on_booking_actual_expenses: false,
  accounts: [{ account: "", budget_amount: "" }],
});

export default function BudgetView() {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [opts, setOpts] = useState({
    companies: [],
    naming_series: ["BUDGET-.YYYY.-"],
    budget_against_options: ["Cost Center", "Project"],
    fiscal_years: [],
    monthly_distributions: [],
    cost_centers: [],
    projects: [],
    accounts: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast(4000);
  const [flt, setFlt] = useState({ id: "", against: "", company: "", fiscal_year: "" });
  const [viewBdg, setViewBdg] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const message = await callMethodGet("finance_app.api.budget.get_budgets");
      setBudgets(message || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  const loadOpts = useCallback(async (company) => {
    try {
      const params = company ? { company } : {};
      const m = await callMethodGet(toMethodGetUrl("finance_app.api.budget.get_budget_form_options", params));
      if (!m) return;
      setOpts(m);
      setForm((f) => {
        const next = { ...f };
        if (!f.company && m.company_default) next.company = m.company_default;
        if (!f.naming_series && m.naming_series?.length) next.naming_series = m.naming_series[0];
        return next;
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    loadOpts();
  }, [loadOpts]);

  useEffect(() => {
    if (showForm && form.company) loadOpts(form.company);
  }, [form.company, showForm, loadOpts]);

  const openBudget = async (name) => {
    try {
      const m = await callMethodGet(toMethodGetUrl("finance_app.api.budget.get_budget", { name }));
      if (m?.name) setViewBdg(m);
      else showToast({ type: "error", text: "Could not load budget." });
    } catch {
      showToast({ type: "error", text: "Could not load budget." });
    }
  };

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (flt.id && !String(b.name || "").toLowerCase().includes(flt.id.toLowerCase())) return false;
      if (flt.against && b.budget_against !== flt.against) return false;
      if (flt.company && !String(b.company || "").toLowerCase().includes(flt.company.toLowerCase())) return false;
      if (flt.fiscal_year && !String(b.fiscal_year || "").toLowerCase().includes(flt.fiscal_year.toLowerCase()))
        return false;
      return true;
    });
  }, [budgets, flt]);

  const chartData = filteredBudgets.map((b) => ({
    name:
      b.budget_against === "Project"
        ? b.project || b.name
        : b.cost_center?.split(" -")[0]?.replace(" - MD", "") || b.name,
    budget: b.total_budget || 0,
    actual: b.actual_spend || 0,
  }));

  const handleSave = async () => {
    if (!form.company) {
      showToast("Company is required.");
      return;
    }
    if (!form.fiscal_year) {
      showToast("Fiscal Year is required.");
      return;
    }
    if (form.budget_against === "Cost Center" && !form.cost_center) {
      showToast("Cost Center is required.");
      return;
    }
    if (form.budget_against === "Project" && !form.project) {
      showToast("Project is required.");
      return;
    }
    const lines = form.accounts.filter((a) => a.account && parseFloat(a.budget_amount) > 0);
    if (!lines.length) {
      showToast("Add at least one account with budget amount > 0.");
      return;
    }

    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.budget.create_budget", {
        naming_series: form.naming_series,
        budget_against: form.budget_against,
        company: form.company,
        fiscal_year: form.fiscal_year,
        cost_center: form.budget_against === "Cost Center" ? form.cost_center : "",
        project: form.budget_against === "Project" ? form.project : "",
        monthly_distribution: form.monthly_distribution || "",
        applicable_on_material_request: form.applicable_on_material_request ? 1 : 0,
        applicable_on_purchase_order: form.applicable_on_purchase_order ? 1 : 0,
        applicable_on_booking_actual_expenses: form.applicable_on_booking_actual_expenses ? 1 : 0,
        accounts: JSON.stringify(lines.map((a) => ({ account: a.account, budget_amount: parseFloat(a.budget_amount) }))),
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Budget saved.");
        setShowForm(false);
        setForm(emptyForm());
        load();
        loadOpts();
      } else {
        showToast(msg?.message || "Error saving budget.");
      }
    } catch (e) {
      showToast("Error: " + (e.message || "request failed"));
    }
    setSaving(false);
  };

  const tableColumns = [
    {
      key: "name",
      label: "ID",
      render: (b) => (
        <button type="button" onClick={() => openBudget(b.name)} className="finance-cell-link">
          {b.name}
        </button>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (b) => (
        <StatusPill tone={budgetDocStatusTone(b.docstatus)}>{budgetDocStatusLabel(b.docstatus)}</StatusPill>
      ),
    },
    {
      key: "budget_against",
      label: "Budget Against",
      render: (b) => (
        <span className="finance-dot-label">
          <span className="finance-dot" />
          {b.budget_against || "—"}
        </span>
      ),
    },
    {
      key: "company",
      label: "Company",
      render: (b) => (
        <span className="finance-cell-title finance-cell-ellipsis" title={b.company}>
          {b.company || "—"}
        </span>
      ),
    },
    {
      key: "fiscal_year",
      label: "Fiscal Year",
      render: (b) => <span className="finance-cell-muted">{b.fiscal_year || "—"}</span>,
    },
    {
      key: "total_budget",
      label: "Total Budget",
      render: (b) => <span className="finance-cell-success">{fmtK(b.total_budget)}</span>,
    },
  ];

  const emptyMessage =
    budgets.length === 0
      ? "No budgets found. Use + Add Budget above or create in ERPNext Accounting → Budget."
      : "No budgets match the current filters.";

  if (loading) {
    return (
      <div className="pm-page finance-page">
        <FinancePageLoader message="Loading budgets..." />
      </div>
    );
  }

  if (viewBdg) {
    const v = viewBdg;
    const pct = v.utilization_pct || 0;
    return (
      <div className="pm-page finance-page">
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setViewBdg(null)}>
          ← Back to List
        </button>
        <div className="pm-card">
          <div className="finance-detail-actions finance-detail-actions--center">
            <h2 className="finance-detail-title">{v.name}</h2>
            <StatusPill tone={budgetDocStatusTone(v.docstatus)}>{budgetDocStatusLabel(v.docstatus)}</StatusPill>
          </div>
          <div className="finance-field-grid--2">
            {[
              ["BUDGET AGAINST", v.budget_against],
              ["COMPANY", v.company],
              ["COST CENTER", v.cost_center],
              ["PROJECT", v.project],
              ["FISCAL YEAR", v.fiscal_year],
              ["MONTHLY DISTRIBUTION", v.monthly_distribution],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="finance-field-label">{label}</div>
                <div className="finance-field-value">{value || "—"}</div>
              </div>
            ))}
          </div>
          <div className="finance-control-section">
            <div className="finance-control-section__title">Control action</div>
            <div className="finance-control-section__body">
              <span>
                Applicable on Material Request:{" "}
                <strong className="finance-cell-title">{v.applicable_on_material_request ? "Yes" : "No"}</strong>
              </span>
              <span>
                Applicable on Purchase Order:{" "}
                <strong className="finance-cell-title">{v.applicable_on_purchase_order ? "Yes" : "No"}</strong>
              </span>
              <span>
                Applicable on booking actual expenses:{" "}
                <strong className="finance-cell-title">
                  {v.applicable_on_booking_actual_expenses ? "Yes" : "No"}
                </strong>
              </span>
            </div>
          </div>
          <div className="finance-stat-grid">
            <div className="pm-card finance-stat-tile--compact">
              <div className="finance-stat-tile__label finance-stat-tile__label--sm">Total budget</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--md finance-stat-tile__value--accent">
                {fmtK(v.total_budget)}
              </div>
            </div>
            <div className="pm-card finance-stat-tile--compact">
              <div className="finance-stat-tile__label finance-stat-tile__label--sm">Actual spend</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--md finance-stat-tile__value--warning">
                {fmtK(v.actual_spend)}
              </div>
            </div>
            <div
              className={`pm-card finance-stat-tile--compact ${
                v.variance >= 0 ? "finance-stat-tile--variance-positive" : "finance-stat-tile--variance-negative"
              }`}
            >
              <div className="finance-stat-tile__label finance-stat-tile__label--sm">Variance</div>
              <div
                className={`finance-stat-tile__value finance-stat-tile__value--md ${v.variance >= 0 ? "finance-stat-tile__value--success" : "finance-stat-tile__value--danger"}`}
              >
                {fmtK(v.variance)}
              </div>
            </div>
            <div className="pm-card finance-stat-tile--compact">
              <div className="finance-stat-tile__label finance-stat-tile__label--sm">Utilization</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--md">{pct}%</div>
            </div>
          </div>
          <FinanceDataTable
            columns={[
              { key: "account", label: "Account", render: (a) => <span className="finance-cell-title">{a.account}</span> },
              {
                key: "budget_amount",
                label: "Budget amount",
                render: (a) => <span className="finance-cell-accent">{fmt(a.budget_amount)}</span>,
              },
            ]}
            rows={v.accounts || []}
            pageSize={FINANCE_LIST_PAGE_SIZE}
            getRowKey={(a, i) => `${a.account}-${i}`}
            emptyMessage="No budget accounts."
            className=""
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Budget Overview"
        actions={
          <FinanceCan action="canCreate">
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={() => {
                setShowForm(true);
                setForm(emptyForm());
                loadOpts();
              }}
            >
              + Add Budget
            </button>
          </FinanceCan>
        }
      />

      {showForm ? (
        <Modal
          title="New Budget"
          wide
          onClose={() => setShowForm(false)}
          footer={
            <FinanceCan action="canCreate">
              <div className="finance-modal-footer">
                <button
                  type="button"
                  className="pm-btn finance-btn-success-outline"
                  onClick={() => setForm({ ...form, accounts: [...form.accounts, { account: "", budget_amount: "" }] })}
                >
                  + Add Row
                </button>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !form.company}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </FinanceCan>
          }
        >
          <div className="finance-form-grid finance-form-grid--spaced">
            <FinanceFormField
              label="Series *"
              type="select"
              value={form.naming_series}
              onChange={(e) => setForm({ ...form, naming_series: e.target.value })}
            >
              {(opts.naming_series || ["BUDGET-.YYYY.-"]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Budget Against *"
              type="select"
              value={form.budget_against}
              onChange={(e) => setForm({ ...form, budget_against: e.target.value, cost_center: "", project: "" })}
            >
              {(opts.budget_against_options || ["Cost Center", "Project"]).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Company *"
              type="select"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value, cost_center: "", project: "" })}
            >
              <option value="">Select company…</option>
              {(opts.companies || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Fiscal Year *"
              type="select"
              value={form.fiscal_year}
              onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}
            >
              <option value="">Select fiscal year…</option>
              {(opts.fiscal_years || []).map((fy) => (
                <option key={fy.name} value={fy.name}>
                  {fy.name}
                </option>
              ))}
            </FinanceFormField>
            {form.budget_against === "Cost Center" ? (
              <div className="finance-form-span-full">
                <FinanceFormField
                  label="Cost Center *"
                  type="select"
                  value={form.cost_center}
                  onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
                >
                  <option value="">Select cost center…</option>
                  {(opts.cost_centers || []).map((cc) => (
                    <option key={cc.name} value={cc.name}>
                      {cc.cost_center_name || cc.name}
                    </option>
                  ))}
                </FinanceFormField>
              </div>
            ) : (
              <div className="finance-form-span-full">
                <FinanceFormField
                  label="Project *"
                  type="select"
                  value={form.project}
                  onChange={(e) => setForm({ ...form, project: e.target.value })}
                >
                  <option value="">Select project…</option>
                  {(opts.projects || []).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.project_name || p.name}
                    </option>
                  ))}
                </FinanceFormField>
              </div>
            )}
            <div className="finance-form-span-full finance-form-span-full--narrow">
              <FinanceFormField
                label="Monthly Distribution"
                type="select"
                value={form.monthly_distribution}
                onChange={(e) => setForm({ ...form, monthly_distribution: e.target.value })}
              >
                <option value="">None</option>
                {(opts.monthly_distributions || []).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </FinanceFormField>
            </div>
          </div>

          <div className="finance-form-section">
            <div className="finance-form-section__title">Control Action</div>
            <div className="finance-form-checkbox-row">
              <label className="finance-form-checkbox">
                <input
                  type="checkbox"
                  checked={form.applicable_on_material_request}
                  onChange={(e) => setForm({ ...form, applicable_on_material_request: e.target.checked })}
                />
                Applicable on Material Request
              </label>
              <label className="finance-form-checkbox">
                <input
                  type="checkbox"
                  checked={form.applicable_on_purchase_order}
                  onChange={(e) => setForm({ ...form, applicable_on_purchase_order: e.target.checked })}
                />
                Applicable on Purchase Order
              </label>
              <label className="finance-form-checkbox">
                <input
                  type="checkbox"
                  checked={form.applicable_on_booking_actual_expenses}
                  onChange={(e) => setForm({ ...form, applicable_on_booking_actual_expenses: e.target.checked })}
                />
                Applicable on booking actual expenses
              </label>
            </div>
          </div>

          <div className="finance-form-section__title finance-form-section__title--flush">Budget Accounts *</div>
          {form.accounts.map((row, i) => (
            <div key={i} className="finance-form-grid--accounts">
              <select
                className="pm-select"
                value={row.account}
                onChange={(e) => {
                  const accounts = [...form.accounts];
                  accounts[i] = { ...accounts[i], account: e.target.value };
                  setForm({ ...form, accounts });
                }}
              >
                <option value="">Select Account…</option>
                {(opts.accounts || []).map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.account_name || a.name}
                  </option>
                ))}
              </select>
              <input
                className="pm-input"
                type="number"
                min={0}
                step="0.01"
                placeholder="Budget amount"
                value={row.budget_amount}
                onChange={(e) => {
                  const accounts = [...form.accounts];
                  accounts[i] = { ...accounts[i], budget_amount: e.target.value };
                  setForm({ ...form, accounts });
                }}
              />
              <button
                type="button"
                className="pm-btn pm-btn-danger"
                onClick={() => {
                  const accounts = form.accounts.filter((_, j) => j !== i);
                  setForm({ ...form, accounts: accounts.length ? accounts : [{ account: "", budget_amount: "" }] });
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </Modal>
      ) : null}

      {chartData.length > 0 && (
        <div className="pm-card finance-card--spaced">
          <h3 className="finance-chart-title">Budget vs Actual Spend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: tokens.muted }} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: tokens.muted }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
              <Bar dataKey="budget" fill={tokens.accent} name="Budget" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" fill={tokens.warning} name="Actual Spend" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="finance-filter-bar">
        <input
          className="pm-input finance-filter-bar__input"
          placeholder="ID"
          value={flt.id}
          onChange={(e) => setFlt({ ...flt, id: e.target.value })}
        />
        <select
          className="pm-select finance-filter-bar__input"
          value={flt.against}
          onChange={(e) => setFlt({ ...flt, against: e.target.value })}
        >
          <option value="">Budget Against</option>
          <option value="Cost Center">Cost Center</option>
          <option value="Project">Project</option>
        </select>
        <input
          className="pm-input finance-filter-bar__input finance-filter-bar__input--wide"
          placeholder="Company"
          value={flt.company}
          onChange={(e) => setFlt({ ...flt, company: e.target.value })}
        />
        <input
          className="pm-input finance-filter-bar__input finance-filter-bar__input--narrow"
          placeholder="Fiscal Year"
          value={flt.fiscal_year}
          onChange={(e) => setFlt({ ...flt, fiscal_year: e.target.value })}
        />
        <span className="finance-filter-bar__count">
          {filteredBudgets.length} of {budgets.length}
        </span>
      </div>
      <FinanceDataTable
        columns={tableColumns}
        rows={filteredBudgets}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${flt.id}|${flt.against}|${flt.company}|${flt.fiscal_year}`}
        emptyMessage={emptyMessage}
        getRowKey={(b) => b.name}
        className=""
        tableClassName=""
      />
      <div className="pm-card finance-table-footer">Showing submitted budgets for your company.</div>
    </div>
  );
}
