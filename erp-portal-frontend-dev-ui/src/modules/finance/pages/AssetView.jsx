import { useEffect, useState, useCallback } from "react";
import { callMethod, callMethodGet } from "../../../common/api/client.js";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import { financeViewTableColumn } from "../components/FinanceViewAction.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { ASSET_FILTER_STATUSES, mergeStatusOptions } from "../lib/statusFilters.js";
import { assetStatusTone } from "../lib/statusTones.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { tokens } from "../theme/tokens.js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const CHART_COLORS = [tokens.success, tokens.accent, tokens.warning, tokens.danger];
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

const emptyForm = () => ({
  company: "",
  naming_series: "ACC-ASS-.YYYY.-",
  item_code: "",
  asset_name: "",
  location: "",
  asset_owner: "Company",
  supplier: "",
  customer: "",
  custodian: "",
  department: "",
  is_existing_asset: false,
  is_composite_asset: false,
  cost_center: "",
  purchase_receipt: "",
  purchase_invoice: "",
  gross_purchase_amount: "",
  asset_quantity: 1,
  available_for_use_date: "",
  purchase_date: "",
  maintenance_required: false,
  opening_accumulated_depreciation: "",
});

export default function AssetView() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewAsset, setViewAsset] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [opts, setOpts] = useState({
    companies: [],
    naming_series: ["ACC-ASS-.YYYY.-"],
    asset_owner_options: ["Company", "Supplier", "Customer"],
    items: [],
    locations: [],
    employees: [],
    departments: [],
    suppliers: [],
    customers: [],
    purchase_receipts: [],
    purchase_invoices: [],
    cost_centers: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast(4000);

  const load = async () => {
    setLoading(true);
    try {
      const message = await callMethodGet(toMethodGetUrl("finance_app.api.asset.get_assets"));
      setAssets(message || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  const loadOpts = useCallback(async (company) => {
    try {
      const params = company ? { company } : {};
      const m = await callMethodGet(
        toMethodGetUrl("finance_app.api.asset.get_asset_form_options", params)
      );
      if (!m) return;
      setOpts((prev) => ({ ...prev, ...m }));
      setForm((f) => {
        const next = { ...f };
        if (!f.company && m.company_default) next.company = m.company_default;
        if (m.naming_series?.length && (!f.naming_series || !m.naming_series.includes(f.naming_series))) {
          next.naming_series = m.naming_series[0];
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (showForm && form.company) loadOpts(form.company);
  }, [form.company, showForm, loadOpts]);

  const handleSave = async () => {
    if (!form.company) {
      showToast("Company is required.");
      return;
    }
    if (!form.item_code) {
      showToast("Item Code is required.");
      return;
    }
    if (!form.location) {
      showToast("Location is required.");
      return;
    }
    if (!form.available_for_use_date) {
      showToast("Available-for-use Date is required.");
      return;
    }
    if (!form.is_composite_asset && !String(form.gross_purchase_amount).trim()) {
      showToast("Net Purchase Amount is required.");
      return;
    }
    if (!form.is_existing_asset && !form.is_composite_asset && !form.purchase_receipt && !form.purchase_invoice) {
      showToast("Purchase Receipt or Purchase Invoice is required (unless Existing or Composite asset).");
      return;
    }
    if (form.asset_owner === "Supplier" && !form.supplier) {
      showToast("Supplier is required when Asset Owner is Supplier.");
      return;
    }
    if (form.asset_owner === "Customer" && !form.customer) {
      showToast("Customer is required when Asset Owner is Customer.");
      return;
    }

    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.asset.create_asset", {
        company: form.company,
        naming_series: form.naming_series,
        item_code: form.item_code,
        asset_name: form.asset_name || "",
        location: form.location,
        asset_owner: form.asset_owner,
        supplier: form.supplier || "",
        customer: form.customer || "",
        custodian: form.custodian || "",
        department: form.department || "",
        is_existing_asset: form.is_existing_asset ? 1 : 0,
        is_composite_asset: form.is_composite_asset ? 1 : 0,
        cost_center: form.cost_center || "",
        purchase_receipt: form.purchase_receipt || "",
        purchase_invoice: form.is_existing_asset ? "" : form.purchase_invoice || "",
        gross_purchase_amount: form.is_composite_asset
          ? form.gross_purchase_amount || 0
          : parseFloat(form.gross_purchase_amount) || 0,
        asset_quantity: parseInt(form.asset_quantity, 10) || 1,
        available_for_use_date: form.available_for_use_date,
        purchase_date: form.purchase_date || "",
        maintenance_required: form.maintenance_required ? 1 : 0,
        opening_accumulated_depreciation: form.is_existing_asset
          ? parseFloat(form.opening_accumulated_depreciation) || 0
          : 0,
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Asset saved.");
        setShowForm(false);
        setForm(emptyForm());
        load();
        loadOpts();
      } else {
        showToast(msg?.message || "Could not save asset.");
      }
    } catch (e) {
      showToast("Error: " + (e.message || "request failed"));
    }
    setSaving(false);
  };

  const filtered = assets.filter((a) => {
    if (
      search &&
      !a.name?.toLowerCase().includes(search.toLowerCase()) &&
      !a.asset_name?.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const statuses = mergeStatusOptions(
    ASSET_FILTER_STATUSES,
    assets.map((a) => a.status)
  );
  const totalPurchase = assets.reduce((s, a) => s + (parseFloat(a.gross_purchase_amount) || 0), 0);
  const totalCurrent = assets.reduce((s, a) => s + (parseFloat(a.current_value) || 0), 0);
  const totalDepreciation = assets.reduce((s, a) => s + (parseFloat(a.accumulated_depreciation) || 0), 0);

  const catMap = {};
  assets.forEach((a) => {
    const cat = a.asset_category || "Uncategorized";
    catMap[cat] = (catMap[cat] || 0) + (parseFloat(a.gross_purchase_amount) || 0);
  });
  const catData = Object.entries(catMap).map(([name, value], i) => ({
    name,
    value,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const barData = assets.slice(0, 10).map((a) => ({
    name: (a.asset_name || a.name).slice(0, 18),
    purchase: parseFloat(a.gross_purchase_amount) || 0,
    current: parseFloat(a.current_value) || 0,
  }));

  if (viewAsset) {
    const a = viewAsset;
    const depPct =
      a.gross_purchase_amount > 0
        ? ((a.accumulated_depreciation / a.gross_purchase_amount) * 100).toFixed(1)
        : 0;
    return (
      <div className="pm-page finance-page">
        <button type="button" onClick={() => setViewAsset(null)} className="pm-btn pm-btn-ghost finance-back-link">
          ← Back to List
        </button>
        <div className="pm-card">
          <div className="finance-detail-actions finance-detail-actions--center">
            <div>
              <h2 className="finance-detail-title">{a.asset_name || a.name}</h2>
              <p className="finance-detail-sub">
                {a.name} • {a.asset_category || "No Category"}
              </p>
            </div>
            <StatusPill tone={assetStatusTone(a.status)}>{a.status}</StatusPill>
          </div>

          <div className="finance-stat-grid">
            <div className="finance-stat-tile">
              <div className="finance-stat-tile__label">Purchase Value</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--accent">
                {fmt(a.gross_purchase_amount)}
              </div>
            </div>
            <div className="finance-stat-tile">
              <div className="finance-stat-tile__label">Depreciation</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--warning">
                {fmt(a.accumulated_depreciation)}
              </div>
            </div>
            <div className="finance-stat-tile finance-stat-tile--highlight">
              <div className="finance-stat-tile__label">Current Value</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--success">
                {fmt(a.current_value)}
              </div>
            </div>
            <div className="finance-stat-tile">
              <div className="finance-stat-tile__label">Depreciated</div>
              <div className="finance-stat-tile__value finance-stat-tile__value--warning">{depPct}%</div>
            </div>
          </div>

          <div className="finance-progress-wrap">
            <div className="finance-progress-header">
              <span className="finance-progress-label">Depreciation Progress</span>
              <span className="finance-progress-pct">{depPct}%</span>
            </div>
            <div className="finance-progress-bar">
              <div className="finance-progress-bar__fill" style={{ width: `${Math.min(100, depPct)}%` }} />
            </div>
          </div>

          <div className="finance-field-grid">
            <div>
              <div className="finance-field-label">PURCHASE DATE</div>
              <div className="finance-field-value">{a.purchase_date || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">AVAILABLE FOR USE</div>
              <div className="finance-field-value">{a.available_for_use_date || "—"}</div>
            </div>
            <div>
              <div className="finance-field-label">LOCATION</div>
              <div className="finance-field-value">{a.location || "—"}</div>
            </div>
          </div>
        </div>
        <FinanceDocumentHistory doctype="Asset" name={a.name} showToast={showToast} />
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Assets"
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
              + Add Asset
            </button>
          </FinanceCan>
        }
      />

      {showForm && (
        <div role="presentation" className="finance-modal-overlay" onClick={() => setShowForm(false)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="pm-card finance-modal-dialog"
          >
            <div className="finance-modal-header">
              <div className="finance-toolbar__fields">
                <h3 className="finance-modal-header__title">New Asset</h3>
                <span className="finance-modal-badge">Not Saved</span>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Close"
                className="pm-btn finance-modal-close"
              >
                ×
              </button>
            </div>

            <div className="finance-form-section__title">General</div>
            <div className="finance-form-grid">
              <FinanceFormField label="Company *" type="select" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
                <option value="">Select company…</option>
                {(opts.companies || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </FinanceFormField>
              <FinanceFormField
                label="Naming Series"
                type="select"
                value={form.naming_series}
                onChange={(e) => setForm({ ...form, naming_series: e.target.value })}
              >
                {(opts.naming_series || ["ACC-ASS-.YYYY.-"]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </FinanceFormField>
              <FinanceFormField label="Item Code *" type="select" value={form.item_code} onChange={(e) => setForm({ ...form, item_code: e.target.value })}>
                <option value="">Select item…</option>
                {(opts.items || []).map((it) => (
                  <option key={it.name} value={it.name}>
                    {it.name}
                    {it.item_name ? ` — ${it.item_name}` : ""}
                  </option>
                ))}
              </FinanceFormField>
              <FinanceFormField
                label="Asset Name"
                value={form.asset_name}
                onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
                placeholder="Defaults from item"
              />
              <FinanceFormField label="Location *" type="select" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
                <option value="">Select location…</option>
                {(opts.locations || []).map((loc) => (
                  <option key={loc.name} value={loc.name}>
                    {loc.location_name || loc.name}
                  </option>
                ))}
              </FinanceFormField>
              <FinanceFormField
                label="Asset Owner"
                type="select"
                value={form.asset_owner}
                onChange={(e) =>
                  setForm({ ...form, asset_owner: e.target.value, supplier: "", customer: "" })
                }
              >
                {(opts.asset_owner_options || ["Company", "Supplier", "Customer"]).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </FinanceFormField>
              {form.asset_owner === "Supplier" && (
                <div className="finance-form-span-full">
                  <FinanceFormField
                    label="Supplier *"
                    type="select"
                    value={form.supplier}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  >
                    <option value="">Select supplier…</option>
                    {(opts.suppliers || []).map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.supplier_name || s.name}
                      </option>
                    ))}
                  </FinanceFormField>
                </div>
              )}
              {form.asset_owner === "Customer" && (
                <div className="finance-form-span-full">
                  <FinanceFormField
                    label="Customer *"
                    type="select"
                    value={form.customer}
                    onChange={(e) => setForm({ ...form, customer: e.target.value })}
                  >
                    <option value="">Select customer…</option>
                    {(opts.customers || []).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.customer_name || c.name}
                      </option>
                    ))}
                  </FinanceFormField>
                </div>
              )}
              <FinanceFormField
                label="Custodian"
                type="select"
                value={form.custodian}
                onChange={(e) => setForm({ ...form, custodian: e.target.value })}
              >
                <option value="">None</option>
                {(opts.employees || []).map((em) => (
                  <option key={em.name} value={em.name}>
                    {em.employee_name || em.name}
                  </option>
                ))}
              </FinanceFormField>
              <FinanceFormField
                label="Department"
                type="select"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              >
                <option value="">None</option>
                {(opts.departments || []).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </FinanceFormField>
              <div className="finance-form-checkbox-group">
                <label className="finance-form-checkbox">
                  <input
                    type="checkbox"
                    checked={form.is_existing_asset}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_existing_asset: e.target.checked,
                        purchase_invoice: "",
                        purchase_receipt: "",
                      })
                    }
                  />
                  Is Existing Asset
                </label>
                <label className="finance-form-checkbox">
                  <input
                    type="checkbox"
                    checked={form.is_composite_asset}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_composite_asset: e.target.checked,
                        purchase_receipt: e.target.checked ? "" : form.purchase_receipt,
                        purchase_invoice: e.target.checked ? "" : form.purchase_invoice,
                      })
                    }
                  />
                  Is Composite Asset
                </label>
              </div>
            </div>

            <div className="finance-form-section">
              <div className="finance-form-section__title">Accounting dimensions</div>
              <div className="finance-form-span-half">
                <FinanceFormField
                  label="Cost Center"
                  type="select"
                  value={form.cost_center}
                  onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
                >
                  <option value="">None</option>
                  {(opts.cost_centers || []).map((cc) => (
                    <option key={cc.name} value={cc.name}>
                      {cc.cost_center_name || cc.name}
                    </option>
                  ))}
                </FinanceFormField>
              </div>
            </div>

            <div className="finance-form-section">
              <div className="finance-form-section__title">Purchase details</div>
              <div className="finance-form-grid">
                <FinanceFormField
                  label={`Purchase Receipt ${!form.is_existing_asset && !form.is_composite_asset ? "*" : ""}`}
                  type="select"
                  value={form.purchase_receipt}
                  onChange={(e) => setForm({ ...form, purchase_receipt: e.target.value })}
                  disabled={form.is_composite_asset || form.is_existing_asset}
                >
                  <option value="">None</option>
                  {(opts.purchase_receipts || []).map((pr) => (
                    <option key={pr.name} value={pr.name}>
                      {pr.name} ({pr.posting_date || "—"})
                    </option>
                  ))}
                </FinanceFormField>
                <FinanceFormField
                  label={`Purchase Invoice ${!form.is_existing_asset && !form.is_composite_asset ? "*" : ""}`}
                  type="select"
                  value={form.purchase_invoice}
                  onChange={(e) => setForm({ ...form, purchase_invoice: e.target.value })}
                  disabled={form.is_existing_asset || form.is_composite_asset}
                >
                  <option value="">None</option>
                  {(opts.purchase_invoices || []).map((pi) => (
                    <option key={pi.name} value={pi.name}>
                      {pi.name} ({pi.posting_date || "—"})
                    </option>
                  ))}
                </FinanceFormField>
                <FinanceFormField
                  label="Net Purchase Amount *"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.gross_purchase_amount}
                  onChange={(e) => setForm({ ...form, gross_purchase_amount: e.target.value })}
                  disabled={form.is_composite_asset}
                />
                <FinanceFormField
                  label="Asset Quantity"
                  type="number"
                  min={1}
                  step={1}
                  value={form.asset_quantity}
                  onChange={(e) => setForm({ ...form, asset_quantity: e.target.value })}
                />
                <FinanceFormField
                  label="Available-for-use Date *"
                  type="date"
                  value={form.available_for_use_date}
                  onChange={(e) => setForm({ ...form, available_for_use_date: e.target.value })}
                />
                <FinanceFormField
                  label="Purchase Date"
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                />
              </div>
              {form.is_existing_asset && (
                <div className="finance-form-span-half finance-form-span-half--spaced">
                  <FinanceFormField
                    label="Opening Accumulated Depreciation"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.opening_accumulated_depreciation}
                    onChange={(e) =>
                      setForm({ ...form, opening_accumulated_depreciation: e.target.value })
                    }
                  />
                </div>
              )}
            </div>

            <div className="finance-form-section">
              <div className="finance-form-section__title">Maintenance</div>
              <label className="finance-form-checkbox">
                <input
                  type="checkbox"
                  checked={form.maintenance_required}
                  onChange={(e) => setForm({ ...form, maintenance_required: e.target.checked })}
                />
                Maintenance Required
              </label>
              <p className="finance-form-hint">Check if Asset requires Preventive Maintenance or Calibration.</p>
            </div>

            <div className="finance-modal-footer finance-modal-footer--spaced">
              <FinanceCan action="canCreate">
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !form.company}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </FinanceCan>
            </div>
          </div>
        </div>
      )}

      <div className="finance-stat-grid">
        <div className="pm-card finance-kpi-inline--center">
          <div className="finance-stat-tile__label">Total Assets</div>
          <div className="finance-stat-tile__value finance-stat-tile__value--lg finance-stat-tile__value--accent">
            {assets.length}
          </div>
        </div>
        <div className="pm-card finance-kpi-inline--center">
          <div className="finance-stat-tile__label">Purchase Value</div>
          <div className="finance-stat-tile__value finance-stat-tile__value--sm finance-stat-tile__value--warning">
            {fmtK(totalPurchase)}
          </div>
        </div>
        <div className="pm-card finance-kpi-inline--center">
          <div className="finance-stat-tile__label">Current Value</div>
          <div className="finance-stat-tile__value finance-stat-tile__value--sm finance-stat-tile__value--success">
            {fmtK(totalCurrent)}
          </div>
        </div>
        <div className="pm-card finance-kpi-inline--center">
          <div className="finance-stat-tile__label">Total Depreciation</div>
          <div className="finance-stat-tile__value finance-stat-tile__value--sm finance-stat-tile__value--warning">
            {fmtK(totalDepreciation)}
          </div>
        </div>
      </div>

      {assets.length > 0 && (
        <div className="finance-chart-grid">
          <div className="pm-card">
            <h3 className="finance-chart-title">Assets by Category</h3>
            {catData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={catData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={35}
                    paddingAngle={3}
                  >
                    {catData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="finance-empty-chart">No data</p>
            )}
          </div>
          <div className="pm-card">
            <h3 className="finance-chart-title">Purchase vs Current Value</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: tokens.muted }} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: tokens.muted }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
                <Bar dataKey="purchase" fill={tokens.accent} name="Purchase" radius={[4, 4, 0, 0]} />
                <Bar dataKey="current" fill={tokens.success} name="Current" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="pm-card finance-search-card">
        <FinanceListFilters
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search assets..."
          statusValue={statusFilter}
          statusOptions={[
            { value: "", label: "All Status" },
            ...statuses.map((s) => ({ value: s, label: s })),
          ]}
          onStatusChange={setStatusFilter}
        />
      </div>

      <FinanceDataTable
        columns={[
          { key: "name", label: "Asset ID", render: (a) => <span className="finance-cell-accent">{a.name}</span> },
          { key: "asset_name", label: "Name", render: (a) => <span className="finance-cell-title">{a.asset_name}</span> },
          {
            key: "asset_category",
            label: "Category",
            render: (a) => <span className="finance-cell-muted">{a.asset_category || "—"}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (a) => <StatusPill tone={assetStatusTone(a.status)}>{a.status}</StatusPill>,
          },
          {
            key: "gross_purchase_amount",
            label: "Purchase Value",
            render: (a) => <span className="finance-cell-accent">{fmt(a.gross_purchase_amount)}</span>,
          },
          {
            key: "accumulated_depreciation",
            label: "Depreciation",
            render: (a) => <span className="finance-cell-warning">{fmt(a.accumulated_depreciation)}</span>,
          },
          {
            key: "current_value",
            label: "Current Value",
            render: (a) => <span className="finance-cell-success">{fmt(a.current_value)}</span>,
          },
          financeViewTableColumn(),
        ]}
        rows={filtered}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        paginationResetKey={`${search}|${statusFilter}`}
        loading={loading}
        loadingMessage="Loading…"
        emptyMessage="No assets found. Use Add Asset or create in ERPNext."
        getRowKey={(a) => a.name}
        onRowClick={(a) => setViewAsset(a)}
      />
    </div>
  );
}
