export default function FinanceDocumentHeader({ title, subtitle, status, actions }) {
  return (
    <div className="finance-detail-actions finance-detail-actions--center">
      <div>
        <h2 className="finance-detail-title">{title}</h2>
        {subtitle ? <p className="finance-detail-sub">{subtitle}</p> : null}
      </div>
      <div className="finance-detail-actions__buttons">
        {status || null}
        {actions || null}
      </div>
    </div>
  );
}
