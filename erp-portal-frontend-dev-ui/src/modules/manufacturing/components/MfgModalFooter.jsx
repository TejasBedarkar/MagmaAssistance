import { MfgButton } from "./MfgPageLayout.jsx";

/** Standard modal actions — footer layout applied by components/Modal.jsx */
export function MfgModalFooter({
  onCancel,
  onSubmit,
  saving = false,
  submitLabel = "Create",
  cancelLabel = "Cancel",
  canSubmit = true,
  savingLabel = "Saving…",
}) {
  return (
    <>
      <MfgButton variant="secondary" onClick={onCancel} disabled={saving}>
        {cancelLabel}
      </MfgButton>
      <MfgButton onClick={onSubmit} disabled={saving || !canSubmit}>
        {saving ? savingLabel : submitLabel}
      </MfgButton>
    </>
  );
}

export function MfgDangerModalFooter({
  onCancel,
  onConfirm,
  saving = false,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  canConfirm = true,
  savingLabel = "Deleting…",
}) {
  return (
    <>
      <MfgButton variant="secondary" onClick={onCancel} disabled={saving}>
        {cancelLabel}
      </MfgButton>
      <MfgButton
        variant="danger"
        onClick={onConfirm}
        disabled={saving || !canConfirm}
        className="mfg-btn--danger-solid"
      >
        {saving ? savingLabel : confirmLabel}
      </MfgButton>
    </>
  );
}

export function MfgModalCloseFooter({ onClose, label = "Close", disabled = false }) {
  return (
    <MfgButton variant="secondary" onClick={onClose} disabled={disabled}>
      {label}
    </MfgButton>
  );
}
