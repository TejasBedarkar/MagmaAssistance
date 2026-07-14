/** Empty-state message for finance lists and tables. */
export default function FinanceEmptyState({ message = "No records found.", children }) {
  return (
    <div className="pm-empty">
      {message}
      {children}
    </div>
  );
}
