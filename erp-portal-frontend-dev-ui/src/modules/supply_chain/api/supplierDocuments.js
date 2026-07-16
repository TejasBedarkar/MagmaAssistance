import { scCall, scCallGet } from "./scCall.js";

const DOC_METHOD = "supply_chain_app.api.supplier_documents";
const SUP_METHOD = "supply_chain_app.api.suppliers";

export async function listSupplierDocuments(supplier, params = {}) {
  const data = await scCallGet(`${DOC_METHOD}.list_supplier_documents`, { supplier, ...params }, { silent: true });
  return data?.documents || [];
}

export async function uploadSupplierDocument(payload) {
  return scCall(`${DOC_METHOD}.upload_supplier_document`, payload);
}

export async function getSupplierComplianceStatus(supplier) {
  return scCallGet(`${DOC_METHOD}.get_supplier_compliance_status`, { supplier }, { silent: true });
}

export async function getSupplierPerformanceHistory(supplierId) {
  return scCallGet(`${SUP_METHOD}.get_supplier_performance_history`, { supplier_id: supplierId }, { silent: true });
}

export async function getSupplierMaterialAssociation(supplierId) {
  return scCallGet(`${SUP_METHOD}.get_supplier_material_association`, { supplier_id: supplierId }, { silent: true });
}

export async function recommendVendorsForItem(itemCode, qty = 0, limit = 5) {
  return scCallGet(
    `${SUP_METHOD}.recommend_vendors_for_item_api`,
    { item_code: itemCode, qty, limit },
    { silent: true },
  );
}
