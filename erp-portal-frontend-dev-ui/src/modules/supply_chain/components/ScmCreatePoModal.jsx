import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getSupplierComplianceStatus } from "../api/supplierDocuments.js";
import { createPurchaseOrder, getPurchaseOrderFormOptions } from "../api/purchaseOrders.js";
import { recommendVendorsForMaterialRequest } from "../api/suppliers.js";
import ScmModal from "./ScmModal.jsx";

const EMPTY_PO = {
  supplier: "",
  set_warehouse: "",
  taxes_template: "",
};

/** Keep qty/rate as strings while editing so leading zeros (e.g. 09000) never appear. */
function formatLineNumberInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return String(n);
}

function parseLineNumber(value) {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function pickRecommendedSupplier(supplierNames, recommendationPayload) {
  const names = new Set(supplierNames || []);
  const ranked = [];
  for (const line of recommendationPayload?.lines || []) {
    for (const rec of line.recommendations || []) {
      const supplier = rec.supplier || rec.name;
      if (supplier && names.has(supplier) && !ranked.includes(supplier)) {
        ranked.push(supplier);
      }
    }
  }
  return ranked[0] || "";
}

/** Create a purchase order from an open material request. */
export default function ScmCreatePoModal({ open, materialRequest, onClose, onCreated }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_PO);
  const [opts, setOpts] = useState({ suppliers: [], items: [], warehouses: [], tax_templates: [] });
  const [lines, setLines] = useState([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compliance, setCompliance] = useState(null);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [vendorHint, setVendorHint] = useState("");

  useEffect(() => {
    if (!open || !materialRequest) return;
    setCompliance(null);
    setVendorHint("");
    setLoadingOpts(true);
    Promise.all([
      getPurchaseOrderFormOptions(),
      recommendVendorsForMaterialRequest(materialRequest.name).catch(() => null),
    ])
      .then(([data, recommendations]) => {
        setOpts(data);
        const suggested = pickRecommendedSupplier(
          (data.suppliers || []).map((s) => s.name),
          recommendations,
        );
        setForm({
          supplier: suggested,
          set_warehouse: data.default_warehouse || "",
          taxes_template: "",
        });
        if (suggested) {
          setVendorHint(`Suggested supplier: ${suggested}`);
        } else if (!(data.suppliers || []).length) {
          setVendorHint("No suppliers found. Add a supplier in Supply Chain first.");
        } else {
          setVendorHint("Select a supplier to continue.");
        }
        const rateByItem = Object.fromEntries(
          (data.items || []).map((i) => [i.name, Number(i.standard_rate) || 0]),
        );
        setLines(
          (materialRequest.items || []).map((row) => ({
            item_code: row.item_code,
            qty: formatLineNumberInput(Number(row.qty) || 1) || "1",
            rate: formatLineNumberInput(rateByItem[row.item_code]),
          })),
        );
      })
      .catch(() => toast.error("Could not load PO form options."))
      .finally(() => setLoadingOpts(false));
  }, [open, materialRequest]);

  useEffect(() => {
    if (!open || !form.supplier) {
      setCompliance(null);
      return;
    }
    setLoadingCompliance(true);
    getSupplierComplianceStatus(form.supplier)
      .then(setCompliance)
      .catch(() => setCompliance(null))
      .finally(() => setLoadingCompliance(false));
  }, [open, form.supplier]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!materialRequest?.name) {
      toast.error("Material request is not loaded.");
      return;
    }
    if (!form.supplier) {
      toast.error("Please select a supplier.");
      return;
    }
    if (loadingCompliance) {
      toast.error("Checking supplier compliance…");
      return;
    }
    if (compliance && !compliance.compliant) {
      toast.error(
        `Supplier is not compliant. Upload GST and PAN under Suppliers. Missing: ${(compliance.missing || []).join(", ") || "GST, PAN"}`,
      );
      return;
    }
    const poItems = lines.map((line) => ({
      item_code: line.item_code,
      qty: parseLineNumber(line.qty),
      rate: parseLineNumber(line.rate),
    }));
    if (!poItems.length) {
      toast.error("No line items on this material request.");
      return;
    }
    if (poItems.some((line) => line.qty <= 0)) {
      toast.error("Each line must have a quantity greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const result = await createPurchaseOrder({
        supplier: form.supplier,
        material_request: materialRequest.name,
        set_warehouse: form.set_warehouse || undefined,
        taxes_template: form.taxes_template || undefined,
        items: poItems,
        submit_doc: 1,
      });
      toast.success(`Purchase order ${result.name || ""} created.`);
      onCreated?.(result);
      onClose?.();
      if (result.name) {
        navigate(`/supply-chain/purchase-orders?po=${encodeURIComponent(result.name)}`);
      }
    } catch (err) {
      toast.error(err?.message || "Could not create purchase order.");
    } finally {
      setSaving(false);
    }
  };

  const noSuppliers = !loadingOpts && !(opts.suppliers || []).length;

  return (
    <ScmModal
      open={open}
      title="Create purchase order"
      subtitle={materialRequest ? `From MR ${materialRequest.name}` : "Loading…"}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="scm-btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="scm-btn-primary"
            disabled={saving || loadingOpts}
            onClick={submit}
          >
            {saving ? "Creating…" : "Create PO"}
          </button>
        </>
      }
    >
      {loadingOpts ? (
        <p className="scm-modal-loading">Loading suppliers and items…</p>
      ) : (
        <form id="scm-create-po-form" onSubmit={submit}>
          {noSuppliers ? (
            <div className="scm-error-banner" style={{ marginBottom: "1rem" }}>
              No suppliers are set up yet.{" "}
              <Link to="/supply-chain/suppliers" className="scm-link-btn--sm">
                Add supplier
              </Link>{" "}
              before creating a PO.
            </div>
          ) : null}
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">Supplier *</span>
              <select
                className="scm-input"
                value={form.supplier}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                required
              >
                <option value="">Select supplier…</option>
                {(opts.suppliers || []).map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.supplier_name || s.name}
                  </option>
                ))}
              </select>
              {vendorHint ? (
                <span className="scm-form-hint">{vendorHint}</span>
              ) : null}
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Warehouse</span>
              <select
                className="scm-input"
                value={form.set_warehouse}
                onChange={(e) => setForm((f) => ({ ...f, set_warehouse: e.target.value }))}
              >
                <option value="">Default</option>
                {(opts.warehouses || []).map((w) => (
                  <option key={w.name} value={w.name}>{w.name}</option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Tax template</span>
              <select
                className="scm-input"
                value={form.taxes_template}
                onChange={(e) => setForm((f) => ({ ...f, taxes_template: e.target.value }))}
              >
                <option value="">None</option>
                {(opts.tax_templates || []).map((t) => (
                  <option key={t.name} value={t.name}>{t.title || t.name}</option>
                ))}
              </select>
            </label>
          </div>
          {form.supplier && compliance && !compliance.compliant ? (
            <div className="scm-error-banner" style={{ marginTop: "1rem" }}>
              This supplier cannot be used for POs yet. Upload active{" "}
              <strong>GST</strong> and <strong>PAN</strong> in{" "}
              <Link to="/supply-chain/suppliers" className="scm-link-btn--sm">
                Suppliers
              </Link>
              . Missing: {(compliance.missing || []).join(", ") || "GST, PAN"}
              {(compliance.expired || []).length
                ? ` · Expired: ${compliance.expired.join(", ")}`
                : ""}
            </div>
          ) : null}
          <div className="scm-table-scroll" style={{ marginTop: "1rem" }}>
            <table className="scm-table">
              <thead>
                <tr className="scm-table__row">
                  {["Item", "Qty", "Rate"].map((h) => (
                    <th key={h} className="scm-table__head">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.item_code} className="scm-table__row">
                    <td className="scm-table__cell scm-table__cell--strong">{line.item_code}</td>
                    <td className="scm-table__cell">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="scm-input"
                        value={line.qty}
                        onChange={(e) =>
                          setLines((rows) =>
                            rows.map((r) =>
                              r.item_code === line.item_code
                                ? { ...r, qty: e.target.value }
                                : r,
                            ),
                          )
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                    <td className="scm-table__cell">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="scm-input"
                        placeholder="0"
                        value={line.rate}
                        onChange={(e) =>
                          setLines((rows) =>
                            rows.map((r) =>
                              r.item_code === line.item_code
                                ? { ...r, rate: e.target.value }
                                : r,
                            ),
                          )
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </ScmModal>
  );
}
