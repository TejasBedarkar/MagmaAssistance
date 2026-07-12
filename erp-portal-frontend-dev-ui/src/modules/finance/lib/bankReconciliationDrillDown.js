const UNRECONCILED_STATUSES = new Set(["Pending", "Unreconciled"]);

const TX_COLUMNS = [
  { key: "name", label: "Transaction" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount", align: "right", format: "currency" },
  { key: "unallocated_amount", label: "Unallocated", align: "right", format: "currency" },
];

function periodLabel(overview) {
  if (overview?.from_date && overview?.to_date) {
    return `${overview.from_date} to ${overview.to_date}`;
  }
  if (overview?.to_date) {
    return `through ${overview.to_date}`;
  }
  return "selected period";
}

function mapTxRows(rows = []) {
  return rows.map((r) => ({
    name: r.name,
    date: r.date,
    description: r.description || "—",
    type: r.type,
    status: r.status,
    amount: r.amount,
    unallocated_amount: r.unallocated_amount,
  }));
}

function isUnreconciled(tx) {
  return UNRECONCILED_STATUSES.has(tx.status);
}

function sumUnallocated(rows = []) {
  return rows.reduce((sum, r) => sum + Number(r.unallocated_amount || 0), 0);
}

/**
 * Build drill-down modal payload for Bank Reconciliation KPI cards (client-side).
 * @param {string} kpiKey
 * @param {object | null} overview — get_reconciliation_overview response
 * @param {object[]} transactions — full transaction list (unfiltered by status)
 */
export function buildBankReconciliationKpiDetail(kpiKey, overview, transactions = []) {
  if (!overview || overview.status !== "success") {
    return { status: "error", title: "Details", message: "No reconciliation data loaded." };
  }

  const period = periodLabel(overview);
  const account = overview.bank_account || "bank account";

  switch (kpiKey) {
    case "book_balance":
      return {
        title: "Book Balance",
        description: `Ledger balance for ${account} as on ${overview.to_date || "today"}.`,
        total: overview.book_balance,
        sections: [
          {
            title: "Ledger account",
            total: overview.book_balance,
            columns: [
              { key: "account", label: "GL account" },
              { key: "balance", label: "Balance", align: "right", format: "currency" },
            ],
            rows: [
              {
                account: overview.gl_account || account,
                balance: overview.book_balance,
              },
            ],
          },
          {
            title: `Bank transactions (${period})`,
            columns: TX_COLUMNS,
            rows: mapTxRows(transactions),
          },
        ],
        count: transactions.length,
      };

    case "unreconciled": {
      const rows = transactions.filter(isUnreconciled);
      return {
        title: "Unreconciled",
        description: `Submitted bank lines pending reconciliation for ${period}.`,
        count: rows.length,
        total: sumUnallocated(rows),
        columns: TX_COLUMNS,
        rows: mapTxRows(rows),
      };
    }

    case "reconciled": {
      const rows = transactions.filter((t) => t.status === "Reconciled");
      return {
        title: "Reconciled",
        description: `Fully matched bank transactions for ${period}.`,
        count: rows.length,
        columns: TX_COLUMNS,
        rows: mapTxRows(rows),
      };
    }

    case "pending_deposits": {
      const rows = transactions.filter(
        (t) => isUnreconciled(t) && t.type === "Deposit" && Number(t.unallocated_amount || 0) > 0
      );
      return {
        title: "Pending Deposits",
        description: `Unreconciled deposit lines with unallocated amount for ${period}.`,
        count: rows.length,
        total: sumUnallocated(rows),
        columns: TX_COLUMNS,
        rows: mapTxRows(rows),
      };
    }

    case "pending_withdrawals": {
      const rows = transactions.filter(
        (t) => isUnreconciled(t) && t.type === "Withdrawal" && Number(t.unallocated_amount || 0) > 0
      );
      return {
        title: "Pending Withdrawals",
        description: `Unreconciled withdrawal lines with unallocated amount for ${period}.`,
        count: rows.length,
        total: sumUnallocated(rows),
        columns: TX_COLUMNS,
        rows: mapTxRows(rows),
      };
    }

    default:
      return { status: "error", title: "Details", message: "Unknown KPI." };
  }
}
