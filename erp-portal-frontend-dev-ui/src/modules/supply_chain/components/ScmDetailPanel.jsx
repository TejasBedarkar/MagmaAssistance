import ScmPanel from "./ScmPanel.jsx";

export default function ScmDetailPanel({ title, subtitle, onClose, children, actions }) {
  if (!title) return null;

  return (
    <div className="scm-detail-panel">
      <ScmPanel
        title={title}
        subtitle={subtitle}
        badge={
          onClose ? (
            <button type="button" className="scm-btn-ghost" onClick={onClose}>
              Close
            </button>
          ) : null
        }
      >
        {children}
        {actions ? <div className="scm-form-actions">{actions}</div> : null}
      </ScmPanel>
    </div>
  );
}

export function ScmDetailField({ label, value }) {
  return (
    <div className="scm-detail-field">
      <p className="scm-detail-field__label">{label}</p>
      <p className="scm-detail-field__value">{value ?? "—"}</p>
    </div>
  );
}
