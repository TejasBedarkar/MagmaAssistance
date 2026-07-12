import { HiOutlineEye } from "react-icons/hi2";
import ActionIconTip from "../../../common/components/ActionIconTip.jsx";

/** Decorative view icon for finance data tables (row click opens detail). */
export default function FinanceViewAction({ label = "View details" }) {
  return (
    <ActionIconTip label={label}>
      <span className="finance-view-act" aria-hidden>
        <HiOutlineEye size={14} />
      </span>
    </ActionIconTip>
  );
}

/** Standard trailing view column for FinanceDataTable. */
export function financeViewTableColumn(overrides = {}) {
  return {
    key: "action",
    label: "Actions",
    align: "right",
    cellClassName: "finance-view-action-cell",
    render: () => <FinanceViewAction />,
    ...overrides,
  };
}
