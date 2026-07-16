import { useEffect, useState, useCallback } from "react";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import FinancePageLoader from "../components/FinancePageLoader.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";

const fmt = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function collectGroupNames(nodes, out = []) {
  for (const n of nodes || []) {
    if (n.is_group) out.push(n.name);
    if (n.children?.length) collectGroupNames(n.children, out);
  }
  return out;
}

function CoaRow({ node, depth, expanded, onToggle }) {
  const hasChildren = node.children?.length > 0;
  const open = expanded.has(node.name);
  const depthClass = `finance-coa-row--depth-${Math.min(depth, 15)}`;

  return (
    <>
      <div
        role={hasChildren ? "button" : undefined}
        onClick={() => hasChildren && onToggle(node.name)}
        className={`finance-coa-row ${depthClass} ${depth === 0 ? "finance-coa-row--root" : ""} ${
          hasChildren ? "finance-coa-row--clickable" : ""
        }`}
      >
        <div className="finance-coa-row__main">
          {hasChildren ? (
            <span className="finance-coa-row__toggle">{open ? "▼" : "▶"}</span>
          ) : (
            <span className="finance-coa-row__toggle--empty" />
          )}
          <span className="finance-coa-row__icon">{node.is_group ? "📁" : "○"}</span>
          <span
            className={`finance-coa-row__name ${
              node.is_group ? "finance-coa-row__name--group" : "finance-coa-row__name--leaf"
            }`}
          >
            {node.account_name}
          </span>
          {!node.is_group && node.account_type ? (
            <span className="finance-coa-row__type">({node.account_type})</span>
          ) : null}
        </div>
        <div className="finance-coa-row__balance">
          {fmt(node.amount_display)}{" "}
          <span className="finance-coa-row__drcr">{node.drcr}</span>
        </div>
      </div>
      {hasChildren && open
        ? node.children.map((ch) => (
            <CoaRow key={ch.name} node={ch} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
          ))
        : null}
    </>
  );
}

