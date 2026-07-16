import { callMethodGet } from "../../../common/api/client.js";
import { toMethodGetUrl } from "./methodUrl.js";

const BASE = "finance_app.api.audit_log";

export async function fetchDocumentAuditHistory(doctype, name, limit = 50) {
  return callMethodGet(
    toMethodGetUrl(`${BASE}.get_document_audit_history`, { doctype, name, limit })
  );
}

export async function exportDocumentAuditHistoryCsv(doctype, name) {
  return callMethodGet(
    toMethodGetUrl(`${BASE}.export_document_audit_history_csv`, { doctype, name })
  );
}
