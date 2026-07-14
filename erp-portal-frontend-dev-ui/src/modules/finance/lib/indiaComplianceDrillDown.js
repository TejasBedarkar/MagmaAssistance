const BUCKET_COLUMNS = [
  { key: "label", label: "Tax type" },
  { key: "amount", label: "Amount", align: "right", format: "currency" },
];

const SUMMARY_COLUMNS = [
  { key: "label", label: "Line item" },
  { key: "amount", label: "Amount", align: "right", format: "currency" },
];

const SALES_INVOICE_COLUMNS = [
  { key: "name", label: "Invoice" },
  { key: "party", label: "Customer" },
  { key: "posting_date", label: "Date" },
  { key: "total_taxes", label: "Tax total", align: "right", format: "currency" },
  { key: "grand_total", label: "Grand total", align: "right", format: "currency" },
];

const PURCHASE_INVOICE_COLUMNS = [
  { key: "name", label: "Invoice" },
  { key: "party", label: "Supplier" },
  { key: "posting_date", label: "Date" },
  { key: "total_taxes", label: "Tax total", align: "right", format: "currency" },
  { key: "grand_total", label: "Grand total", align: "right", format: "currency" },
];

const TDS_COLUMNS = [
  { key: "invoice", label: "Invoice" },
  { key: "supplier_name", label: "Supplier" },
  { key: "posting_date", label: "Date" },
  { key: "category", label: "TDS category" },
  { key: "taxable_amount", label: "Taxable", align: "right", format: "currency" },
  { key: "tds_amount", label: "TDS amount", align: "right", format: "currency" },
  { key: "grand_total", label: "Grand total", align: "right", format: "currency" },
];

const BUCKET_ROWS = [
  { label: "CGST", key: "cgst" },
  { label: "SGST / UTGST", key: "sgst" },
  { label: "IGST", key: "igst" },
  { label: "Cess", key: "cess" },
  { label: "Other tax", key: "other" },
];

function periodLabel({ fromDate, toDate }) {
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `from ${fromDate}`;
  if (toDate) return `through ${toDate}`;
  return "selected period";
}

function mapBucketRows(buckets = {}) {
  return BUCKET_ROWS.map((r) => ({
    label: r.label,
    amount: Number(buckets[r.key] || 0),
  }));
}

function mapSalesInvoices(rows = []) {
  return rows.map((inv) => ({
    name: inv.name,
    party: inv.party || "—",
    posting_date: inv.posting_date,
    total_taxes: Number(inv.total_taxes || 0),
    grand_total: Number(inv.grand_total || 0),
  }));
}

function mapPurchaseInvoices(rows = []) {
  return rows.map((inv) => ({
    name: inv.name,
    party: inv.party || "—",
    posting_date: inv.posting_date,
    total_taxes: Number(inv.total_taxes || 0),
    grand_total: Number(inv.grand_total || 0),
  }));
}

function mapTdsRows(rows = []) {
  return rows.map((r) => ({
    invoice: r.invoice,
    supplier_name: r.supplier_name || r.supplier || "—",
    posting_date: r.posting_date,
    category: r.category || "—",
    taxable_amount: Number(r.taxable_amount || 0),
    tds_amount: Number(r.tds_amount || 0),
    grand_total: Number(r.grand_total || 0),
  }));
}

/**
 * Build drill-down modal payload for GST/TDS KPI cards (client-side).
 * @param {string} kpiKey
 * @param {object | null} data — get_compliance_dashboard response
 * @param {{ fromDate?: string, toDate?: string }} filters
 */
export function buildIndiaComplianceKpiDetail(kpiKey, data, filters = {}) {
  if (!data || data.status === "error") {
    return { status: "error", title: "Details", message: "No compliance data loaded." };
  }

  const period = periodLabel(filters);
  const gst = data.gst || {};
  const output = gst.output || {};
  const input = gst.input || {};
  const netPayable = Number(gst.net_payable || 0);
  const salesInvoices = data.sales_invoices || [];
  const purchaseInvoices = data.purchase_invoices || [];
  const tds = data.tds || { rows: [], total_tds: 0 };

  switch (kpiKey) {
    case "output_gst":
      return {
        title: "Output GST (Sales)",
        description: `Output tax on submitted sales invoices for ${period}.`,
        count: salesInvoices.length,
        total: Number(output.total || 0),
        sections: [
          {
            title: "Tax breakdown",
            total: Number(output.total || 0),
            columns: BUCKET_COLUMNS,
            rows: mapBucketRows(output),
          },
          {
            title: "Sales invoices",
            columns: SALES_INVOICE_COLUMNS,
            rows: mapSalesInvoices(salesInvoices),
          },
        ],
      };

    case "input_gst":
      return {
        title: "Input GST (Purchase)",
        description: `Input tax on submitted purchase invoices for ${period}.`,
        count: purchaseInvoices.length,
        total: Number(input.total || 0),
        sections: [
          {
            title: "Tax breakdown",
            total: Number(input.total || 0),
            columns: BUCKET_COLUMNS,
            rows: mapBucketRows(input),
          },
          {
            title: "Purchase invoices",
            columns: PURCHASE_INVOICE_COLUMNS,
            rows: mapPurchaseInvoices(purchaseInvoices),
          },
        ],
      };

    case "net_gst":
      return {
        title: "Net GST (approx)",
        description: `Output GST minus input GST for ${period}.`,
        total: netPayable,
        count: salesInvoices.length + purchaseInvoices.length,
        sections: [
          {
            title: "Summary",
            total: netPayable,
            columns: SUMMARY_COLUMNS,
            rows: [
              { label: "Output GST (sales)", amount: Number(output.total || 0) },
              { label: "Input GST (purchase)", amount: Number(input.total || 0) },
              { label: "Net GST (approx)", amount: netPayable },
            ],
          },
          {
            title: "Output tax breakdown",
            total: Number(output.total || 0),
            columns: BUCKET_COLUMNS,
            rows: mapBucketRows(output),
          },
          {
            title: "Input tax breakdown",
            total: Number(input.total || 0),
            columns: BUCKET_COLUMNS,
            rows: mapBucketRows(input),
          },
        ],
      };

    case "tds_withheld": {
      const rows = tds.rows || [];
      return {
        title: "TDS Withheld",
        description: `TDS on purchase invoices with Apply TDS enabled for ${period}.`,
        count: rows.length,
        total: Number(tds.total_tds || 0),
        columns: TDS_COLUMNS,
        rows: mapTdsRows(rows),
      };
    }

    default:
      return { status: "error", title: "Details", message: "Unknown KPI." };
  }
}
