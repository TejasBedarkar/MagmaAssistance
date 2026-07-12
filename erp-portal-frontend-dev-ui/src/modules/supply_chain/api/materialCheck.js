import { scCallGet } from "./scCall.js";

const METHOD = "supply_chain_app.api.integration";

/** Section 3.0: BOM + plant + rack material check for Sales quotation. */
export async function getQuotationMaterialCheck(items, fulfilmentPlant, quotationName) {
  return scCallGet(
    `${METHOD}.get_quotation_material_check_for_sales`,
    {
      items: items ? JSON.stringify(items) : undefined,
      fulfilment_plant: fulfilmentPlant || undefined,
      quotation_name: quotationName || undefined,
    },
    { silent: true },
  );
}
