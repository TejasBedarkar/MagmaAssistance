import { StatusPill } from "../../../common/components/StatusPill.jsx";

export function statusTone(status) {
  if (!status) return "default";
  const s = String(status).toLowerCase();
  if (s === "inactive") return "danger";
  if (s === "active") return "success";
  if (["completed", "delivered", "pass", "passed", "available", "ready", "received", "pod received", "closed", "approved", "confirmed"].some((x) => s.includes(x))) {
    return "success";
  }
  if (["fail", "failed", "rejected", "cancelled", "overdue", "conflict"].some((x) => s.includes(x))) {
    return "danger";
  }
  if (["in progress", "pending", "paused", "shortage", "packing", "scheduled", "draft", "open"].some((x) => s.includes(x))) {
    return "warn";
  }
  if (s.includes("under maintenance") || s.includes("maintenance")) {
    return "danger";
  }
  if (["dispatched", "in transit", "review", "scheduled", "planned", "released"].some((x) => s.includes(x))) {
    return "info";
  }
  return "default";
}

function priorityTone(priority) {
  if (!priority) return "default";
  const s = String(priority).toLowerCase();
  if (s === "urgent" || s === "critical") return "danger";
  if (s === "high") return "warn";
  return "info";
}

export function StatusBadge({ status, className = "" }) {
  return (
    <span className={className}>
      <StatusPill tone={statusTone(status)}>{status || "—"}</StatusPill>
    </span>
  );
}

export function PriorityBadge({ priority, className = "" }) {
  return (
    <span className={className}>
      <StatusPill tone={priorityTone(priority)}>{priority || "—"}</StatusPill>
    </span>
  );
}

function maintenanceTypeTone(type) {
  const s = String(type || "Breakdown").toLowerCase();
  if (s === "preventive") return "info";
  return "danger";
}

export function MaintenanceTypeBadge({ type, className = "" }) {
  const label = type === "Preventive" ? "Preventive" : "Breakdown";
  return (
    <span className={className}>
      <StatusPill tone={maintenanceTypeTone(label)}>{label}</StatusPill>
    </span>
  );
}
