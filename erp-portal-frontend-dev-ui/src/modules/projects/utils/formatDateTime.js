/** Locale date only (no time) for read-only created date fields. */
export function formatDateOnly(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

/** Locale date/time for portal tables and forms. */
export function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

/** Completion timestamp for list rows (falls back to modified). */
export function formatTaskCompletedOn(row) {
  if (row?.status !== "Completed") return "—";
  const value = row.completed_on || row.modified;
  return formatDateTime(value);
}
