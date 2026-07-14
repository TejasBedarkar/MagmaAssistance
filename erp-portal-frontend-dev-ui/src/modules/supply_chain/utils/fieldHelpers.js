/** Normalize API field names for SCM list/detail views. */

export function productType(row) {
  return row?.item_type || row?.custom_item_type || "";
}

export function mrSourceLabel(row) {
  const dt = row?.source_doctype || row?.custom_source_doctype || "";
  const nm = row?.source_name || row?.custom_source_name || "";
  if (!dt && !nm) return "Manual";
  return `${dt} ${nm}`.trim();
}

export function bomFormFromDetail(detail) {
  if (!detail) return null;
  return {
    quantity: detail.quantity ?? 1,
    is_active: detail.is_active ? 1 : 0,
    is_default: detail.is_default ? 1 : 0,
    items: (detail.items || []).map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name || line.item_code,
      qty: line.qty ?? 1,
      uom: line.uom || "Nos",
      rate: line.rate ?? 0,
      consume_at_operation: line.consume_at_operation || "",
    })),
  };
}

export function productFormFromDetail(detail) {
  if (!detail) return null;
  return {
    item_name: detail.item_name || "",
    item_type: productType(detail) || "RM",
    stock_uom: detail.stock_uom || "Nos",
    item_group: detail.item_group || "Products",
  };
}
