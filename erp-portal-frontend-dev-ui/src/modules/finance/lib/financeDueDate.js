/** Mirror finance_app.api.payment_terms due-date rules for the create-invoice form. */

export function dueDateFromPaymentTerms(postingDate, paymentTerms) {
  const posting = postingDate || new Date().toISOString().slice(0, 10);
  const base = new Date(`${posting}T00:00:00`);
  if (Number.isNaN(base.getTime())) return posting;

  const terms = String(paymentTerms || "").trim();
  if (!terms) return posting;

  const lower = terms.toLowerCase();
  if (lower.includes("receipt") || ["immediate", "cod", "due on delivery"].includes(lower)) {
    return posting;
  }

  const netMatch = terms.match(/net\s*(\d+)/i);
  const daysMatch = terms.match(/(\d+)\s*days?/i);
  const days = netMatch ? parseInt(netMatch[1], 10) : daysMatch ? parseInt(daysMatch[1], 10) : 0;
  if (days > 0) {
    const due = new Date(base);
    due.setDate(due.getDate() + days);
    return due.toISOString().slice(0, 10);
  }
  return posting;
}

export function withAutoDueDate(form) {
  const posting = form.posting_date || new Date().toISOString().slice(0, 10);
  return {
    ...form,
    due_date: dueDateFromPaymentTerms(posting, form.payment_terms),
  };
}
