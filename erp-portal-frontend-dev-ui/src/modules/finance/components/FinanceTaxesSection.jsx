import { financeFmt } from "../lib/financeFmt.js";
import { getRcmSummaryAmounts, RCM_SUMMARY_NOTE } from "../lib/financeRcmTax.js";

export default function FinanceTaxesSection({
  taxes = [],
  taxesTemplate = "",
  netTotal,
  totalTaxes,
  grandTotal,
  emptyMessage = "No tax lines on this document.",
  taxLabel = (tax) => tax.description || tax.account_head || "Tax",
  isRcm = false,
  rcmGstAmount,
  supplierPayableTax,
}) {
  const payableTax = supplierPayableTax ?? totalTaxes;
  const rcmSummary = isRcm
    ? getRcmSummaryAmounts({
        net_total: netTotal,
        grand_total: grandTotal,
        taxes,
        rcm_gst_amount: rcmGstAmount,
      })
    : null;

  return (
    <div className="finance-control-section">
      <h3 className="finance-control-section__title">Taxes</h3>
      {taxesTemplate ? (
        <p className="finance-detail-sub finance-text-sm--flush">Template: {taxesTemplate}</p>
      ) : null}
      {isRcm ? (
        <p className="finance-detail-sub finance-detail-sub--warning finance-text-sm--flush">
          Reverse Charge (RCM): GST is recorded for compliance but is <strong>not added</strong> to the amount
          payable to the supplier. Liability and ITC lines below refer to the same RCM tax.
        </p>
      ) : null}
      {!taxes.length ? (
        <p className="finance-cell-muted finance-text-sm--flush">{emptyMessage}</p>
      ) : (
        taxes.map((tax, idx) => (
          <div key={`${tax.description || tax.account_head}-${idx}`} className="finance-tax-row">
            <span className="finance-cell-title">{taxLabel(tax)}</span>
            <span className="finance-cell-accent">{financeFmt(tax.tax_amount)}</span>
          </div>
        ))
      )}
      {isRcm && rcmSummary ? (
        <>
          <div className="finance-tax-row finance-tax-row--total">
            <span className="finance-cell-muted">Subtotal</span>
            <span className="finance-cell-accent">{financeFmt(rcmSummary.subtotal)}</span>
          </div>
          <div className="finance-tax-row">
            <span className="finance-cell-muted">RCM GST Liability</span>
            <span className="finance-cell-accent">{financeFmt(rcmSummary.liability)}</span>
          </div>
          <div className="finance-tax-row">
            <span className="finance-cell-muted">RCM Input Tax Credit (ITC)</span>
            <span className="finance-cell-accent">{financeFmt(rcmSummary.itc)}</span>
          </div>
          <div className="finance-tax-row finance-tax-row--total">
            <span className="finance-cell-muted">Payable to Supplier</span>
            <span className="finance-cell-accent">{financeFmt(rcmSummary.payable)}</span>
          </div>
          <p className="finance-detail-sub finance-text-sm--flush">{RCM_SUMMARY_NOTE}</p>
        </>
      ) : null}
      {!isRcm && (netTotal != null || totalTaxes != null || grandTotal != null) ? (
        <div className="finance-tax-row finance-tax-row--total">
          <span className="finance-cell-muted">Net / Tax / Grand</span>
          <span className="finance-cell-accent">
            {financeFmt(netTotal)} / {financeFmt(payableTax)} / {financeFmt(grandTotal)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
