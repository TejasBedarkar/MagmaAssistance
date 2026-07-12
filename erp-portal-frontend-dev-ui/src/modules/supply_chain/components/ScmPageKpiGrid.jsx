/** Standard KPI row for SCM list pages (matches Reservations layout). */
export default function ScmPageKpiGrid({ children, className = "" }) {
  return (
    <div className={`scm-page-kpi-grid ${className}`.trim()}>
      {children}
    </div>
  );
}
