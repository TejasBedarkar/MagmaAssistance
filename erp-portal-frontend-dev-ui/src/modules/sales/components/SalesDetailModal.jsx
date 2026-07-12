import Modal from "../../../common/components/Modal.jsx";

/**
 * Sales module dialog — thin wrapper on portal Modal (same pattern as Lead page).
 */
export default function SalesDetailModal({
  title,
  onClose,
  wide = false,
  footer = null,
  form = false,
  customer = false,
  quotation = false,
  order = false,
  rma = false,
  opportunity = false,
  list = false,
  children,
}) {
  const wrapClass = [
    "sales-detail-modal",
    wide && "sales-detail-modal--wide",
    (form || customer || quotation) && "sales-detail-modal--form",
    customer && "sales-detail-modal--customer",
    quotation && "sales-detail-modal--quotation",
    order && "sales-detail-modal--order",
    rma && "sales-detail-modal--rma",
    opportunity && "sales-detail-modal--opportunity",
    list && "sales-detail-modal--list",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass}>
      <Modal title={title} onClose={onClose} wide={wide} footer={footer}>
        {children}
      </Modal>
    </div>
  );
}
