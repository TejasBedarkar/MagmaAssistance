export function fmtInr(n) {
  return `₹ ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

export function sumField(rows, field) {
  return rows.reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

export function distinctCount(rows, field) {
  return new Set(rows.map((r) => r[field]).filter(Boolean)).size;
}
