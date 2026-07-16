/**
 * Manufacturing form label wrapper — portal pm-field / pm-label tokens.
 * Prefer this over raw pm-field in modals and setup pages.
 */
export default function MfgFormField({ label, required, children, hint }) {
  return (
    <label className="pm-field mfg-form-field">
      <span className="pm-label">
        {label}
        {required ? <span className="mfg-form-field__required"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="pm-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Field(props) {
  return <MfgFormField {...props} />;
}
