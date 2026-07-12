const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

const GST_LABELS = {
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  cess: "Cess",
  other: "Other tax",
};

export default function FinanceGstPreview({ preview }) {
  if (!preview) return null;

  const validation = preview.validation || {};
  const gstSummary = preview.gst_summary || {};
  const taxes = preview.taxes || [];
  const items = preview.items || [];

  return (
    <div className="finance-gst-preview">
      {validation.errors?.length ? (
        <div className="finance-gst-preview__errors">
          {validation.errors.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
          {validation.errors.some((msg) => /HSN/i.test(msg)) ? (
            <p className="finance-gst-preview__hint">
              Set <strong>GST HSN Code</strong> on each Item in ERPNext (Stock → Item → link to GST HSN
              Code master), then reopen this preview.
            </p>
          ) : null}
        </div>
      ) : null}
      {validation.warnings?.length ? (
        <div className="finance-gst-preview__warnings">
          {validation.warnings.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      ) : null}

      {preview.set_warehouse ? (
        <div className="finance-gst-preview__meta">
          <span className="finance-field-label">Warehouse</span>
          <strong>{preview.set_warehouse}</strong>
        </div>
      ) : null}

      {items.length ? (
        <>
          <h4 className="finance-gst-preview__title">Items & HSN</h4>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  {["Item", "HSN", "Qty", "Rate", "Amount"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={`${row.item_code}-${idx}`}>
                    <td className="finance-cell-title">{row.item_name || row.item_code}</td>
                    <td className={row.hsn_code ? "" : "finance-cell-warning"}>{row.hsn_code || "Missing"}</td>
                    <td>{row.qty}</td>
                    <td>{fmt(row.rate)}</td>
                    <td className="finance-cell-accent">{fmt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {taxes.length ? (
        <>
          <h4 className="finance-gst-preview__title">GST breakdown</h4>
          <div className="finance-gst-preview__buckets">
            {Object.entries(GST_LABELS).map(([key, label]) =>
              gstSummary[key] > 0 ? (
                <div key={key} className="finance-gst-preview__bucket">
                  <span>{label}</span>
                  <strong>{fmt(gstSummary[key])}</strong>
                </div>
              ) : null
            )}
          </div>
          <div className="finance-tax-list">
            {taxes.map((tax, idx) => (
              <div key={`${tax.account_head}-${idx}`} className="finance-tax-row">
                <span className="finance-cell-title">
                  {tax.description || tax.account_head}
                  {tax.gst_type ? ` (${String(tax.gst_type).toUpperCase()})` : ""}
                </span>
                <span className="finance-cell-accent">{fmt(tax.tax_amount)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="finance-gst-preview__totals">
        <div>
          <span>Net total</span>
          <strong>{fmt(preview.net_total)}</strong>
        </div>
        <div>
          <span>Total tax</span>
          <strong>{fmt(preview.total_taxes)}</strong>
        </div>
        <div>
          <span>Grand total</span>
          <strong className="finance-cell-accent">{fmt(preview.grand_total)}</strong>
        </div>
      </div>
    </div>
  );
}
