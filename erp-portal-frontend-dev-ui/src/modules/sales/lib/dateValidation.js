/** Local calendar date as YYYY-MM-DD (no UTC shift). */
export function salesToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isFutureDate(value) {
  if (!value) return false;
  return String(value).slice(0, 10) > salesToday();
}

/** Reject future dates — returns empty string if future, else the value. */
export function rejectFutureDate(value) {
  if (!value) return "";
  const date = String(value).slice(0, 10);
  return isFutureDate(date) ? "" : date;
}

/** For filter ranges: cap at today and keep to >= from when both set. */
export function applyPastFromDate(value, currentTo = "") {
  const from = rejectFutureDate(value);
  if (!from) return { from: "", to: currentTo };
  if (currentTo && currentTo < from) return { from, to: from };
  return { from, to: currentTo };
}

export function applyPastToDate(value, currentFrom = "") {
  let to = rejectFutureDate(value);
  if (!to) return "";
  if (currentFrom && to < currentFrom) to = currentFrom;
  return to;
}