export default function ChartOfAccounts() {
  const [roots, setRoots] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [showModal, setShowModal] = useState(false);
  const [opts, setOpts] = useState({ parent_accounts: [], account_types: [], companies: [] });
  const [form, setForm] = useState({
    account_name: "",
    account_number: "",
    is_group: false,
    account_type: "",
    account_currency: "",
    parent_account: "",
    company: "",
  });
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast(4000);

  const loadTree = useCallback(async (co) => {
    setLoading(true);
    try {
      const params = co ? { company: co } : {};
      const m = await callMethodGet(toMethodGetUrl("finance_app.api.chart_of_accounts.get_chart_of_accounts", params));
      if (!m) {
        setRoots([]);
        setCompanies([]);
        return;
      }
      setCompanies(m.companies || []);
      setRoots(m.roots || []);
      const nextCo = co || m.company || "";
      if (nextCo) setCompany(nextCo);
      const rootNames = (m.roots || []).filter((x) => x.is_group).map((x) => x.name);
      setExpanded(new Set(rootNames));
    } catch {
      setRoots([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTree(company || undefined);
  }, [company]);

  const expandAll = () => {
    setExpanded(new Set(collectGroupNames(roots)));
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  const onToggle = (name) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };

  const openModal = async () => {
    setForm((f) => ({
      ...f,
      company: "",
      parent_account: "",
    }));
    setShowModal(true);
    try {
      const m = await callMethodGet(
        toMethodGetUrl("finance_app.api.chart_of_accounts.get_chart_of_accounts_form_options", {
          company: company || undefined,
        })
      );
      if (m) {
        setOpts(m);
      }
    } catch {
      /* ignore */
    }
  };

  const handleCreate = async () => {
    if (!form.account_name.trim()) {
      showToast({ type: "error", text: "Account name is required." });
      return;
    }
    if (!form.parent_account) {
      showToast({ type: "error", text: "Select a parent group account." });
      return;
    }
    if (!form.company?.trim()) {
      showToast("Company is required.");
      return;
    }
    const curRaw = (form.account_currency || "").trim();
    if (curRaw && /^\d+(\.\d+)?$/.test(curRaw)) {
      showToast({
        type: "error",
        text: "Currency must be a code like INR, not a number. Leave empty to use company currency.",
      });
      return;
    }
    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.chart_of_accounts.create_chart_account", {
        account_name: form.account_name.trim(),
        company: form.company.trim(),
        parent_account: form.parent_account,
        is_group: form.is_group ? 1 : 0,
        account_type: form.account_type || "",
        account_number: form.account_number || "",
        account_currency: form.account_currency || "",
      });
      if (msg?.status === "success") {
        showToast(msg.message || "Created.");
        setShowModal(false);
        setForm({
          account_name: "",
          account_number: "",
          is_group: false,
          account_type: "",
          account_currency: "",
          parent_account: "",
          company: "",
        });
        loadTree(company || undefined);
      } else {
        const err = msg?.message || "Error";
        showToast(`Error: ${err}`);
      }
    } catch (e) {
      showToast("Error: " + (e.message || "request failed"));
    }
    setSaving(false);
  };

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Chart of Accounts"
        actions={
          <>
            <button type="button" className="pm-btn" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className="pm-btn" onClick={collapseAll}>
              Collapse all
            </button>
            <FinanceCan action="canCreate">
              <button type="button" className="pm-btn pm-btn-primary" onClick={openModal}>
                + New account
              </button>
            </FinanceCan>
          </>
        }
      >
        <div className="finance-toolbar__select">
          <FinanceFormField
            label="Company"
            type="select"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="finance-field--flush"
          >
          {(companies.length ? companies : [{ name: company }]).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
          </FinanceFormField>
        </div>
      </FinancePageHeader>

      <div className="pm-card finance-card-flush">
        <div className="finance-card-head finance-card-head--columns">
          <span className="finance-card-head__title">Account</span>
          <span className="finance-card-head__title">Balance</span>
        </div>
        {loading ? (
          <FinancePageLoader />
        ) : roots.length === 0 ? (
          <div className="pm-empty">No accounts for this company.</div>
        ) : (
          roots.map((n) => <CoaRow key={n.name} node={n} depth={0} expanded={expanded} onToggle={onToggle} />)
        )}
      </div>

      {showModal ? (
        <Modal
          title="New account"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" className="pm-btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <FinanceCan action="canCreate">
                <button type="button" className="pm-btn pm-btn-primary" onClick={handleCreate} disabled={saving}>
                  {saving ? "Creating…" : "Create new"}
                </button>
              </FinanceCan>
            </>
          }
        >
          <div className="finance-form-stack">
            <FinanceFormField
              label="New account name *"
              hint="Do not create accounts for Customers and Suppliers — use their masters."
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            />
            <FinanceFormField
              label="Account number"
              hint="Optional prefix in the full account name."
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value })}
            />
            <label className="finance-form-checkbox">
              <input
                type="checkbox"
                checked={form.is_group}
                onChange={(e) => setForm({ ...form, is_group: e.target.checked })}
              />
              Is group
              <span className="finance-form-hint">Groups hold sub-accounts; ledgers receive postings.</span>
            </label>
            <FinanceFormField
              label="Parent account *"
              hint="Must be a group account in the same company."
              type="select"
              value={form.parent_account}
              onChange={(e) => setForm({ ...form, parent_account: e.target.value })}
            >
              <option value="">Select parent…</option>
              {(opts.parent_accounts || []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Account type"
              hint="Optional — used in transactions and reports."
              type="select"
              value={form.account_type}
              onChange={(e) => setForm({ ...form, account_type: e.target.value })}
            >
              <option value="">None</option>
              {(opts.account_types || []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Currency"
              hint="Optional. Use a currency code (e.g. INR), not an amount."
              value={form.account_currency}
              onChange={(e) => setForm({ ...form, account_currency: e.target.value })}
              placeholder="INR"
              autoComplete="off"
            />
            <FinanceFormField
              label="Company *"
              type="text"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              placeholder=""
              autoComplete="organization"
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
