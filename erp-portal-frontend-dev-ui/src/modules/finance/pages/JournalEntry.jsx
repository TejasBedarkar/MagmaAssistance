import { useEffect, useMemo, useState } from "react";
import ApprovalDetailPanel from "../components/ApprovalDetailPanel.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import { buildApprovalListColumns } from "../lib/approvalListColumns.jsx";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceDataTable, { FINANCE_LIST_PAGE_SIZE } from "../components/FinanceDataTable.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import ApprovalLimitNotice from "../components/ApprovalLimitNotice.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import { useFinanceRole } from "../hooks/useFinanceRole.js";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { approvalSubmitLabel, showApprovalCreateToast } from "../lib/approvalUi.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { docStatusLabel, docStatusTone } from "../lib/statusTones.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const VOUCHER_TYPES = [
  "Journal Entry",
  "Bank Entry",
  "Cash Entry",
  "Credit Note",
  "Debit Note",
  "Write Off",
  "Opening Entry",
];

const EMPTY_LINE = { account: "", debit: 0, credit: 0, party_type: "", party: "" };

const freshForm = () => ({
  posting_date: "",
  voucher_type: "Journal Entry",
  remark: "",
  accounts: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
});

const formatParty = (line) => {
  if (!line?.party) return "—";
  return line.party_type ? `${line.party_type}: ${line.party}` : line.party;
};

const needsParty = (accountName, accountList) => {
  const acc = accountList.find((a) => a.name === accountName);
  return acc?.account_type === "Receivable" || acc?.account_type === "Payable";
};

const partyTypeForAccount = (accountName, accountList) => {
  const acc = accountList.find((a) => a.name === accountName);
  if (acc?.account_type === "Receivable") return "Customer";
  if (acc?.account_type === "Payable") return "Supplier";
  return "";
};

/** Party is only sent for Receivable/Payable accounts (ERPNext GL rule). */
const serializeJeAccountLine = (line, accountList) => {
  const requiredPartyType = partyTypeForAccount(line.account, accountList);
  return {
    account: line.account,
    debit: line.debit,
    credit: line.credit,
    party_type: requiredPartyType ? requiredPartyType : "",
    party: requiredPartyType ? line.party || "" : "",
  };
};

