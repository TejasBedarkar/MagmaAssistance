import Modal from "../../../common/components/Modal.jsx";

/**
 * Delete confirmation — portal Modal + pm-btn pattern.
 * Replaces window.confirm for consistent Sales Module UX.
 */
export default function ConfirmDeleteModal({
  target,
  title = "Delete",
  bodyLine2 = "This cannot be undone.",
  errorMessage = null,
  confirmLabel = "Yes, Delete",
  cancelLabel = "Cancel",
  loading = false,
  onCancel,
  onConfirm,
  secondaryAction = null,
}) {
  if (!target?.id) return null;

  const label = String(target.label || target.id || "").trim() || target.id;
  const handleClose = () => {
    if (!loading) onCancel?.();
  };

  return (
    <Modal
      title={title}
      onClose={handleClose}
      footer={
        <div className="sales-confirm-delete__footer">
          <button type="button" className="pm-btn pm-btn-ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          {secondaryAction ? (
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={secondaryAction.onClick}
              disabled={loading}
            >
              {secondaryAction.label}
            </button>
          ) : null}
          {onConfirm && confirmLabel ? (
            <button type="button" className="pm-btn pm-btn-danger" onClick={onConfirm} disabled={loading}>
              {loading ? "Deleting…" : confirmLabel}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="sales-confirm-delete__body">
        <div className="sales-confirm-delete__icon" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </div>
        {errorMessage ? (
          <p className="sales-confirm-delete__error" role="alert">
            {errorMessage}
          </p>
        ) : (
          <p className="sales-confirm-delete__message">
            Delete <strong>&quot;{label}&quot;</strong>?
            {bodyLine2 ? (
              <>
                <br />
                {bodyLine2}
              </>
            ) : null}
          </p>
        )}
      </div>
    </Modal>
  );
}
