import { financeFmt } from "../lib/financeFmt.js";
import FinanceBomBreakdownTable from "./FinanceBomBreakdownTable.jsx";

const GST_LABELS = {
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  cess: "Cess",
  other: "Other tax",
};

function PartyBlock({ title, name, gstin, address }) {
  return (
    <div className="finance-invoice-party">
      <div className="finance-invoice-party__title">{title}</div>
      <div className="finance-invoice-party__name">{name || "—"}</div>
      {gstin ? (
        <div className="finance-invoice-party__meta">
          <span className="finance-field-label">GSTIN</span> {gstin}
        </div>
      ) : null}
      {address ? <div className="finance-invoice-party__address">{address}</div> : null}
    </div>
  );
}

export default function FinanceSalesInvoiceDocument({ invoice }) {
  if (!invoice) return null;

  const billing = invoice.billing || {};
  const company = billing.company || invoice.company || {};
  const customer = invoice.customer_details || {};
  const items = invoice.items || billing.items || [];
  const taxes = invoice.taxes || billing.taxes || [];
  const gstSummary = invoice.gst_summary || billing.gst_summary || {};
  const itemsSubtotal = items.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalTaxes =
    invoice.total_taxes_and_charges ??
    billing.total_taxes ??
    taxes.reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
  const grandTotal = invoice.grand_total ?? billing.grand_total;
  let netTotal = invoice.net_total ?? billing.net_total;
  if (!netTotal && itemsSubtotal) netTotal = itemsSubtotal;
  if (!netTotal && grandTotal && totalTaxes) netTotal = Math.max(grandTotal - totalTaxes, 0);
  const cgstAmount =
    gstSummary.cgst ||
    taxes.filter((t) => String(t.gst_type || "").toLowerCase() === "cgst").reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const sgstAmount =
    gstSummary.sgst ||
    taxes.filter((t) => String(t.gst_type || "").toLowerCase() === "sgst").reduce((s, t) => s + Number(t.tax_amount || 0), 0);

  return (
    <div className="finance-invoice-doc">
      <div className="finance-invoice-doc__banner">
        <div>
          <div className="finance-invoice-doc__type">Tax Invoice</div>
          <div className="finance-invoice-doc__number">{invoice.name}</div>
        </div>
        <div className="finance-invoice-doc__dates">
          <div>
            <span className="finance-field-label">Invoice date</span>
            <strong>{invoice.posting_date || "—"}</strong>
          </div>
          <div>
            <span className="finance-field-label">Due date</span>
            <strong>{invoice.due_date || "—"}</strong>
          </div>
          <div>
            <span className="finance-field-label">Payment terms</span>
            <strong>{invoice.payment_terms || invoice.customer_details?.payment_terms || "—"}</strong>
          </div>
        </div>
      </div>

      <div className="finance-invoice-doc__parties">
        <PartyBlock
          title="Bill from"
          name={company.company_name || company.name}
          gstin={company.gstin}
          address={company.address}
        />
        <PartyBlock
          title="Bill to"
          name={customer.customer_name || invoice.customer}
          gstin={customer.gstin}
          address={customer.address}
        />
      </div>

      {(invoice.sales_order || invoice.delivery_note || billing.set_warehouse || invoice.taxes_and_charges) ? (
        <div className="finance-field-grid--stats finance-invoice-doc__refs">
          {invoice.sales_order ? (
            <div>
              <div className="finance-field-label">SALES ORDER</div>
              <div className="finance-field-value">{invoice.sales_order}</div>
            </div>
          ) : null}
          {invoice.delivery_note ? (
            <div>
              <div className="finance-field-label">DELIVERY NOTE</div>
              <div className="finance-field-value">{invoice.delivery_note}</div>
            </div>
          ) : null}
          {billing.set_warehouse ? (
            <div>
              <div className="finance-field-label">WAREHOUSE</div>
              <div className="finance-field-value">{billing.set_warehouse}</div>
            </div>
          ) : null}
          {invoice.taxes_and_charges ? (
            <div>
              <div className="finance-field-label">TAX TEMPLATE</div>
              <div className="finance-field-value finance-field-value--sm">{invoice.taxes_and_charges}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="finance-control-section finance-invoice-doc__section">
        <h3 className="finance-control-section__title finance-control-section__title--items">
          Items &amp; HSN
        </h3>
        {items.length ? (
          <div className="pm-table-wrap">
            <table className="pm-table finance-detail-table finance-invoice-items-table">
              <thead>
                <tr>
                  {["#", "Item", "HSN/SAC", "Qty", "Rate", "Amount"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={`${row.item_code}-${idx}`}>
                    <td>{idx + 1}</td>
                    <td className="finance-cell-title">{row.item_name || row.item_code}</td>
                    <td className={row.hsn_code ? "" : "finance-cell-warning"}>{row.hsn_code || "—"}</td>
                    <td>{row.qty}</td>
                    <td>{financeFmt(row.rate)}</td>
                    <td className="finance-cell-accent">{financeFmt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="finance-cell-muted finance-text-sm--flush">
            No line items on this invoice. Amount: {financeFmt(grandTotal)}.
          </p>
        )}
      </div>

      <FinanceBomBreakdownTable items={invoice.bom_items} total={invoice.bom_total} />

      <div className="finance-invoice-doc__bottom">
        <div className="finance-invoice-doc__gst">
          <h3 className="finance-control-section__title">GST breakdown</h3>
          {taxes.length ? (
            taxes.map((tax, idx) => (
              <div key={`${tax.account_head}-${idx}`} className="finance-tax-row">
                <span className="finance-cell-title">
                  {tax.description || tax.account_head}
                  {tax.gst_type ? ` (${String(tax.gst_type).toUpperCase()})` : ""}
                  {tax.rate ? ` @ ${tax.rate}%` : ""}
                </span>
                <span className="finance-cell-accent">{financeFmt(tax.tax_amount)}</span>
              </div>
            ))
          ) : Object.entries(GST_LABELS).some(([key]) => gstSummary[key] > 0) ? (
            <div className="finance-gst-preview__buckets">
              {Object.entries(GST_LABELS).map(([key, label]) =>
                gstSummary[key] > 0 ? (
                  <div key={key} className="finance-gst-preview__bucket">
                    <span>{label}</span>
                    <strong>{financeFmt(gstSummary[key])}</strong>
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <p className="finance-cell-muted finance-text-sm--flush">No GST lines recorded.</p>
          )}
        </div>

        <div className="finance-invoice-doc__totals">
          <div className="finance-tax-row">
            <span className="finance-cell-muted">Subtotal</span>
            <span>{financeFmt(netTotal)}</span>
          </div>
          <div className="finance-tax-row">
            <span className="finance-cell-muted">CGST</span>
            <span>{financeFmt(cgstAmount)}</span>
          </div>
          <div className="finance-tax-row">
            <span className="finance-cell-muted">SGST</span>
            <span>{financeFmt(sgstAmount)}</span>
          </div>
          <div className="finance-tax-row finance-tax-row--total">
            <span>Grand total</span>
            <span className="finance-cell-accent">{financeFmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {invoice.remarks ? (
        <div className="finance-remark-box">{invoice.remarks}</div>
      ) : null}
    </div>
  );
}
