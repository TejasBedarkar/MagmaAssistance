import { useEffect, useState, useCallback, useMemo } from "react";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import FinanceListFilters from "../components/FinanceListFilters.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";

const RESOLUTION_LABELS = {
  user_default: "Your user default",
  global_defaults: "Global default",
  first_company: "First company in system",
  none: "Not configured",
  error: "Unknown",
};

const emptyFyForm = (defaultCompany) => ({
  year: "",
  disabled: false,
  is_short_year: false,
  year_start_date: "",
  year_end_date: "",
  companies: [{ company: defaultCompany || "" }],
});

const emptyCompanyForm = (opts) => ({
  company_name: "",
  abbr: "",
  country: opts?.default_country || "India",
  default_currency: opts?.default_currency || "INR",
  chart_of_accounts: opts?.chart_templates?.[0] || "",
});

export default function CompanySetup() {
  const [data, setData] = useState(null);
  const [formOptions, setFormOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useFinanceToast(5000);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [settingDefault, setSettingDefault] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm(null));
  const [companySaving, setCompanySaving] = useState(false);
  const [fySearch, setFySearch] = useState("");
  const [showFyForm, setShowFyForm] = useState(false);
  const [fyForm, setFyForm] = useState(emptyFyForm(""));
  const [fySaving, setFySaving] = useState(false);
  const [historyRecord, setHistoryRecord] = useState(null);

  const loadFormOptions = useCallback(async (country) => {
    try {
      const opts = await callMethodGet(
        toMethodGetUrl(
          "finance_app.api.company_setup.get_company_form_options",
          country ? { country } : {}
        )
      );
      setFormOptions(opts || null);
      return opts;
    } catch {
      setFormOptions(null);
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await callMethodGet("finance_app.api.company_setup.get_company_setup");
      setData(m || null);
      setSelectedCompany(m?.user_default_company || m?.resolved_company || "");
      const country =
        (m?.companies || []).find((c) => c.name === m?.resolved_company)?.country || "India";
      await loadFormOptions(country);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [loadFormOptions]);

  useEffect(() => {
    load();
  }, [load]);

  const onCountryChange = async (country) => {
    setCompanyForm((prev) => ({ ...prev, country, chart_of_accounts: "" }));
    const opts = await loadFormOptions(country);
    if (opts) {
      setCompanyForm((prev) => ({
        ...prev,
        country,
        default_currency: opts.default_currency || prev.default_currency,
        chart_of_accounts: opts.chart_templates?.[0] || "",
      }));
    }
  };

  const setDefaultCompany = async () => {
    if (!selectedCompany) {
      showToast({ type: "error", text: "Select a company first." });
      return;
    }
    setSettingDefault(true);
    try {
      const msg = await callMethod("finance_app.api.company_setup.set_user_company", {
        company: selectedCompany,
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Default company updated.");
        load();
      } else {
        showToast({ type: "error", text: msg?.message || "Could not set default company." });
      }
    } catch (e) {
      showToast({ type: "error", text: e.message || "request failed" });
    }
    setSettingDefault(false);
  };

  const openCompanyForm = () => {
    setCompanyForm(emptyCompanyForm(formOptions));
    setShowCompanyForm(true);
  };

  const saveCompany = async () => {
    if (!companyForm.company_name?.trim()) {
      showToast({ type: "error", text: "Company Name is required." });
      return;
    }
    if (!companyForm.abbr?.trim()) {
      showToast({ type: "error", text: "Abbr is required." });
      return;
    }
    setCompanySaving(true);
    try {
      const msg = await callMethod("finance_app.api.company_setup.create_company", {
        company_name: companyForm.company_name.trim(),
        abbr: companyForm.abbr.trim(),
        country: companyForm.country,
        default_currency: companyForm.default_currency,
        chart_of_accounts: companyForm.chart_of_accounts || undefined,
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Company created.");
        setShowCompanyForm(false);
        setCompanyForm(emptyCompanyForm(formOptions));
        load();
      } else {
        showToast({ type: "error", text: msg?.message || "Could not create company." });
      }
    } catch (e) {
      showToast({ type: "error", text: e.message || "request failed" });
    }
    setCompanySaving(false);
  };

  const openFyForm = () => {
    setFyForm(emptyFyForm(data?.resolved_company || ""));
    setShowFyForm(true);
  };

  const filteredCompanies = useMemo(() => {
    const list = data?.companies || [];
    if (!companySearch.trim()) return list;
    const q = companySearch.toLowerCase();
    return list.filter(
      (c) =>
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.abbr || "").toLowerCase().includes(q) ||
        String(c.country || "").toLowerCase().includes(q)
    );
  }, [data?.companies, companySearch]);

  const filteredFy = useMemo(() => {
    const list = data?.fiscal_years || [];
    if (!fySearch.trim()) return list;
    const q = fySearch.toLowerCase();
    return list.filter(
      (fy) =>
        String(fy.name || "").toLowerCase().includes(q) ||
        String(fy.year || "").toLowerCase().includes(q)
    );
  }, [data?.fiscal_years, fySearch]);

  const saveFiscalYear = async () => {
    if (!fyForm.year?.trim()) {
      showToast("Year Name is required.");
      return;
    }
    if (!fyForm.year_start_date || !fyForm.year_end_date) {
      showToast("Year Start Date and Year End Date are required.");
      return;
    }
    const crow = fyForm.companies.filter((r) => r.company);
    if (!crow.length) {
      showToast({ type: "error", text: "Add at least one company in the Companies table." });
      return;
    }
    setFySaving(true);
    try {
      const msg = await callMethod("finance_app.api.company_setup.create_fiscal_year", {
        year: fyForm.year.trim(),
        year_start_date: fyForm.year_start_date,
        year_end_date: fyForm.year_end_date,
        disabled: fyForm.disabled ? 1 : 0,
        is_short_year: fyForm.is_short_year ? 1 : 0,
        companies: JSON.stringify(crow.map((c) => ({ company: c.company }))),
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Fiscal year created.");
        setShowFyForm(false);
        setFyForm(emptyFyForm(data?.resolved_company || ""));
        load();
      } else {
        showToast({ type: "error", text: `Error: ${msg?.message || "Could not create."}` });
      }
    } catch (e) {
      showToast("Error: " + (e.message || "request failed"));
    }
    setFySaving(false);
  };

  const companyColumns = [
    {
      key: "name",
      label: "Company",
      render: (row) => <span className="finance-cell-title">{row.name}</span>,
    },
    {
      key: "abbr",
      label: "Abbr",
      render: (row) => <span className="finance-cell-accent">{row.abbr || "—"}</span>,
    },
    {
      key: "country",
      label: "Country",
      render: (row) => <span className="finance-cell-muted">{row.country || "—"}</span>,
    },
    {
      key: "default_currency",
      label: "Currency",
      render: (row) => <span className="finance-cell-muted">{row.default_currency || "—"}</span>,
    },
    {
      key: "active",
      label: "Active",
      render: (row) =>
        row.name === data?.resolved_company ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <span className="finance-cell-muted">—</span>
        ),
    },
  ];

  const fyColumns = [
    {
      key: "name",
      label: "ID",
      render: (fy) => <span className="finance-cell-accent">{fy.name}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (fy) =>
        fy.disabled ? (
          <StatusPill tone="default">Disabled</StatusPill>
        ) : (
          <StatusPill tone="info">Enabled</StatusPill>
        ),
    },
    {
      key: "year",
      label: "Year Name",
      render: (fy) => <span className="finance-cell-title">{fy.year || fy.name}</span>,
    },
    {
      key: "year_start_date",
      label: "Year Start Date",
      render: (fy) => <span className="finance-cell-muted">{fy.year_start_date || "—"}</span>,
    },
    {
      key: "year_end_date",
      label: "Year End Date",
      render: (fy) => <span className="finance-cell-muted">{fy.year_end_date || "—"}</span>,
    },
  ];

  if (loading) {
    return (
      <div className="pm-page finance-page">
        <FinancePageLoader message="Loading…" />
      </div>
    );
  }

  const resolutionLabel = RESOLUTION_LABELS[data?.resolution_source] || data?.resolution_source || "—";

  return (
    <div className="pm-page finance-page finance-company-setup">
      <FinancePageHeader
        title="Company & Fiscal Year"
        description="Manage companies, your default company, and fiscal years for finance transactions."
      />

      <div className="pm-card finance-company-setup__active-card">
        <div className="finance-form-section__title">Active company</div>
        <p className="finance-form-hint finance-form-hint--tight">
          Finance transactions use this company (user default → global default → first company).
        </p>
        <div className="finance-field-grid finance-field-grid--spaced">
          <div>
            <div className="finance-field-label">CURRENT</div>
            <div className="finance-field-value finance-field-value--success">
              {data?.resolved_company || "Not set"}
            </div>
          </div>
          <div>
            <div className="finance-field-label">SOURCE</div>
            <div className="finance-field-value">{resolutionLabel}</div>
          </div>
          {data?.global_default_company ? (
            <div>
              <div className="finance-field-label">GLOBAL DEFAULT</div>
              <div className="finance-field-value">{data.global_default_company}</div>
            </div>
          ) : null}
        </div>
        <div className="finance-company-setup__default-row">
          <FinanceFormField
            label="Set my default company"
            type="select"
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="finance-field--flush"
          >
            <option value="">Select company…</option>
            {(data?.companies || []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </FinanceFormField>
          <FinanceCan action="canEdit">
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={setDefaultCompany}
              disabled={settingDefault || !selectedCompany}
            >
              {settingDefault ? "Saving…" : "Save default"}
            </button>
          </FinanceCan>
        </div>
      </div>

      {showCompanyForm && (
        <div className="pm-card finance-form-card">
          <div className="finance-toolbar__fields finance-toolbar__fields--spaced">
            <StatusPill tone="warn">Not Saved</StatusPill>
          </div>
          <div className="finance-form-grid finance-form-grid--spaced">
            <FinanceFormField
              label="Company Name *"
              value={companyForm.company_name}
              onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
            />
            <FinanceFormField
              label="Abbr *"
              value={companyForm.abbr}
              onChange={(e) => setCompanyForm({ ...companyForm, abbr: e.target.value.toUpperCase() })}
              hint="Short code used on accounts (e.g. MD)."
            />
            <FinanceFormField
              label="Country *"
              type="select"
              value={companyForm.country}
              onChange={(e) => onCountryChange(e.target.value)}
            >
              <option value="">Select country…</option>
              {(formOptions?.countries || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Default Currency *"
              type="select"
              value={companyForm.default_currency}
              onChange={(e) => setCompanyForm({ ...companyForm, default_currency: e.target.value })}
            >
              <option value="">Select currency…</option>
              {(formOptions?.currencies || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </FinanceFormField>
            <div className="finance-form-span-full">
              <FinanceFormField
                label="Chart of Accounts Template *"
                type="select"
                value={companyForm.chart_of_accounts}
                onChange={(e) => setCompanyForm({ ...companyForm, chart_of_accounts: e.target.value })}
              >
                <option value="">Select template…</option>
                {(formOptions?.chart_templates || []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </FinanceFormField>
            </div>
          </div>
          <div className="finance-modal-footer finance-modal-footer--end">
            <button type="button" className="pm-btn" onClick={() => setShowCompanyForm(false)}>
              Cancel
            </button>
            <FinanceCan action="canCreate">
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                onClick={saveCompany}
                disabled={companySaving}
              >
                {companySaving ? "Creating…" : "Create Company"}
              </button>
            </FinanceCan>
          </div>
        </div>
      )}

      <div className="finance-company-setup__table-block">
        <div className="pm-card finance-search-card finance-company-setup__search-row">
          <FinanceListFilters
            searchValue={companySearch}
            onSearchChange={setCompanySearch}
            searchPlaceholder="Search companies…"
          />
          <FinanceCan action="canCreate">
            <button
              type="button"
              className={`pm-btn ${showCompanyForm ? "pm-btn-danger" : "pm-btn-primary"} finance-company-setup__search-action`}
              onClick={() => (showCompanyForm ? setShowCompanyForm(false) : openCompanyForm())}
            >
              {showCompanyForm ? "✕ Cancel" : "+ Add Company"}
            </button>
          </FinanceCan>
        </div>
        <FinanceDataTable
          columns={companyColumns}
          rows={filteredCompanies}
          pageSize={FINANCE_LIST_PAGE_SIZE}
          paginationResetKey={companySearch}
          emptyMessage="No companies yet. Use + Add Company."
          getRowKey={(row) => row.name}
          onRowClick={(row) =>
            setHistoryRecord({ doctype: "Company", name: row.name, title: row.name })
          }
        />
      </div>

      {showFyForm && (
        <div className="pm-card finance-form-card finance-form-card--wide">
          <div className="finance-toolbar__fields finance-toolbar__fields--spaced">
            <StatusPill tone="warn">Not Saved</StatusPill>
          </div>

          <div className="finance-form-grid finance-form-grid--spaced">
            <div className="finance-form-span-full">
              <FinanceFormField
                label="Year Name *"
                value={fyForm.year}
                onChange={(e) => setFyForm({ ...fyForm, year: e.target.value })}
              />
            </div>
            <div className="finance-form-span-full finance-form-checkbox-row">
              <label className="finance-form-checkbox">
                <input
                  type="checkbox"
                  checked={fyForm.disabled}
                  onChange={(e) => setFyForm({ ...fyForm, disabled: e.target.checked })}
                />
                Disabled
              </label>
              <label className="finance-form-checkbox finance-form-checkbox--stacked">
                <span className="finance-form-checkbox">
                  <input
                    type="checkbox"
                    checked={fyForm.is_short_year}
                    onChange={(e) => setFyForm({ ...fyForm, is_short_year: e.target.checked })}
                  />
                  Is Short/Long Year
                </span>
                <span className="finance-form-hint finance-form-hint--tight">More/Less than 12 months.</span>
              </label>
            </div>
            <FinanceFormField
              label="Year Start Date *"
              type="date"
              value={fyForm.year_start_date}
              onChange={(e) => setFyForm({ ...fyForm, year_start_date: e.target.value })}
            />
            <FinanceFormField
              label="Year End Date *"
              type="date"
              value={fyForm.year_end_date}
              onChange={(e) => setFyForm({ ...fyForm, year_end_date: e.target.value })}
            />
          </div>

          <div className="finance-form-section__title finance-form-section__title--flush">Companies</div>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th className="finance-col-index">#</th>
                  <th>Company *</th>
                  <th className="finance-col-action" />
                </tr>
              </thead>
              <tbody>
                {fyForm.companies.map((row, i) => (
                  <tr key={i}>
                    <td className="finance-cell-muted">{i + 1}</td>
                    <td>
                      <select
                        className="pm-select"
                        value={row.company}
                        onChange={(e) => {
                          const companies = [...fyForm.companies];
                          companies[i] = { company: e.target.value };
                          setFyForm({ ...fyForm, companies });
                        }}
                      >
                        <option value="">Select company…</option>
                        {(data?.companies || []).map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <FinanceCan action="canCreate">
                        <button
                          type="button"
                          className="pm-btn pm-btn-danger"
                          onClick={() => {
                            const companies = fyForm.companies.filter((_, j) => j !== i);
                            setFyForm({ ...fyForm, companies: companies.length ? companies : [{ company: "" }] });
                          }}
                        >
                          ✕
                        </button>
                      </FinanceCan>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FinanceCan action="canCreate">
            <button
              type="button"
              className="pm-btn finance-btn-mt-sm"
              onClick={() => setFyForm({ ...fyForm, companies: [...fyForm.companies, { company: "" }] })}
            >
              Add Row
            </button>
          </FinanceCan>

          <div className="finance-modal-footer finance-modal-footer--end">
            <button type="button" className="pm-btn" onClick={() => setShowFyForm(false)}>
              Cancel
            </button>
            <FinanceCan action="canCreate">
              <button type="button" className="pm-btn pm-btn-primary" onClick={saveFiscalYear} disabled={fySaving}>
                {fySaving ? "Saving…" : "Save"}
              </button>
            </FinanceCan>
          </div>
        </div>
      )}

      <div className="finance-company-setup__table-block">
        <div className="pm-card finance-search-card finance-company-setup__search-row">
          <FinanceListFilters
            searchValue={fySearch}
            onSearchChange={setFySearch}
            searchPlaceholder="Search by ID or year name…"
          />
          <FinanceCan action="canCreate">
            <button
              type="button"
              className={`pm-btn ${showFyForm ? "pm-btn-danger" : "pm-btn-primary"} finance-company-setup__search-action`}
              onClick={() => (showFyForm ? setShowFyForm(false) : openFyForm())}
            >
              {showFyForm ? "✕ Cancel" : "+ Add Fiscal Year"}
            </button>
          </FinanceCan>
        </div>
        <FinanceDataTable
          columns={fyColumns}
          rows={filteredFy}
          pageSize={FINANCE_LIST_PAGE_SIZE}
          paginationResetKey={fySearch}
          emptyMessage={
            (data?.fiscal_years || []).length === 0
              ? "No fiscal years yet. Use + Add Fiscal Year."
              : "No fiscal years match your search."
          }
          getRowKey={(fy) => fy.name}
          onRowClick={(fy) =>
            setHistoryRecord({
              doctype: "Fiscal Year",
              name: fy.name,
              title: fy.year || fy.name,
            })
          }
        />
      </div>

      {historyRecord ? (
        <Modal
          wide
          title={`Activity — ${historyRecord.title}`}
          onClose={() => setHistoryRecord(null)}
        >
          <FinanceDocumentHistory
            doctype={historyRecord.doctype}
            name={historyRecord.name}
            showToast={showToast}
          />
        </Modal>
      ) : null}
    </div>
  );
}
