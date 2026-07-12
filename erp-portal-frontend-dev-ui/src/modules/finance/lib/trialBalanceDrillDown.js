const ACCOUNT_COLUMNS = [
  { key: "account", label: "Account" },
  { key: "debit", label: "Debit", align: "right", format: "currency" },
  { key: "credit", label: "Credit", align: "right", format: "currency" },
  { key: "balance", label: "Balance", align: "right", format: "currency" },
];

const SUMMARY_COLUMNS = [
  { key: "label", label: "Line item" },
  { key: "amount", label: "Amount", align: "right", format: "currency" },
];

function periodLabel({ fromDate, toDate }) {
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `from ${fromDate}`;
  if (toDate) return `through ${toDate}`;
  return "selected period";
}

function mapAccountRows(entries = []) {
  return entries.map((e) => ({
    account: e.account?.split(" -")[0] || e.account || "—",
    debit: Number(e.debit || 0),
    credit: Number(e.credit || 0),
    balance: Number(e.balance ?? (Number(e.debit || 0) - Number(e.credit || 0))),
  }));
}

/**
 * Build drill-down modal payload for Trial Balance KPI cards (client-side).
 * @param {string} kpiKey
 * @param {object | null} data — get_trial_balance response
 * @param {{ fromDate?: string, toDate?: string }} filters
 */
export function buildTrialBalanceKpiDetail(kpiKey, data, filters = {}) {
  if (!data) {
    return { status: "error", title: "Details", message: "No trial balance data loaded." };
  }

  const period = periodLabel(filters);
  const entries = data.entries || [];
  const totalDr = Number(data.total_debit || 0);
  const totalCr = Number(data.total_credit || 0);
  const diff = totalDr - totalCr;

  switch (kpiKey) {
    case "total_debit": {
      const rows = entries.filter((e) => Number(e.debit || 0) > 0);
      return {
        title: "Total Debit",
        description: `Accounts with debit balance for ${period}.`,
        count: rows.length,
        total: totalDr,
        columns: ACCOUNT_COLUMNS,
        rows: mapAccountRows(rows),
      };
    }

    case "total_credit": {
      const rows = entries.filter((e) => Number(e.credit || 0) > 0);
      return {
        title: "Total Credit",
        description: `Accounts with credit balance for ${period}.`,
        count: rows.length,
        total: totalCr,
        columns: ACCOUNT_COLUMNS,
        rows: mapAccountRows(rows),
      };
    }

    case "balance_status":
      return {
        title: "Balance Status",
        description: data.is_balanced
          ? `Trial balance is balanced for ${period}.`
          : `Trial balance is out of balance for ${period}.`,
        count: entries.length,
        sections: [
          {
            title: "Summary",
            total: diff,
            columns: SUMMARY_COLUMNS,
            rows: [
              { label: "Total Debit", amount: totalDr },
              { label: "Total Credit", amount: totalCr },
              { label: "Difference", amount: diff },
            ],
          },
          {
            title: "All accounts",
            columns: ACCOUNT_COLUMNS,
            rows: mapAccountRows(entries),
          },
        ],
      };

    default:
      return { status: "error", title: "Details", message: "Unknown KPI." };
  }
}
