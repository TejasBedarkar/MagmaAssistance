import { scCall, scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.rfq";

export async function listRfqs(params = {}) {
  const data = await scCallGet(`${METHOD}.list_rfqs`, params, { silent: true });
  return data?.rfqs || [];
}

export async function getRfq(name) {
  return scCallGet(`${METHOD}.get_rfq`, { name }, { silent: true });
}

export async function createRfqFromMaterialRequest(payload) {
  return scCall(`${METHOD}.create_rfq_from_material_request`, {
    ...payload,
    suppliers: payload.suppliers ? JSON.stringify(payload.suppliers) : undefined,
  });
}

export async function submitRfq(rfqName) {
  return scCall(`${METHOD}.submit_rfq`, { rfq_name: rfqName });
}

export async function compareQuotations(rfqName, includeExpired = 0) {
  return scCallGet(`${METHOD}.compare_quotations`, {
    rfq_name: rfqName,
    include_expired: includeExpired,
  });
}

export async function awardSupplierQuotation(supplierQuotation, submitPo = 1) {
  return scCall(`${METHOD}.award_supplier_quotation`, {
    supplier_quotation: supplierQuotation,
    submit_po: submitPo,
  });
}

export async function createSupplierQuotationFromRfq(rfqName, supplier, submitDoc = 0) {
  return scCall(`${METHOD}.create_supplier_quotation_from_rfq`, {
    rfq_name: rfqName,
    supplier,
    submit_doc: submitDoc,
  });
}
