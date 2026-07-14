export default function ScmPageLoader({ label = "Loading…" }) {
  return (
    <div className="scm-page-loader" role="status" aria-live="polite">
      <div className="scm-page-loader__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
