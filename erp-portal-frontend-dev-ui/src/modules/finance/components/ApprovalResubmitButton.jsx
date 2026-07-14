import { useState } from "react";
import { HiOutlineArrowPath } from "react-icons/hi2";
import { callMethod } from "../../../common/api/client.js";
import ActionIconTip from "../../../common/components/ActionIconTip.jsx";

export default function ApprovalResubmitButton({ doctype, name, onSuccess, showToast }) {
  const [loading, setLoading] = useState(false);
  const label = loading ? "Resubmitting…" : "Resubmit for approval";

  const handleResubmit = async () => {
    if (!doctype || !name || loading) return;
    setLoading(true);
    try {
      const msg = await callMethod("finance_app.api.approvals.resubmit_for_approval", {
        doctype,
        name,
      });
      if (msg?.status === "success") {
        const text = msg.message || "Resubmitted for CFO approval.";
        if (showToast) {
          showToast({ type: "success", text });
        } else {
          window.alert(text);
        }
        onSuccess?.();
        return;
      }
      const errText = msg?.message || "Resubmit failed.";
      if (showToast) {
        showToast({ type: "error", text: errText });
      } else {
        window.alert(errText);
      }
    } catch (err) {
      const errText = err?.response?.data?.message || err?.message || "Resubmit failed.";
      if (showToast) {
        showToast({ type: "error", text: errText });
      } else {
        window.alert(errText);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ActionIconTip label={label}>
      <button
        type="button"
        className="finance-approval-act finance-approval-act--resubmit"
        onClick={handleResubmit}
        disabled={loading}
        aria-label={label}
      >
        <HiOutlineArrowPath
          size={14}
          aria-hidden
          className={loading ? "finance-approval-act__spin" : undefined}
        />
      </button>
    </ActionIconTip>
  );
}
