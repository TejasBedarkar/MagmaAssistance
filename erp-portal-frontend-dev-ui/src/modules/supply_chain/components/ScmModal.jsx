import { useEffect } from "react";

/** SCM-themed modal — view/edit dialogs for list pages. */
export default function ScmModal({ title, subtitle, open, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="scm-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`scm-modal${wide ? " scm-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="scm-modal__head">
          <div>
            <h2 id="scm-modal-title" className="scm-modal__title">
              {title}
            </h2>
            {subtitle ? <p className="scm-modal__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="scm-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="scm-modal__body">{children}</div>
        {footer ? <footer className="scm-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
