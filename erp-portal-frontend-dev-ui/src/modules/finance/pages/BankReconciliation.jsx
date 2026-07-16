import { useCallback, useEffect, useMemo, useState } from "react";
import { callMethodGet, callMethod } from "../../../common/api/client.js";
import Modal from "../../../common/components/Modal.jsx";
import { StatusPill } from "../../../common/components/StatusPill.jsx";
import FinanceCan from "../components/FinanceCan.jsx";
import FinanceDocumentHistory from "../components/FinanceDocumentHistory.jsx";
import FinanceDrillDownModal from "../components/FinanceDrillDownModal.jsx";
import FinanceFormField from "../components/FinanceFormField.jsx";
import FinanceKpiCard from "../components/FinanceKpiCard.jsx";
import FinancePageHeader from "../components/FinancePageHeader.jsx";
import useFinanceToast from "../hooks/useFinanceToast.js";
import { buildBankReconciliationKpiDetail } from "../lib/bankReconciliationDrillDown.js";
import { defaultReportPeriodDates } from "../lib/reportDateDefaults.js";
import { toMethodGetUrl } from "../lib/methodUrl.js";
import { reconciliationStatusTone } from "../lib/statusTones.js";

const fmt = (n) =>
  `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtK = (n) => {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const INITIAL_DATES = defaultReportPeriodDates();

const RECON_KPIS = [
  { key: "book_balance", label: "Book balance" },
  { key: "unreconciled", label: "Unreconciled" },
  { key: "reconciled", label: "Reconciled" },
  { key: "pending_deposits", label: "Pending deposits" },
  { key: "pending_withdrawals", label: "Pending withdrawals" },
];

export default function BankReconciliation() {
  const [opts, setOpts] = useState({ bank_accounts: [], expense_accounts: [], customers: [], suppliers: [], modes: [] });
  const [bankAccount, setBankAccount] = useState("");
  const [fromDate, setFromDate] = useState(INITIAL_DATES.fromDate);
  const [toDate, setToDate] = useState(INITIAL_DATES.toDate);
  const [statusFilter, setStatusFilter] = useState("");
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const { showToast } = useFinanceToast(4000);
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [jeAccount, setJeAccount] = useState("");
  const [partyType, setPartyType] = useState("Customer");
  const [party, setParty] = useState("");
  const [drillDown, setDrillDown] = useState(null);

  const filteredTransactions = useMemo(() => {
    if (!statusFilter) return transactions;
    return transactions.filter((tx) => tx.status === statusFilter);
  }, [transactions, statusFilter]);

  const loadOpts = useCallback(async () => {
    try {
      const d = await callMethodGet("finance_app.api.bank_reconciliation.get_reconciliation_options");
      setOpts(d || {});
      if (d?.bank_accounts?.length) {
        setBankAccount((prev) => prev || d.bank_accounts[0].name);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!bankAccount) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = { bank_account: bankAccount };
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;

      const [ov, tx] = await Promise.all([
        callMethodGet(
          toMethodGetUrl("finance_app.api.bank_reconciliation.get_reconciliation_overview", params)
        ),
        callMethodGet(
          toMethodGetUrl("finance_app.api.bank_reconciliation.get_bank_transactions_list", params)
        ),
      ]);
      if (ov?.status !== "error") setOverview(ov);
      setTransactions(tx || []);
    } catch {
      showToast({ ok: false, message: "Failed to load reconciliation data." });
    }
    setLoading(false);
  }, [bankAccount, fromDate, toDate, showToast]);

  useEffect(() => {
    loadOpts();
  }, [loadOpts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openTransaction = async (tx) => {
    setSelected(tx);
    setMatches([]);
    setJeAccount("");
    setParty("");
    if (tx.status === "Reconciled" || Number(tx.unallocated_amount || 0) === 0) return;
    setMatchLoading(true);
    try {
      const params = { bank_transaction_name: tx.name };
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const matchesList = await callMethodGet(
        toMethodGetUrl("finance_app.api.bank_reconciliation.get_linked_payments", params)
      );
      setMatches(matchesList || []);
    } catch {
      setMatches([]);
    }
    setMatchLoading(false);
  };

  const handleMatch = async (m) => {
    if (!selected) return;
    setActing(true);
    try {
      const msg = await callMethod("finance_app.api.bank_reconciliation.reconcile_transaction", {
        bank_transaction_name: selected.name,
        payment_doctype: m.doctype,
        payment_name: m.name,
        amount: m.paid_amount,
      });
      if (msg?.status === "success") {
        showToast(msg.message);
        setSelected(null);
        loadData();
      } else {
        showToast({ ok: false, message: msg?.message || "Match failed" });
      }
    } catch (e) {
      showToast({ ok: false, message: e.message });
    }
    setActing(false);
  };

  const handleJournal = async () => {
    if (!selected || !jeAccount) return;
    setActing(true);
    try {
      const msg = await callMethod("finance_app.api.bank_reconciliation.create_journal_for_transaction", {
        bank_transaction_name: selected.name,
        expense_account: jeAccount,
      });
      if (msg?.status === "success") {
        showToast(msg.message);
        setSelected(null);
        loadData();
      } else {
        showToast({ ok: false, message: msg?.message || "Failed" });
      }
    } catch (e) {
      showToast({ ok: false, message: e.message });
    }
    setActing(false);
  };

  const handlePayment = async () => {
    if (!selected || !party) return;
    setActing(true);
    try {
      const msg = await callMethod("finance_app.api.bank_reconciliation.create_payment_for_transaction", {
        bank_transaction_name: selected.name,
        party_type: partyType,
        party,
        mode_of_payment: opts.modes?.[0] || "Bank",
      });
      if (msg?.status === "success") {
        showToast(msg.message);
        setSelected(null);
        loadData();
      } else {
        showToast({ ok: false, message: msg?.message || "Failed" });
      }
    } catch (e) {
      showToast({ ok: false, message: e.message });
    }
    setActing(false);
  };

  const handleAutoReconcile = async () => {
    if (!bankAccount) return;
    setActing(true);
    try {
      const msg = await callMethod("finance_app.api.bank_reconciliation.run_auto_reconcile", {
        bank_account: bankAccount,
        from_date: fromDate,
        to_date: toDate,
      });
      if (msg?.status === "success") {
        const matched = (msg.reconciled || 0) + (msg.partially_reconciled || 0);
        showToast({ ok: matched > 0, message: msg.message || "Done" });
        loadData();
      } else {
        showToast({ ok: false, message: msg?.message || "Failed" });
      }
    } catch (e) {
      showToast({ ok: false, message: e.message });
    }
    setActing(false);
  };

  const handleImport = async () => {
    if (!bankAccount || !csvText.trim()) return;
    setActing(true);
    try {
      const msg = await callMethod("finance_app.api.bank_reconciliation.import_bank_statement", {
        bank_account: bankAccount,
        file_content: csvText,
      });
      if (msg?.status === "success") {
        showToast(msg.message);
        setShowUpload(false);
        setCsvText("");
        loadData();
      } else {
        showToast({ ok: false, message: msg?.message || "Import failed" });
      }
    } catch (e) {
      showToast({ ok: false, message: e.message });
    }
    setActing(false);
  };

  const onFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const parties = partyType === "Customer" ? opts.customers : opts.suppliers;

  const openKpiDetail = useCallback(
    (kpiKey) => {
      const item = RECON_KPIS.find((k) => k.key === kpiKey);
      setDrillDown(
        buildBankReconciliationKpiDetail(kpiKey, overview, transactions) || {
          title: item?.label || "Details",
        }
      );
    },
    [overview, transactions]
  );

  const closeKpiDetail = useCallback(() => setDrillDown(null), []);

  const kpiHandlers = useMemo(
    () => Object.fromEntries(RECON_KPIS.map((k) => [k.key, () => openKpiDetail(k.key)])),
    [openKpiDetail]
  );

  return (
    <div className="pm-page finance-page">
      {drillDown ? <FinanceDrillDownModal detail={drillDown} loading={false} onClose={closeKpiDetail} /> : null}

      <FinancePageHeader
        title="Bank Reconciliation"
        description="Match bank statement lines to payments and journal entries"
        actions={
          <>
            <FinanceCan action="canCreate">
              <button type="button" className="pm-btn" onClick={() => setShowUpload(true)}>
                Upload CSV
              </button>
              <button
                type="button"
                className="pm-btn"
                onClick={handleAutoReconcile}
                disabled={acting || !bankAccount}
              >
                Auto reconcile
              </button>
            </FinanceCan>
            <button type="button" className="pm-btn pm-btn-primary" onClick={loadData} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <div className="pm-card finance-filter-grid--auto-160 finance-card--spaced">
        <FinanceFormField
          label="Bank account"
          type="select"
          value={bankAccount}
          onChange={(e) => setBankAccount(e.target.value)}
          className="finance-field--flush"
        >
          <option value="">Select…</option>
          {(opts.bank_accounts || []).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name} ({b.account_name || b.account})
            </option>
          ))}
        </FinanceFormField>
        <FinanceFormField
          label="From date"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="finance-field--flush"
        />
        <FinanceFormField
          label="To date"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="finance-field--flush"
        />
        <FinanceFormField
          label="Status"
          type="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="finance-field--flush"
        >
          <option value="">All</option>
          <option value="Unreconciled">Unreconciled</option>
          <option value="Reconciled">Reconciled</option>
          <option value="Pending">Pending</option>
        </FinanceFormField>
      </div>

      {overview?.status === "success" && (
        <div className="finance-stat-grid finance-stat-grid--5 finance-stat-grid--equal finance-filter-grid--spaced">
          <FinanceKpiCard
            className="finance-stat-grid__item"
            label="Book balance"
            value={fmtK(overview.book_balance)}
            accentClass="finance-stat-tile__value--accent"
            onClick={kpiHandlers.book_balance}
          />
          <FinanceKpiCard
            className="finance-stat-grid__item"
            label="Unreconciled"
            value={String(overview.unreconciled_count ?? 0)}
            accentClass="finance-stat-tile__value--warning"
            onClick={kpiHandlers.unreconciled}
          />
          <FinanceKpiCard
            className="finance-stat-grid__item"
            label="Reconciled"
            value={String(overview.reconciled_count ?? 0)}
            accentClass="finance-stat-tile__value--success"
            onClick={kpiHandlers.reconciled}
          />
          <FinanceKpiCard
            className="finance-stat-grid__item"
            label="Pending deposits"
            value={fmtK(overview.pending_deposits)}
            accentClass="finance-stat-tile__value--success"
            onClick={kpiHandlers.pending_deposits}
          />
          <FinanceKpiCard
            className="finance-stat-grid__item"
            label="Pending withdrawals"
            value={fmtK(overview.pending_withdrawals)}
            accentClass="finance-stat-tile__value--danger"
            onClick={kpiHandlers.pending_withdrawals}
          />
        </div>
      )}

      <div className={`finance-split-layout ${selected ? "finance-split-layout--detail" : ""}`}>
        <div className="pm-card finance-card-flush">
          <div className="finance-card-head">
            <span className="finance-card-head__title">Bank transactions</span>
          </div>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  {["Date", "Description", "Type", "Amount", "Unallocated", "Status"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="pm-empty">
                      Loading…
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="pm-empty">
                      No bank transactions. Upload a CSV statement to begin.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr
                      key={tx.name}
                      onClick={() => openTransaction(tx)}
                      className={[
                        selected?.name === tx.name ? "finance-row-selected" : "",
                        "finance-row-clickable",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td>{tx.date}</td>
                      <td className="finance-cell-ellipsis-sm">{tx.description || "—"}</td>
                      <td>
                        <span className={tx.type === "Deposit" ? "finance-cell-success" : "finance-cell-danger"}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="finance-cell-title">{fmt(tx.amount)}</td>
                      <td
                        className={
                          Number(tx.unallocated_amount || 0) > 0 ? "finance-cell-warning" : "finance-cell-success"
                        }
                      >
                        {fmt(tx.unallocated_amount)}
                      </td>
                      <td>
                        <StatusPill tone={reconciliationStatusTone(tx.status)}>{tx.status || "—"}</StatusPill>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="pm-card finance-panel-sticky">
            <div className="finance-detail-actions finance-detail-actions--compact">
              <h3 className="finance-detail-title finance-detail-title--sm">{selected.name}</h3>
              <button
                type="button"
                className="pm-btn finance-panel-close"
                onClick={() => setSelected(null)}
                aria-label="Close detail panel"
              >
                ×
              </button>
            </div>
            <p className="finance-detail-sub finance-detail-sub--spaced">{selected.description}</p>
            <div className="finance-panel-meta">
              <div>
                Date: <strong className="finance-cell-title">{selected.date}</strong>
              </div>
              <div>
                Amount:{" "}
                <strong className={selected.type === "Deposit" ? "finance-cell-success" : "finance-cell-danger"}>
                  {fmt(selected.amount)}
                </strong>
              </div>
              <div>
                Unallocated: <strong className="finance-cell-warning">{fmt(selected.unallocated_amount)}</strong>
              </div>
              <div>
                Status: <StatusPill tone={reconciliationStatusTone(selected.status)}>{selected.status || "—"}</StatusPill>
              </div>
            </div>

            {selected.matched_vouchers?.length > 0 && (
              <>
                <h4 className="finance-control-section__title finance-control-section__title--panel">Already matched</h4>
                {selected.matched_vouchers.map((v, i) => (
                  <div key={i} className="finance-match-row finance-match-row--sm">
                    <strong className="finance-cell-accent">
                      {v.doctype} {v.name}
                    </strong>
                    <span>— {fmt(v.amount)}</span>
                  </div>
                ))}
              </>
            )}

            {Number(selected.unallocated_amount || 0) > 0 && (
              <>
                <h4 className="finance-control-section__title finance-control-section__title--panel">Suggested matches</h4>
                {matchLoading ? (
                  <p className="finance-panel-meta finance-panel-meta--flush">Finding matches…</p>
                ) : matches.length === 0 ? (
                  <p className="finance-panel-meta finance-panel-meta--spaced">
                    No automatic matches. Create a journal or payment below.
                  </p>
                ) : (
                  <div className="finance-match-list">
                    {matches.map((m, i) => (
                      <div key={i} className="finance-match-row">
                        <div className="finance-match-row__main">
                          <strong className="finance-cell-accent">
                            {m.doctype} {m.name}
                          </strong>
                          <div className="finance-cell-muted">
                            {m.party || m.party_name || ""} · {m.posting_date}
                          </div>
                        </div>
                        <FinanceCan action="canCreate">
                          <button
                            type="button"
                            className="pm-btn pm-btn-primary finance-match-btn"
                            disabled={acting}
                            onClick={() => handleMatch(m)}
                          >
                            Match
                          </button>
                        </FinanceCan>
                      </div>
                    ))}
                  </div>
                )}

                <h4 className="finance-control-section__title finance-control-section__title--panel">
                  Bank charge / expense (Journal)
                </h4>
                <FinanceFormField
                  type="select"
                  value={jeAccount}
                  onChange={(e) => setJeAccount(e.target.value)}
                  className="finance-field--flush"
                >
                  <option value="">Expense account…</option>
                  {(opts.expense_accounts || []).map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.account_name || a.name}
                    </option>
                  ))}
                </FinanceFormField>
                <FinanceCan action="canCreate">
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary finance-btn-block--spaced"
                    disabled={acting || !jeAccount}
                    onClick={handleJournal}
                  >
                    Create journal & match
                  </button>
                </FinanceCan>

                <h4 className="finance-control-section__title finance-control-section__title--panel">Party payment</h4>
                <FinanceFormField
                  type="select"
                  value={partyType}
                  onChange={(e) => {
                    setPartyType(e.target.value);
                    setParty("");
                  }}
                  className="finance-field--flush"
                >
                  <option value="Customer">Customer (Receive)</option>
                  <option value="Supplier">Supplier (Pay)</option>
                </FinanceFormField>
                <FinanceFormField
                  type="select"
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  className="finance-field--flush"
                >
                  <option value="">Select party…</option>
                  {parties.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.customer_name || p.supplier_name || p.name}
                    </option>
                  ))}
                </FinanceFormField>
                <FinanceCan action="canCreate">
                  <button
                    type="button"
                    className="pm-btn finance-btn-block"
                    disabled={acting || !party}
                    onClick={handlePayment}
                  >
                    Create payment & match
                  </button>
                </FinanceCan>
              </>
            )}

            <FinanceDocumentHistory
              doctype="Bank Transaction"
              name={selected.name}
              showToast={showToast}
            />
          </div>
        )}
      </div>

      {showUpload ? (
        <Modal
          title="Upload bank statement (CSV)"
          onClose={() => setShowUpload(false)}
          footer={
            <>
              <FinanceCan action="canCreate">
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  disabled={acting || !csvText.trim()}
                  onClick={handleImport}
                >
                  Import
                </button>
              </FinanceCan>
              <button type="button" className="pm-btn" onClick={() => setShowUpload(false)}>
                Cancel
              </button>
            </>
          }
        >
          <p className="finance-detail-sub finance-detail-sub--modal">
            Required columns: <strong>Date</strong>, <strong>Description</strong>, <strong>Withdrawal</strong>,{" "}
            <strong>Deposit</strong>
            <br />
            Or: Date, Description, Amount (positive = deposit, negative = withdrawal)
          </p>
          <div className="finance-form-field--spaced">
            <input type="file" accept=".csv,text/csv" onChange={onFilePick} className="pm-input" />
          </div>
          <FinanceFormField
            type="textarea"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Or paste CSV content here…"
            rows={8}
            className="finance-field--flush"
            inputClassName="pm-textarea--mono"
          />
        </Modal>
      ) : null}
    </div>
  );
}
