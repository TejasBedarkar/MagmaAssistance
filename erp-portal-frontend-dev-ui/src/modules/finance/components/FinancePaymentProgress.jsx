import { tokens } from "../theme/tokens.js";

function PayBar({ pct }) {
  const p = Math.min(100, pct || 0);
  const barColor = p >= 100 ? tokens.success : p >= 50 ? tokens.warning : tokens.danger;
  return (
    <div className="finance-pay-bar">
      <div className="finance-pay-bar__track">
        <div className="finance-pay-bar__fill" style={{ width: `${p}%`, background: barColor }} />
      </div>
      <span className="finance-pay-bar__pct">{Math.round(pct || 0)}%</span>
    </div>
  );
}

export default function FinancePaymentProgress({ pct }) {
  return (
    <div className="finance-progress-wrap">
      <div className="finance-progress-header">
        <span className="finance-progress-label">PAYMENT PROGRESS</span>
        <span className="finance-progress-pct">{Math.round(pct || 0)}% paid</span>
      </div>
      <PayBar pct={pct} />
    </div>
  );
}
