const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

function PreviewItemsTable({ items = [] }) {
  const showWarehouse = items.some((row) => row.warehouse);
  if (!items.length) {
    return <p className="finance-cell-muted finance-text-sm--flush">No line items on this order.</p>;
  }
  const headers = showWarehouse
    ? ["Item", "Warehouse", "Qty", "Rate", "Amount"]
    : ["Item", "Qty", "Rate", "Amount"];

  return (
    <div className="pm-table-wrap">
      <table className="pm-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, idx) => (
            <tr key={`${row.item_code}-${idx}`}>
              <td className="finance-cell-title">{row.item_name || row.item_code}</td>
              {showWarehouse ? <td className="finance-cell-muted">{row.warehouse || "—"}</td> : null}
              <td>{row.qty}</td>
              <td>{fmt(row.rate)}</td>
              <td className="finance-cell-accent">{fmt(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewTaxesList({ taxes = [] }) {
  if (!taxes.length) {
    return <p className="finance-cell-muted finance-text-sm--flush">No tax lines on this order.</p>;
  }
  return (
    <div>
      {taxes.map((tax, idx) => (
        <div key={`${tax.description || tax.account_head}-${idx}`} className="finance-tax-row">
          <span className="finance-cell-title">{tax.description || tax.account_head || "Tax"}</span>
          <span className="finance-cell-accent">{fmt(tax.tax_amount)}</span>
        </div>
      ))}
    </div>
  );
}

/** Read-only Sales Order / delivery preview for Finance create flows. */
export default function FinanceOrderPreviewPanel({ preview, loading = false }) {
  if (loading) {
    return <p className="finance-cell-muted">Loading order details…</p>;
  }
  if (!preview) return null;

  const party = preview.customer_name || preview.party_name || preview.customer || "—";
  const showTotals = preview.grand_total != null || preview.net_total != null || preview.total_taxes != null;

  return (
    <div className="finance-order-preview">
      <div className="finance-field-grid--auto finance-field-grid--gap">
        <div>
          <div className="finance-field-label">CUSTOMER</div>
          <div className="finance-field-value">{party}</div>
        </div>
        <div>
          <div className="finance-field-label">SALES ORDER</div>
          <div className="finance-field-value">{preview.sales_order || "—"}</div>
        </div>
        {preview.quotation ? (
          <div>
            <div className="finance-field-label">QUOTATION</div>
            <div className="finance-field-value">{preview.quotation}</div>
          </div>
        ) : null}
        {preview.order_date ? (
          <div>
            <div className="finance-field-label">ORDER DATE</div>
            <div className="finance-field-value">{preview.order_date}</div>
          </div>
        ) : null}
        {preview.delivery_date ? (
          <div>
            <div className="finance-field-label">DELIVERY DATE</div>
            <div className="finance-field-value">{preview.delivery_date}</div>
          </div>
        ) : null}
        {preview.order_status ? (
          <div>
            <div className="finance-field-label">STATUS</div>
            <div className="finance-field-value">{preview.order_status}</div>
          </div>
        ) : null}
        <div>
          <div className="finance-field-label">WAREHOUSE</div>
          <div className="finance-field-value">{preview.set_warehouse || "—"}</div>
        </div>
        {preview.contact_email ? (
          <div>
            <div className="finance-field-label">EMAIL</div>
            <div className="finance-field-value finance-field-value--sm">{preview.contact_email}</div>
          </div>
        ) : null}
        {preview.contact_phone ? (
          <div>
            <div className="finance-field-label">PHONE</div>
            <div className="finance-field-value">{preview.contact_phone}</div>
          </div>
        ) : null}
        {preview.shipping_address ? (
          <div className="finance-field-grid__full">
            <div className="finance-field-label">SHIPPING</div>
            <div className="finance-field-value finance-field-value--sm">{preview.shipping_address}</div>
          </div>
        ) : null}
        {preview.taxes_and_charges ? (
          <div className="finance-field-grid__full">
            <div className="finance-field-label">TAX TEMPLATE</div>
            <div className="finance-field-value">{preview.taxes_and_charges}</div>
          </div>
        ) : null}
        {preview.notes ? (
          <div className="finance-field-grid__full">
            <div className="finance-field-label">NOTES</div>
            <div className="finance-field-value finance-field-value--sm">{preview.notes}</div>
          </div>
        ) : null}
      </div>

      <div className="finance-field-grid__full">
        <h4 className="finance-control-section__title finance-control-section__title--items">Order lines</h4>
        <PreviewItemsTable items={preview.items} />
      </div>

      {preview.taxes?.length ? (
        <div className="finance-field-grid__full">
          <h4 className="finance-control-section__title">Taxes</h4>
          <PreviewTaxesList taxes={preview.taxes} />
        </div>
      ) : null}

      {showTotals ? (
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
            <strong className="finance-cell-accent">{fmt(preview.grand_total ?? preview.order_amount)}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}
