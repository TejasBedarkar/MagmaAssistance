/** Utility helpers for formatting values across the app. */

export const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const fmtDateTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const fmtDuration = (seconds) => {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

export const fmtNumber = (n, decimals = 0) => {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const fmtPct = (n) => {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
};

export const fmtCurrency = (n, currency = 'INR') => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n));
};

/**
 * Pick a Tailwind badge variant for a status string.
 */
export const statusBadge = (status) => {
  if (!status) return 'badge-gray';
  const s = status.toLowerCase();
  if (['draft', 'pending', 'scheduled'].includes(s)) return 'badge-gray';
  if (['in progress', 'in transit', 'requested', 'shortage', 'packing pending'].includes(s))
    return 'badge-amber';
  if (['paused', 'on hold', 'packed', 'logistics booked', 'dispatch note created'].includes(s))
    return 'badge-amber';
  if (['fail', 'failed', 'rejected', 'cancelled'].includes(s)) return 'badge-red';
  if (['pass', 'passed', 'completed', 'delivered', 'available', 'ready', 'received', 'pod received'].includes(s))
    return 'badge-green';
  if (['closed', 'approved', 'dispatched'].includes(s)) return 'badge-purple';
  return 'badge-blue';
};

export const priorityBadge = (p) => {
  if (!p) return 'badge-gray';
  const s = p.toLowerCase();
  if (s === 'critical' || s === 'urgent') return 'badge-red';
  if (s === 'high') return 'badge-amber';
  if (s === 'medium') return 'badge-blue';
  return 'badge-gray';
};
