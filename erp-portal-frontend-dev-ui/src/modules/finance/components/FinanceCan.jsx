import React from "react";
import { useFinanceRole } from "../hooks/useFinanceRole.js";

/**
 * Renders children only when the current finance role allows the action.
 * @param {string} action — e.g. canCreate, canEdit, canSubmit, canApprove, canDelete
 */
export default function FinanceCan({ action, children, fallback = null }) {
  const { can } = useFinanceRole();
  if (!can(action)) return fallback;
  return children;
}
