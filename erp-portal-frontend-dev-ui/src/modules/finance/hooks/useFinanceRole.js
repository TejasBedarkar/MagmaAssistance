import { useMemo } from "react";
import { useAuth } from "../../../common/context/AuthContext.jsx";
import {
  allowedActionsByRole,
  APPROVAL_LIMITS_INR,
  approvalLimitForRole,
  canApproveAmount as canApproveAmountForRole,
  FINANCE_ROLE,
  hasFinancePortalAccess,
  isFullFinanceAccessRole,
  needsCfoApproval as needsCfoApprovalForRole,
  resolveFinanceRole,
} from "../lib/roles.js";

/**
 * Finance RBAC for portal pages — role, action flags, and helpers.
 */
export function useFinanceRole() {
  const { roles, user } = useAuth();

  const financeRole = useMemo(() => resolveFinanceRole(roles, user), [roles, user]);
  const actions = useMemo(() => allowedActionsByRole(financeRole), [financeRole]);

  return {
    financeRole,
    actions,
    user,
    hasFinanceAccess: hasFinancePortalAccess(roles, user),
    isFullAccess: isFullFinanceAccessRole(financeRole),
    isFinanceManager: financeRole === FINANCE_ROLE.FINANCE_MANAGER,
    isCfo: financeRole === FINANCE_ROLE.CFO,
    isAuditor: financeRole === FINANCE_ROLE.AUDITOR,
    can: (action) => Boolean(actions?.[action]),
    approvalLimits: APPROVAL_LIMITS_INR,
    approvalLimit: (doctype) => approvalLimitForRole(financeRole, doctype),
    canApproveAmount: (doctype, amount) => canApproveAmountForRole(financeRole, doctype, amount),
    needsCfoApproval: (doctype, amount) => needsCfoApprovalForRole(financeRole, doctype, amount),
  };
}
