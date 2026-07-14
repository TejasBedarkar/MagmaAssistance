import { useFinanceRole } from "../hooks/useFinanceRole.js";

const fmt = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * Warns when amount exceeds FM approval limit (saved as draft for CFO).
 */
export default function ApprovalLimitNotice({ doctype, amount, hint }) {
  const { needsCfoApproval, approvalLimit, isCfo } = useFinanceRole();
  const amt = Number(amount) || 0;

  if (!amt || isCfo) return null;

  if (!needsCfoApproval(doctype, amt)) return null;

  const limit = approvalLimit(doctype);
  return (
    <p className="pm-field-hint finance-page-header__note finance-page-header__note--warning finance-approval-notice">
      Amount {fmt(amt)} exceeds the Finance Manager limit ({fmt(limit)}).
      {hint || " The document will be saved as Draft for CFO approval."}
    </p>
  );
}
