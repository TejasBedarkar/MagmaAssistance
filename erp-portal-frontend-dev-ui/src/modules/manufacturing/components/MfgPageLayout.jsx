import { Link } from "react-router-dom";
import { Search } from "@/icons/mfgIcons.js";
import ActionIconTip from "../../../common/components/ActionIconTip.jsx";
import ListPagination from "../../../common/components/ListPagination.jsx";

function mfgActVariantClass(variant) {
  if (variant === "danger") return "pm-user-act--delete";
  if (variant === "success") return "pm-user-act--toggle-on";
  if (variant === "primary") return "pm-user-act--reset";
  if (variant === "edit") return "pm-user-act--edit";
  return "";
}

/** Standard manufacturing list / setup page shell (ERP-aligned). */
export function MfgPage({ children, className = "" }) {
  return (
    <div className={`mfg-page space-y-5 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function MfgPageHeader({ title, subtitle, actions, meta }) {
  return (
    <header className="mfg-page-header">
      <div className="mfg-page-header__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {meta}
      </div>
      {actions ? <div className="mfg-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function MfgToolbar({ children, className = "" }) {
  return (
    <div className={`mfg-toolbar card p-4 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function MfgSearchField({
  value,
  onChange,
  placeholder,
  icon: Icon = Search,
  className = "",
}) {
  return (
    <div className={`mfg-search ${className}`.trim()}>
      <Icon size={16} className="mfg-search__icon" aria-hidden />
      <input
        type="search"
        className="input mfg-search__input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

export function MfgSegmentTabs({ tabs, active, onChange }) {
  return (
    <div className="mfg-segment-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? "mfg-segment-tabs__btn is-active" : "mfg-segment-tabs__btn"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function MfgKpiGrid({ children, columns = 4 }) {
  const colClass = columns === 5 ? "mfg-kpi-grid--5" : columns === 3 ? "mfg-kpi-grid--3" : "";
  return (
    <section className={`mfg-kpi-grid pm-kpi-section ${colClass}`.trim()}>
      <div className="pm-kpi-grid pm-kpi-grid--primary">{children}</div>
    </section>
  );
}

export function MfgStatGrid({ children }) {
  return <div className="mfg-stat-grid">{children}</div>;
}

export function MfgStatCard({ label, value, hint }) {
  return (
    <div className="mfg-stat-card">
      <p className="mfg-stat-card__label">{label}</p>
      <p className="mfg-stat-card__value">{value}</p>
      {hint ? <p className="mfg-stat-card__hint">{hint}</p> : null}
    </div>
  );
}

export function MfgTableCard({ children, className = "" }) {
  return (
    <div className={`mfg-table-card pm-table-wrap card ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Use on every paged manufacturing list — styling via .manufacturing-module-root .pm-pagination */
export function MfgListPagination(props) {
  return <ListPagination {...props} />;
}

export function MfgTableHead({ children }) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}

function mfgAlignClass(base, align) {
  if (align === "right") return `${base} ${base}--right`;
  if (align === "center") return `${base} ${base}--center`;
  return base;
}

export function MfgTh({ children, align = "left" }) {
  return (
    <th className={mfgAlignClass("mfg-th", align)}>
      {children}
    </th>
  );
}

export function MfgTd({ children, align = "left", className = "", colSpan, style }) {
  const alignClass = mfgAlignClass("mfg-td", align);
  return (
    <td colSpan={colSpan} className={`${alignClass} ${className}`.trim()} style={style}>
      {children}
    </td>
  );
}

export function MfgRowLink({ to, children, mono }) {
  return (
    <Link
      to={to}
      className={mono ? "mfg-row-link mfg-row-link--mono" : "mfg-row-link"}
    >
      {children}
    </Link>
  );
}

/** Primary / secondary actions with consistent PM button classes. */
export function MfgButton({
  children,
  onClick,
  type = "button",
  variant = "primary",
  size = "md",
  disabled,
  className = "",
  title,
}) {
  const variantClass =
    variant === "primary"
      ? "pm-btn pm-btn-primary"
      : variant === "danger"
        ? "pm-btn pm-btn-danger mfg-btn--danger"
        : "pm-btn";
  const classes = [variantClass, size === "sm" ? "pm-btn-sm" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function MfgLinkButton({ to, children, size = "md", className = "" }) {
  return (
    <Link
      to={to}
      className={`pm-btn pm-btn-primary ${size === "sm" ? "pm-btn-sm" : ""} ${className}`.trim()}
    >
      {children}
    </Link>
  );
}

export function MfgIconButton({
  icon: Icon,
  label,
  onClick,
  variant = "default",
  disabled = false,
}) {
  const variantClass = mfgActVariantClass(variant);
  return (
    <ActionIconTip label={label}>
      <button
        type="button"
        className={`pm-user-act ${variantClass}`.trim()}
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
      >
        <Icon size={16} />
      </button>
    </ActionIconTip>
  );
}

export function MfgIconButtonGroup({ children, className = "" }) {
  return (
    <div className={`pm-user-row-actions ${className}`.trim()}>
      {children}
    </div>
  );
}

export function MfgPanelCard({ title, children, className = "" }) {
  return (
    <section className={`mfg-panel-card card p-4 ${className}`.trim()}>
      {title ? <h3 className="mfg-panel-card__title">{title}</h3> : null}
      {children}
    </section>
  );
}
