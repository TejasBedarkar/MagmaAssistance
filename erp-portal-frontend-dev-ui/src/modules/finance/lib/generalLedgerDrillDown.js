const GL_ENTRY_COLUMNS = [
  { key: "posting_date", label: "Date" },
  { key: "account", label: "Account" },
  { key: "voucher_type", label: "Voucher Type" },
  { key: "voucher_no", label: "Voucher No" },
  { key: "party", label: "Party" },
  { key: "debit", label: "Debit", align: "right", format: "currency" },
  { key: "credit", label: "Credit", align: "right", format: "currency" },
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

function filterLabel({ account, voucherType }) {
  const parts = [];
  if (account) parts.push(`account ${account}`);
  if (voucherType) parts.push(voucherType);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function mapEntryRows(entries = []) {
  return entries.map((e) => ({
    posting_date: e.posting_date,
    account: e.account?.split(" -")[0] || e.account || "—",
    voucher_type: e.voucher_type,
    voucher_no: e.voucher_no,
    party: e.party || "—",
    debit: Number(e.debit || 0),
    credit: Number(e.credit || 0),
  }));
}

function sumField(entries, field) {
  return entries.reduce((sum, e) => sum + Number(e[field] || 0), 0);
}

/**
 * Build drill-down modal payload for General Ledger KPI cards (client-side).
 * @param {string} kpiKey
 * @param {object[]} entries — get_gl_entries rows
 * @param {{ fromDate?: string, toDate?: string, account?: string, voucherType?: string }} filters
 */
export function buildGeneralLedgerKpiDetail(kpiKey, entries = [], filters = {}) {
  const period = periodLabel(filters);
  const scope = filterLabel(filters);
  const totalDr = sumField(entries, "debit");
  const totalCr = sumField(entries, "credit");
  const net = totalDr - totalCr;

  switch (kpiKey) {
    case "total_debit": {
      const rows = entries.filter((e) => Number(e.debit || 0) > 0);
      return {
        title: "Total Debit",
        description: `Debit GL lines for ${period}${scope}.`,
        count: rows.length,
        total: totalDr,
        columns: GL_ENTRY_COLUMNS,
        rows: mapEntryRows(rows),
      };
    }

    case "total_credit": {
      const rows = entries.filter((e) => Number(e.credit || 0) > 0);
      return {
        title: "Total Credit",
        description: `Credit GL lines for ${period}${scope}.`,
        count: rows.length,
        total: totalCr,
        columns: GL_ENTRY_COLUMNS,
        rows: mapEntryRows(rows),
      };
    }

    case "net_balance":
      return {
        title: "Net Balance",
        description: `Debit minus credit for ${period}${scope}.`,
        total: net,
        count: entries.length,
        sections: [
          {
            title: "Summary",
            total: net,
            columns: SUMMARY_COLUMNS,
            rows: [
              { label: "Total Debit", amount: totalDr },
              { label: "Total Credit", amount: totalCr },
              { label: "Net Balance", amount: net },
            ],
          },
          {
            title: "GL entries",
            columns: GL_ENTRY_COLUMNS,
            rows: mapEntryRows(entries),
          },
        ],
      };

    default:
      return { status: "error", title: "Details", message: "Unknown KPI." };
  }
}
