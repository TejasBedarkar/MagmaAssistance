/**
 * Labelled form control — uses pm-field / pm-label / pm-input / pm-select.
 * For selects, pass <option> elements as children.
 * For a custom control, pass a single child element with any type.
 */
export default function FinanceFormField({
  label,
  hint,
  type = "text",
  className = "",
  inputClassName = "",
  children,
  id,
  ...controlProps
}) {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  let control;
  if (children && type !== "select" && type !== "textarea") {
    control = children;
  } else if (type === "select") {
    control = (
      <select id={fieldId} className={`pm-select ${inputClassName}`.trim()} {...controlProps}>
        {children}
      </select>
    );
  } else if (type === "textarea") {
    control = <textarea id={fieldId} className={`pm-textarea ${inputClassName}`.trim()} {...controlProps} />;
  } else {
    control = <input id={fieldId} type={type} className={`pm-input ${inputClassName}`.trim()} {...controlProps} />;
  }

  return (
    <div className={`pm-field ${className}`.trim()}>
      {label ? (
        <label className="pm-label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      {control}
      {hint ? <p className="pm-field-hint">{hint}</p> : null}
    </div>
  );
}
