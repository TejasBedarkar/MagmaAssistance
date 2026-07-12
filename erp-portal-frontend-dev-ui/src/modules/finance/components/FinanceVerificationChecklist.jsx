import { StatusPill } from "../../../common/components/StatusPill.jsx";

export default function FinanceVerificationChecklist({ fields = [], title = "Verification checklist" }) {
  if (!fields.length) return null;

  return (
    <div className="finance-control-section">
      <h3 className="finance-control-section__title">{title}</h3>
      <ul className="finance-verify-list finance-verify-list--grid">
        {fields.map((field) => (
          <li key={field.key} className="finance-verify-list__item">
            <span className="finance-verify-list__label">{field.label}</span>
            <StatusPill tone={field.ok ? "success" : "warn"}>{field.ok ? "OK" : "Review"}</StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
}
