/** YYYY-MM-DD for HTML date inputs. */
export function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Matches finance_app general_ledger default P&L / cash flow period (month start −12mo → today). */
export function defaultReportPeriodDates() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 12);
  from.setDate(1);
  return { fromDate: toDateInputValue(from), toDate: toDateInputValue(to) };
}

/** Matches finance_app get_balance_sheet default (as on today). */
export function defaultAsOnDate() {
  return toDateInputValue(new Date());
}

/** Matches finance_app india_compliance default period (last month → today). */
export function defaultCompliancePeriodDates() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 1);
  return { fromDate: toDateInputValue(from), toDate: toDateInputValue(to) };
}
