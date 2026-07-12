/** Modal action row — shared footer bar for sales administrator dialogs. */
export default function SalesModalFooter({ children, className = "" }) {
  return (
    <div className={["sales-modal-footer", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
