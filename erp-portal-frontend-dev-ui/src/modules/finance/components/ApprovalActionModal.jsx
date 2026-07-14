import { useEffect, useState } from "react";

export default function ApprovalActionModal({
  open,
  title,
  confirmLabel,
  confirmTone = "primary",
  onConfirm,
  onClose,
  busy = false,
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="finance-approval-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finance-approval-modal-title"
    >
      <button
        type="button"
        className="finance-approval-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="finance-approval-modal__panel">
        <h3 id="finance-approval-modal-title" className="finance-approval-modal__title">
          {title}
        </h3>
        <label className="finance-approval-modal__label" htmlFor="finance-approval-reason">
          Reason <span className="finance-approval-modal__required">*</span>
        </label>
        <textarea
          id="finance-approval-reason"
          className="pm-input finance-approval-modal__textarea"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter a reason for the creator"
          disabled={busy}
        />
        <div className="finance-approval-modal__actions">
          <button
            type="button"
            className="pm-btn pm-btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`pm-btn pm-btn-${confirmTone}`}
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}