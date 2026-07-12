function formatValue(value) {
  if (value == null || value === "") return "—";
  return String(value);
}

function fieldLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SKIP_BODY_FIELDS = new Set([
  "name",
  "docstatus",
  "company",
  "posting_date",
  "due_date",
  "transaction_date",
  "document_kind",
  "status",
  "imported",
]);

const MAX_CHANGE_LINES = 3;

function buildChangeLines(oldValues, newValues) {
  const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
    .filter((key) => !SKIP_BODY_FIELDS.has(key))
    .sort();

  return keys
    .map((key) => {
      const oldVal = formatValue(oldValues[key]);
      const newVal = formatValue(newValues[key]);
      if (oldVal === newVal) return null;
      return `${fieldLabel(key)} changed from ${oldVal} to ${newVal}.`;
    })
    .filter(Boolean)
    .slice(0, MAX_CHANGE_LINES);
}

/** Human-readable activity body from audit row (PM-style short text). */
export function buildAuditBody(row) {
  const action = (row?.action || "").trim();
  const remarks = (row?.remarks || "").trim();
  const oldValues = row?.old_values || {};
  const newValues = row?.new_values || {};

  if (action === "Create") {
    if (remarks) return remarks;
    const docType = row?.document_type || "Document";
    const docName = newValues.name || row?.document_id || "";
    return docName ? `${docType} ${docName} created.` : `${docType} created.`;
  }

  if (remarks) return remarks;

  const hasOldValues = Object.keys(oldValues).length > 0;
  if (hasOldValues) {
    const changeLines = buildChangeLines(oldValues, newValues);
    if (changeLines.length) return changeLines.join(" ");
  }

  return "No details recorded.";
}
