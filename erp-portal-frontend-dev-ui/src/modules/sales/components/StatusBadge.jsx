import { StatusPill } from "../../../common/components/StatusPill.jsx";

/** Map sales document statuses to portal StatusPill tones. */
export function salesStatusTone(status) {
  const key = String(status || "").toLowerCase();
  const success = new Set([
    "paid",
    "delivered",
    "approved",
    "completed",
    "fully delivered",
    "fully billed",
    "ordered",
  ]);
  const danger = new Set([
    "overdue",
    "rejected",
    "cancelled",
    "delayed shipment",
    "not delivered",
    "not billed",
    "expired",
  ]);
  const warn = new Set([
    "delayed",
    "pending",
    "pending dispatch",
    "to deliver",
    "to deliver and bill",
    "unpaid",
    "on hold",
  ]);
  const info = new Set(["open", "draft", "in transit", "to bill", "submitted", "partly paid"]);

  if (success.has(key)) return "success";
  if (danger.has(key)) return "danger";
  if (warn.has(key)) return "warn";
  if (info.has(key)) return "info";
  if (key === "return") return "default";
  return "default";
}

export default function StatusBadge({ status, className = "" }) {
  const label = String(status || "").trim();
  if (!label) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className}>
      <StatusPill tone={salesStatusTone(label)}>{label}</StatusPill>
    </span>
  );
}
