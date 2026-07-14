/** RCM tax row labels — liability + ITC are paired, not double GST. */

export const RCM_SUMMARY_NOTE =
  "RCM GST is payable to the government separately. Input Tax Credit (ITC) offsets the liability and is available subject to eligibility. Neither amount is included in the supplier payment.";

export function sumRcmTaxByRole(taxes, role) {
  return (taxes || [])
    .filter((t) => t.rcm_role === role)
    .reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
}

export function getRcmSummaryAmounts(invoice) {
  const itemsSubtotal = (invoice?.items || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const grandTotalVal = Number(invoice?.grand_total || 0);
  let subtotal = Number(invoice?.net_total || 0);
  if (!subtotal && itemsSubtotal) subtotal = itemsSubtotal;

  const taxes = invoice?.taxes || [];
  const liability = sumRcmTaxByRole(taxes, "liability") || Number(invoice?.rcm_gst_amount || 0);
  const itc = sumRcmTaxByRole(taxes, "itc") || liability;

  return { subtotal, liability, itc, payable: grandTotalVal };
}

export function purchaseRcmTaxLabel(tax) {
  if (tax?.rcm_role === "liability") {
    const gst = tax.gst_type ? ` (${String(tax.gst_type).toUpperCase()})` : "";
    return `RCM GST Payable (Liability)${gst}`;
  }
  if (tax?.rcm_role === "itc") {
    const gst = tax.gst_type ? ` (${String(tax.gst_type).toUpperCase()})` : "";
    return `RCM Input Tax Credit (ITC)${gst}`;
  }
  let label = tax?.description || tax?.account_head || "Tax";
  if (tax?.gst_type && tax.gst_type !== "other") {
    label += ` (${String(tax.gst_type).toUpperCase()})`;
  }
  if (tax?.is_tds) label += " · TDS";
  return label;
}

export function purchaseTaxLabel(tax, isRcm = false) {
  if (isRcm && tax?.is_rcm) return purchaseRcmTaxLabel(tax);
  let label = tax?.description || tax?.account_head || "Tax";
  if (tax?.gst_type && tax.gst_type !== "other") {
    label += ` (${String(tax.gst_type).toUpperCase()})`;
  }
  if (tax?.is_tds) label += " · TDS";
  return label;
}

export function buildPurchasePdfTaxRows(taxes, isRcm = false) {
  return (taxes || []).map((tax) => {
    let label = purchaseTaxLabel(tax, isRcm);
    if (tax.rate) label += ` @ ${tax.rate}%`;
    return [label, tax.tax_amount];
  });
}

export function buildPurchasePdfSummaryRows(invoice) {
  const itemsSubtotal = (invoice.items || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const grandTotalVal = Number(invoice.grand_total || 0);
  let subtotal = Number(invoice.net_total || 0);
  if (!subtotal && itemsSubtotal) subtotal = itemsSubtotal;

  if (invoice.is_rcm) {
    const { subtotal: rcmSubtotal, liability, itc, payable } = getRcmSummaryAmounts(invoice);
    return [
      ["Subtotal", rcmSubtotal],
      ["RCM GST Liability", liability],
      ["RCM Input Tax Credit (ITC)", itc],
      ["Payable to Supplier", payable],
    ];
  }

  const totalTaxes =
    invoice.total_taxes_and_charges ??
    (invoice.taxes || []).reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
  if (!subtotal && grandTotalVal && totalTaxes) subtotal = Math.max(grandTotalVal - totalTaxes, 0);

  const gstSummary = invoice.gst_summary || {};
  const rows = [["Subtotal", subtotal]];
  for (const [key, label] of [
    ["cgst", "CGST"],
    ["sgst", "SGST"],
    ["igst", "IGST"],
    ["cess", "Cess"],
  ]) {
    const amt = Number(gstSummary[key] || 0);
    if (amt > 0) rows.push([label, amt]);
  }
  rows.push(["Grand total", grandTotalVal]);
  return rows;
}
