import PmModal from "../../../common/components/Modal.jsx";
import { useMfgModalEscape } from "../hooks/useMfgModalEscape.js";

/**
 * Manufacturing modal — portal pm-modal + open guard + Escape + wide/size mapping.
 * Use MfgModalFooter / MfgDangerModalFooter for action rows.
 */
export default function Modal({ open, onClose, title, children, footer, wide, size }) {
  const isWide = wide || size === "lg" || size === "xl";
  useMfgModalEscape(open, onClose);

  if (!open) return null;

  const footerNode = footer ? (
    <div className="mfg-modal-confirm__footer">{footer}</div>
  ) : null;

  return (
    <PmModal title={title} onClose={onClose} footer={footerNode} wide={isWide}>
      {children}
    </PmModal>
  );
}

export { MfgModalFooter, MfgDangerModalFooter, MfgModalCloseFooter } from "./MfgModalFooter.jsx";
