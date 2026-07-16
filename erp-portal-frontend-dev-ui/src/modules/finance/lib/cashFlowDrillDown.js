const LINE_COLUMNS = [
  { key: "label", label: "Line item" },
  { key: "amount", label: "Amount", align: "right", format: "currency" },
];

function periodLabel(data) {
  if (data?.from_date && data?.to_date) {
    return `${data.from_date} to ${data.to_date}`;
  }
  return "selected period";
}

function lineRows(lines = []) {
  return lines.map((line) => ({
    label: line.label,
    amount: line.amount,
  }));
}

/**
 * Build drill-down modal payload for Cash Flow KPI cards (client-side, no extra API).
 * @param {string} kpiKey
 * @param {object | null} data — get_cash_flow response
 */
export function buildCashFlowKpiDetail(kpiKey, data) {
  if (!data) {
    return { status: "error", title: "Details", message: "No cash flow data loaded." };
  }

  const period = periodLabel(data);

  switch (kpiKey) {
    case "operating":
      return {
        title: "Net Cash from Operations",
        description: `Operating cash flow (indirect method) for ${period}.`,
        count: data.operating?.lines?.length || 0,
        total: data.operating?.total,
        columns: LINE_COLUMNS,
        rows: lineRows(data.operating?.lines),
      };
    case "investing":
      return {
        title: "Net Cash from Investing",
        description: `Investing activity for ${period}.`,
        count: data.investing?.lines?.length || 0,
        total: data.investing?.total,
        columns: LINE_COLUMNS,
        rows: lineRows(data.investing?.lines),
      };
    case "financing":
      return {
        title: "Net Cash from Financing",
        description: `Financing activity for ${period}.`,
        count: data.financing?.lines?.length || 0,
        total: data.financing?.total,
        columns: LINE_COLUMNS,
        rows: lineRows(data.financing?.lines),
      };
    case "net_change":
      return {
        title: "Net Change in Cash",
        description: `Operations + investing + financing for ${period}.`,
        total: data.net_change_in_cash,
        columns: LINE_COLUMNS,
        rows: [
          { label: "Net Cash from Operations", amount: data.operating?.total },
          { label: "Net Cash from Investing", amount: data.investing?.total },
          { label: "Net Cash from Financing", amount: data.financing?.total },
        ],
      };
    case "opening_cash":
      return {
        title: "Opening Cash",
        description: `Cash and bank GL balance before ${data.from_date || "period start"}.`,
        total: data.opening_cash,
        columns: LINE_COLUMNS,
        rows: [{ label: "Cash & Bank accounts", amount: data.opening_cash }],
      };
    case "closing_cash":
      return {
        title: "Closing Cash",
        description: data.is_reconciled
          ? `Cash and bank balance as on ${data.to_date || "period end"} — reconciled with indirect cash flow.`
          : `Cash and bank balance as on ${data.to_date || "period end"} — review reconciliation.`,
        total: data.closing_cash,
        columns: LINE_COLUMNS,
        rows: [
          { label: "Opening cash & bank", amount: data.opening_cash },
          { label: "Net change in period", amount: data.net_change_in_cash },
          { label: "Closing cash & bank (GL)", amount: data.closing_cash },
        ],
      };
    default:
      return { status: "error", title: "Details", message: "Unknown KPI." };
  }
}