export default function JournalEntry() {
  const { needsCfoApproval, isCfo, user } = useFinanceRole();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(freshForm);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFinanceToast();
  const [viewEntry, setViewEntry] = useState(null);

  useEffect(() => {
    load();
    loadAccounts();
    loadParties();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const message = await callMethodGet("finance_app.api.journal_entry.get_journal_entries");
      setEntries(message || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  const loadAccounts = async () => {
    try {
      const message = await callMethodGet("finance_app.api.general_ledger.get_accounts");
      setAccounts((message || []).filter((a) => !a.is_group));
    } catch {
      /* ignore */
    }
  };

  const loadParties = async () => {
    try {
      const message = await callMethodGet("finance_app.api.bank_reconciliation.get_reconciliation_options");
      setCustomers(message?.customers || []);
      setSuppliers(message?.suppliers || []);
    } catch {
      /* ignore */
    }
  };

  const viewDetail = async (name) => {
    try {
      const message = await callMethodGet(
        toMethodGetUrl("finance_app.api.journal_entry.get_journal_entry", { name })
      );
      if (message) setViewEntry(message);
    } catch {
      /* ignore */
    }
  };

  const totalDebit = form.accounts.reduce((s, a) => s + parseFloat(a.debit || 0), 0);
  const totalCredit = form.accounts.reduce((s, a) => s + parseFloat(a.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const closeForm = () => {
    setShowForm(false);
    setForm(freshForm());
  };

  const handleCreate = async (e) => {
    e?.stopPropagation?.();
    if (!isBalanced) {
      showToast("Debits must equal Credits!");
      return;
    }
    const activeLines = form.accounts.filter(
      (a) => a.account && (parseFloat(a.debit) > 0 || parseFloat(a.credit) > 0)
    );
    for (let i = 0; i < activeLines.length; i++) {
      const line = activeLines[i];
      const label = line.account.split(" -")[0];
      const requiredPartyType = partyTypeForAccount(line.account, accounts);
      if (requiredPartyType && !line.party) {
        showToast(`Row ${i + 1}: ${requiredPartyType} is required for ${label}`);
        return;
      }
      if (requiredPartyType && line.party_type && line.party_type !== requiredPartyType) {
        showToast(`Row ${i + 1}: ${label} requires Party Type "${requiredPartyType}"`);
        return;
      }
      if (!requiredPartyType && (line.party_type || line.party)) {
        showToast(`Row ${i + 1}: Party is only allowed on Receivable/Payable accounts (${label})`);
        return;
      }
    }
    setSaving(true);
    try {
      const msg = await callMethod("finance_app.api.journal_entry.create_journal_entry", {
        posting_date: form.posting_date,
        voucher_type: form.voucher_type,
        remark: form.remark,
        accounts: JSON.stringify(activeLines.map((a) => serializeJeAccountLine(a, accounts))),
      });
      if (msg?.status === "success") {
        closeForm();
        setViewEntry(null);
        showApprovalCreateToast(
          showToast,
          msg,
          `Journal Entry ${msg.name || ""} created and submitted.`
        );
        load();
      } else {
        showToast(msg?.message || "Error creating journal entry");
      }
    } catch (err) {
      showToast("Error: " + err.message);
    }
    setSaving(false);
  };

  const jeSubmitLabel = approvalSubmitLabel({
    needsCfoApproval,
    isCfo,
    doctype: "Journal Entry",
    amount: totalDebit,
    defaultLabel: "Create & Submit",
  });

  const approvalColumns = useMemo(
    () =>
      buildApprovalListColumns({
        doctype: "Journal Entry",
        user,
        onResubmitSuccess: load,
        showToast,
      }),
    [user, load, showToast]
  );

  if (viewEntry) {
    return (
      <div className="pm-page finance-page">
        <button type="button" className="pm-btn pm-btn-ghost finance-back-link" onClick={() => setViewEntry(null)}>
          ← Back to List
        </button>
        <div className="pm-card">
          <div className="finance-detail-actions finance-detail-actions--center">
            <h2 className="finance-detail-title">{viewEntry.name}</h2>
            <StatusPill tone={docStatusTone(viewEntry.docstatus)}>
              {docStatusLabel(viewEntry.docstatus)}
            </StatusPill>
          </div>
          <div className="finance-field-grid">
            <div>
              <div className="finance-field-label">DATE</div>
              <div className="finance-field-value">{viewEntry.posting_date}</div>
            </div>
            <div>
              <div className="finance-field-label">TYPE</div>
              <div className="finance-field-value">{viewEntry.voucher_type}</div>
            </div>
            <div>
              <div className="finance-field-label">TOTAL</div>
              <div className="finance-field-value finance-field-value--success">
                Dr {fmt(viewEntry.total_debit)} / Cr {fmt(viewEntry.total_credit)}
              </div>
            </div>
          </div>
          <ApprovalDetailPanel
            doctype="Journal Entry"
            row={viewEntry}
            user={user}
            showToast={showToast}
            onResubmitSuccess={() => {
              load();
              viewDetail(viewEntry.name);
            }}
          />
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  {["Account", "Party", "Debit", "Credit"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(viewEntry.accounts || []).map((a, i) => (
                  <tr key={i}>
                    <td className="finance-cell-title">{a.account?.split(" -")[0]}</td>
                    <td className="finance-cell-muted">{formatParty(a)}</td>
                    <td className={a.debit > 0 ? "finance-cell-success" : "finance-cell-muted"}>
                      {a.debit > 0 ? fmt(a.debit) : "—"}
                    </td>
                    <td className={a.credit > 0 ? "finance-cell-danger" : "finance-cell-muted"}>
                      {a.credit > 0 ? fmt(a.credit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {viewEntry.remark ? <div className="finance-remark-box">{viewEntry.remark}</div> : null}
          <FinanceDocumentHistory doctype="Journal Entry" name={viewEntry.name} showToast={showToast} />
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page finance-page">

      <FinancePageHeader
        title="Journal Entries"
        className="finance-page-header--actions-end"
        actions={
          <FinanceCan action="canCreate">
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={() => {
                setForm(freshForm());
                setShowForm(true);
              }}
            >
              + New Journal Entry
            </button>
          </FinanceCan>
        }
      />

      {showForm ? (
        <Modal
          title="Create Journal Entry"
          wide
          onClose={closeForm}
          footer={
            <div className="finance-modal-footer finance-modal-footer--between">
              <FinanceCan action="canCreate">
                <div className="finance-modal-footer">
                  <button
                    type="button"
                    className="pm-btn finance-btn-success-outline"
                    onClick={() => setForm({ ...form, accounts: [...form.accounts, { ...EMPTY_LINE }] })}
                  >
                    + Add Line
                  </button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary"
                    onClick={handleCreate}
                    disabled={saving || !form.posting_date || !isBalanced}
                  >
                    {saving ? "Creating..." : jeSubmitLabel}
                  </button>
                </div>
              </FinanceCan>
              <div className={`finance-balance-indicator ${isBalanced ? "finance-balance-indicator--ok" : "finance-balance-indicator--err"}`}>
                Dr: {fmt(totalDebit)} | Cr: {fmt(totalCredit)} {isBalanced ? "✓ Balanced" : "✗ Not Balanced"}
              </div>
            </div>
          }
        >
          <ApprovalLimitNotice doctype="Journal Entry" amount={totalDebit} />
          <div className="finance-form-grid--3">
            <FinanceFormField
              label="Posting Date"
              type="date"
              value={form.posting_date}
              onChange={(e) => setForm({ ...form, posting_date: e.target.value })}
            />
            <FinanceFormField
              label="Voucher Type"
              type="select"
              value={form.voucher_type}
              onChange={(e) => setForm({ ...form, voucher_type: e.target.value })}
            >
              {VOUCHER_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </FinanceFormField>
            <FinanceFormField
              label="Remark"
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder="Description..."
            />
          </div>
          <h4 className="finance-section-title--flush">Account Lines</h4>
          {form.accounts.map((acc, i) => {
            const partyRequired = needsParty(acc.account, accounts);
            const lockedPartyType = partyTypeForAccount(acc.account, accounts);
            const partyOptions = lockedPartyType === "Supplier" ? suppliers : customers;
            return (
              <div key={i} className="finance-line-box">
                <div className="finance-form-grid--items finance-form-grid--flush">
                  <select
                    className="pm-select"
                    value={acc.account}
                    onChange={(e) => {
                      const a = [...form.accounts];
                      const accountName = e.target.value;
                      const requiredType = partyTypeForAccount(accountName, accounts);
                      a[i].account = accountName;
                      a[i].party_type = requiredType;
                      a[i].party = "";
                      setForm({ ...form, accounts: a });
                    }}
                  >
                    <option value="">Select Account...</option>
                    {accounts.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.account_name} ({a.root_type})
                      </option>
                    ))}
                  </select>
                  <input
                    className="pm-input"
                    type="number"
                    placeholder="Debit"
                    value={acc.debit || ""}
                    onChange={(e) => {
                      const a = [...form.accounts];
                      a[i].debit = e.target.value;
                      a[i].credit = 0;
                      setForm({ ...form, accounts: a });
                    }}
                  />
                  <input
                    className="pm-input"
                    type="number"
                    placeholder="Credit"
                    value={acc.credit || ""}
                    onChange={(e) => {
                      const a = [...form.accounts];
                      a[i].credit = e.target.value;
                      a[i].debit = 0;
                      setForm({ ...form, accounts: a });
                    }}
                  />
                  <button
                    type="button"
                    className="pm-btn pm-btn-danger"
                    onClick={() => {
                      const a = form.accounts.filter((_, j) => j !== i);
                      setForm({
                        ...form,
                        accounts: a.length >= 2 ? a : [...a, { ...EMPTY_LINE }],
                      });
                    }}
                  >
                    ✕
                  </button>
                </div>
                {partyRequired ? (
                  <div className="finance-form-grid--party">
                    <div>
                      <div className="finance-party-label">PARTY TYPE *</div>
                      <select className="pm-select" value={lockedPartyType} disabled>
                        <option value={lockedPartyType}>{lockedPartyType}</option>
                      </select>
                    </div>
                    <div>
                      <div className="finance-party-label">PARTY *</div>
                      <select
                        className="pm-select"
                        value={acc.party}
                        onChange={(e) => {
                          const a = [...form.accounts];
                          a[i].party = e.target.value;
                          setForm({ ...form, accounts: a });
                        }}
                      >
                        <option value="">
                          {`Select ${lockedPartyType === "Supplier" ? "Supplier" : "Customer"}...`}
                        </option>
                        {partyOptions.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.customer_name || p.supplier_name || p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </Modal>
      ) : null}

      <FinanceDataTable
        columns={[
          { key: "name", label: "Entry", render: (e) => <span className="finance-cell-accent">{e.name}</span> },
          { key: "posting_date", label: "Date", render: (e) => <span className="finance-cell-muted">{e.posting_date}</span> },
          {
            key: "voucher_type",
            label: "Type",
            render: (e) => <span className="finance-voucher-pill">{e.voucher_type}</span>,
          },
          { key: "total_debit", label: "Debit", render: (e) => <span className="finance-cell-success">{fmt(e.total_debit)}</span> },
          { key: "total_credit", label: "Credit", render: (e) => <span className="finance-cell-danger">{fmt(e.total_credit)}</span> },
          {
            key: "remark",
            label: "Remark",
            render: (e) => (
              <span className="finance-cell-muted finance-cell-ellipsis">{e.remark || e.title || "—"}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (e) => (
              <StatusPill tone={docStatusTone(e.docstatus)}>{docStatusLabel(e.docstatus)}</StatusPill>
            ),
          },
          ...approvalColumns,
        ]}
        rows={entries}
        pageSize={FINANCE_LIST_PAGE_SIZE}
        loading={loading}
        loadingMessage="Loading..."
        emptyMessage="No journal entries found"
        getRowKey={(e) => e.name}
        onRowClick={(e) => {
          if (showForm) return;
          viewDetail(e.name);
        }}
      />
    </div>
  );
}
