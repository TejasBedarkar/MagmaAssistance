import React from "react";

export default function Modal({ title, children, onClose, footer, wide = false }) {
  return (
    <div className="pm-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`pm-modal${wide ? " pm-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-modal__head">
          <h3 id="pm-modal-title">{title}</h3>
          <button
            type="button"
            className="pm-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="pm-modal__body">{children}</div>
        {footer ? <div className="pm-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
