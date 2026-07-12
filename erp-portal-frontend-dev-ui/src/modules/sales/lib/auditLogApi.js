import api, { toMethodGetUrl } from "./apiUtils";

const BASE = "sales_app.api.audit_log";

export async function fetchAuditLogs(params = {}) {
  const res = await api.get(`/api/method/${toMethodGetUrl(`${BASE}.get_audit_logs`, params)}`);
  return res?.data?.message || { rows: [], total: 0 };
}

export async function fetchAuditLogStats(params = {}) {
  const res = await api.get(`/api/method/${toMethodGetUrl(`${BASE}.get_audit_log_stats`, params)}`);
  return res?.data?.message || {};
}

export async function fetchAuditLogDetail(logId) {
  const res = await api.get(`/api/method/${toMethodGetUrl(`${BASE}.get_audit_log_detail`, { log_id: logId })}`);
  return res?.data?.message || null;
}

export async function fetchAuditLogFilterOptions() {
  const res = await api.get(`/api/method/${BASE}.get_audit_log_filter_options`);
  return res?.data?.message || {};
}

export async function exportAuditLogsCsv(params = {}) {
  const res = await api.get(`/api/method/${toMethodGetUrl(`${BASE}.export_audit_logs_csv`, params)}`);
  return res?.data?.message || {};
}
