import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ban, Box, ExternalLink, Package, PackagePlus, SearchCheck } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import useScmDocDeepLink from "../hooks/useScmDocDeepLink.js";
import { createProduct, disableProduct, getProduct, listProducts, updateProduct } from "../api/products.js";
import {
  getOpportunityVerificationForScm,
  listSalesOpportunityVerifications,
  verifyItemForSales,
} from "../api/integration.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { productFormFromDetail, productType } from "../utils/fieldHelpers.js";
import { countWhere } from "../utils/scmPageHelpers.js";

const ITEM_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "RM", label: "Raw Material" },
  { value: "FG", label: "Finished Good" },
];

const EMPTY_FORM = { item_code: "", item_name: "", item_type: "RM", stock_uom: "Nos" };

function fmtCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function SalesOpportunityVerifyPanel({ rows, loading, error, highlightOpp, onVerify, verifyingCode }) {
  return (
    <ScmPanel
      title="Sales — Product verification (Phase A)"
      subtitle="Supply Chain Item Master checks for Sales opportunities before quotation"
    >
      <p className="scm-page-hint">
        Verify whether requested products exist in Item Master. Sales is notified when items are created or updated here.
      </p>
      {error ? <div className="scm-error-banner">{error}</div> : null}
      {loading ? (
        <p className="scm-page-hint">Loading Sales opportunities…</p>
      ) : !rows.length ? (
        <p className="scm-page-hint">No open Sales opportunities with a product code to verify.</p>
      ) : (
        <div className="scm-table-wrap">
          <table className="scm-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Item Master</th>
                <th>UOM</th>
                <th>Warehouse</th>
                <th>Cost</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const v = row.verification || {};
                const exists = Boolean(row.item_exists || v.item_exists);
                const isHighlight = highlightOpp && highlightOpp === row.opportunity;
                return (
                  <tr
                    key={row.opportunity || row.product_code}
                    className={isHighlight ? "scm-table__row--active" : undefined}
                  >
                    <td className="scm-table__cell--strong">{row.opportunity || "—"}</td>
                    <td>{row.party_name || "—"}</td>
                    <td className="scm-table__cell--link">{row.product_code || "—"}</td>
                    <td>
                      <ScmStatusBadge status={exists ? "OK" : "Shortage"} />
                    </td>
                    <td>{v.uom || "—"}</td>
                    <td>{v.warehouse || "—"}</td>
                    <td>{fmtCost(v.standard_cost)}</td>
                    <td className="scm-table__actions">
                      <button
                        type="button"
                        className="scm-btn-ghost scm-btn-compact"
                        disabled={verifyingCode === row.product_code}
                        onClick={() => onVerify(row)}
                      >
                        {verifyingCode === row.product_code ? "Verifying…" : "Verify"}
                      </button>
                      {row.sales_portal_url ? (
                        <a
                          href={row.sales_portal_url}
                          className="scm-link-btn scm-link-btn--sm"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sales <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ScmPanel>
  );
}

export default function ProductsPage() {
  const [searchParams] = useSearchParams();
  const highlightOpp = searchParams.get("opp") || "";
  const [oppSearch, setOppSearch] = useState("");
  const debouncedOppSearch = useDebouncedValue(oppSearch);
  const [verifyingCode, setVerifyingCode] = useState("");
  const [verifyDetail, setVerifyDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listProducts({ search: debouncedSearch || undefined, item_type: itemType || undefined, limit: 200 }),
    [debouncedSearch, itemType],
  );

  const {
    rows: oppVerifyRows,
    loading: oppVerifyLoading,
    error: oppVerifyError,
    reload: reloadOppVerify,
  } = useScmList(
    () => listSalesOpportunityVerifications(debouncedOppSearch || undefined, 50),
    [debouncedOppSearch],
  );

  const reloadAll = useCallback(() => {
    reload();
    reloadOppVerify();
  }, [reload, reloadOppVerify]);

  useEffect(() => {
    if (!highlightOpp || oppVerifyLoading) return;
    const row = oppVerifyRows.find((r) => r.opportunity === highlightOpp);
    if (row?.product_code) {
      setVerifyDetail(row);
    }
  }, [highlightOpp, oppVerifyRows, oppVerifyLoading]);

  const handleVerifyOpportunity = useCallback(async (row) => {
    const code = row?.product_code;
    if (!code) return;
    setVerifyingCode(code);
    try {
      const detail = row.opportunity
        ? await getOpportunityVerificationForScm(row.opportunity, code)
        : await verifyItemForSales(code);
      setVerifyDetail(detail);
      const exists = Boolean(detail?.item_exists || detail?.verification?.item_exists);
      toast.success(
        exists
          ? `${code} verified in Item Master — Sales opportunities updated.`
          : `${code} not found in Item Master.`,
      );
      reloadOppVerify();
    } catch (err) {
      toast.error(err?.message || "Verification failed.");
    } finally {
      setVerifyingCode("");
    }
  }, [reloadOppVerify]);

  const filtered = useMemo(() => rows, [rows]);
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      rm: countWhere(rows, (r) => productType(r) === "RM"),
      fg: countWhere(rows, (r) => productType(r) === "FG"),
      disabled: countWhere(rows, (r) => r.disabled),
    }),
    [rows],
  );

  const closeModal = useCallback(() => {
    setDetail(null);
    setForm(null);
    setSelected(null);
    setEditMode(false);
    setLoadingDetail(false);
  }, []);

  const openRow = useCallback(async (row) => {
    const code = row.item_code || row.name;
    setSelected(code);
    setDetail(null);
    setForm(null);
    setEditMode(false);
    setLoadingDetail(true);
    try {
      const data = await getProduct(code);
      setDetail(data);
      setForm(productFormFromDetail(data));
    } catch {
      toast.error("Could not load product.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useScmDocDeepLink("item", rows, openRow);

  const closeCreateModal = useCallback(() => {
    setShowForm(false);
    setCreateForm(EMPTY_FORM);
  }, []);

  const submitCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createProduct(createForm);
      toast.success(`Product ${createForm.item_code} created.`);
      setShowForm(false);
      setCreateForm(EMPTY_FORM);
      reload();
      reloadOppVerify();
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async () => {
    if (!detail?.item_code || !form) return;
    setSaving(true);
    try {
      const updatedProduct = await updateProduct(detail.item_code, form);
      setDetail(updatedProduct);
      setForm(productFormFromDetail(updatedProduct));
      setEditMode(false);
      toast.success("Product updated.");
      reload();
      reloadOppVerify();
    } catch (err) {
      toast.error(err?.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const disableItem = async () => {
    if (!detail?.item_code || detail.disabled) return;
    setSaving(true);
    try {
      const updatedProduct = await disableProduct(detail.item_code, "Disabled from SCM portal");
      setDetail(updatedProduct);
      setForm(productFormFromDetail(updatedProduct));
      toast.success("Product disabled.");
      reload();
      reloadOppVerify();
    } catch (err) {
      toast.error(err?.message || "Disable failed.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: "item_code", header: "Code", className: "scm-table__cell--link" },
    { key: "item_name", header: "Name", className: "scm-table__cell--strong" },
    {
      key: "item_type",
      header: "Type",
      render: (r) => {
        const t = productType(r);
        return t ? <ScmStatusBadge status={t} /> : "—";
      },
    },
    { key: "item_group", header: "Group" },
    { key: "stock_uom", header: "UOM" },
  ];

  return (
    <div className="scm-page scm-products-page">
      <ScmPageHeader
        title="Products"
        subtitle="Raw materials and finished goods (Item master)"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/bom", label: "BOM" },
                { to: "/supply-chain/inventory", label: "Stock" },
                { to: "/supply-chain/mrp", label: "MRP" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reloadAll} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <ScmPageKpiGrid>
        <ScmKpiCard label="Total products" value={kpis.total} sub="Item master records" icon={<Package size={16} />} />
        <ScmKpiCard label="Raw materials" value={kpis.rm} sub="RM items" icon={<Box size={16} />} />
        <ScmKpiCard label="Finished goods" value={kpis.fg} sub="FG items" icon={<PackagePlus size={16} />} />
        <ScmKpiCard
          label="Disabled"
          value={kpis.disabled}
          sub="Inactive items"
          tone={kpis.disabled ? "warn" : "default"}
          icon={<Ban size={16} />}
        />
      </ScmPageKpiGrid>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <SalesOpportunityVerifyPanel
        rows={oppVerifyRows}
        loading={oppVerifyLoading}
        error={oppVerifyError}
        highlightOpp={highlightOpp}
        onVerify={handleVerifyOpportunity}
        verifyingCode={verifyingCode}
      />

      <ScmListFilters
        search={oppSearch}
        onSearchChange={setOppSearch}
        searchPlaceholder="Filter Sales opportunities by code, customer, product…"
      />

      {verifyDetail ? (
        <ScmPanel
          title="Verification result"
          subtitle={verifyDetail.product_code || verifyDetail.opportunity || "Item Master"}
          action={
            <button type="button" className="scm-btn-ghost scm-btn-compact" onClick={() => setVerifyDetail(null)}>
              Dismiss
            </button>
          }
        >
          <div className="scm-detail-grid">
            <ScmDetailField label="Opportunity" value={verifyDetail.opportunity || "—"} />
            <ScmDetailField
              label="Item Master"
              value={verifyDetail.item_exists || verifyDetail.verification?.item_exists ? "Found" : "Not found"}
            />
            <ScmDetailField label="Item code" value={verifyDetail.verification?.item_code || verifyDetail.product_code} />
            <ScmDetailField label="UOM" value={verifyDetail.verification?.uom} />
            <ScmDetailField label="HSN" value={verifyDetail.verification?.hsn} />
            <ScmDetailField label="Warehouse" value={verifyDetail.verification?.warehouse} />
            <ScmDetailField label="Standard cost" value={fmtCost(verifyDetail.verification?.standard_cost)} />
            <ScmDetailField
              label="Status"
              value={verifyDetail.verification?.active_status || (verifyDetail.verification?.active ? "Active" : "—")}
            />
          </div>
          {verifyDetail.sales_portal_url ? (
            <p className="scm-page-hint">
              <a href={verifyDetail.sales_portal_url} className="scm-link-btn" target="_blank" rel="noreferrer">
                Open in Sales <SearchCheck size={14} />
              </a>
            </p>
          ) : null}
        </ScmPanel>
      ) : null}

      <ScmPanel
        title="Product catalog"
        subtitle="Create and maintain RM/FG items for BOM and procurement"
        action={
          <button type="button" className="scm-btn-primary" onClick={() => setShowForm(true)}>
            New product
          </button>
        }
      >
        <p className="scm-page-hint">
          Item codes should start with RM or FG.{" "}
          <Link to="/supply-chain/bom" className="scm-link-btn--sm">
            Manage BOMs
          </Link>
        </p>
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetPage(); }}
        searchPlaceholder="Search by code or name…"
        selectLabel="Item type"
        selectValue={itemType}
        selectOptions={ITEM_TYPE_OPTIONS}
        onSelectChange={(v) => { setItemType(v); resetPage(); }}
      />

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Package}
        emptyTitle="No products"
        emptyDescription="Create RM/FG items to use in BOM and procurement."
        getRowKey={(r) => r.item_code || r.name}
        activeKey={selected}
        onRowClick={openRow}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={25}
        onPageChange={setPage}
      />

      <ScmModal
        open={Boolean(selected)}
        title={detail?.item_name || selected || "Product"}
        subtitle={detail?.item_code || selected}
        onClose={closeModal}
        footer={
          loadingDetail ? null : editMode ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={() => setEditMode(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="scm-btn-primary" onClick={saveProduct} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              {!detail?.disabled ? (
                <button type="button" className="scm-btn-ghost" onClick={disableItem} disabled={saving}>
                  Disable
                </button>
              ) : null}
              <button type="button" className="scm-btn-primary" onClick={() => setEditMode(true)} disabled={!detail || detail.disabled}>
                Edit
              </button>
            </>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading product…</p>
        ) : detail && form ? (
          <div className="scm-detail-grid">
            {editMode ? (
              <>
                <label className="scm-form-field">
                  <span className="scm-form-label">Name</span>
                  <input
                    className="scm-input"
                    value={form.item_name}
                    onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                  />
                </label>
                <label className="scm-form-field">
                  <span className="scm-form-label">Type</span>
                  <select
                    className="scm-input"
                    value={form.item_type}
                    onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value }))}
                  >
                    <option value="RM">RM</option>
                    <option value="FG">FG</option>
                  </select>
                </label>
                <label className="scm-form-field">
                  <span className="scm-form-label">UOM</span>
                  <input
                    className="scm-input"
                    value={form.stock_uom}
                    onChange={(e) => setForm((f) => ({ ...f, stock_uom: e.target.value }))}
                  />
                </label>
                <label className="scm-form-field">
                  <span className="scm-form-label">Item group</span>
                  <input
                    className="scm-input"
                    value={form.item_group}
                    onChange={(e) => setForm((f) => ({ ...f, item_group: e.target.value }))}
                  />
                </label>
              </>
            ) : (
              <>
                <ScmDetailField label="Type" value={productType(detail)} />
                <ScmDetailField label="Group" value={detail.item_group} />
                <ScmDetailField label="UOM" value={detail.stock_uom} />
                <ScmDetailField label="Stock item" value={detail.is_stock_item ? "Yes" : "No"} />
                <ScmDetailField label="Disabled" value={detail.disabled ? "Yes" : "No"} />
              </>
            )}
          </div>
        ) : (
          <p className="scm-modal-loading">Could not load product.</p>
        )}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create product"
        subtitle="Item codes should start with RM or FG"
        wide
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="scm-create-product-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <form id="scm-create-product-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            {[
              ["item_code", "Item code"],
              ["item_name", "Item name"],
              ["stock_uom", "Stock UOM"],
            ].map(([key, label]) => (
              <label key={key} className="scm-form-field">
                <span className="scm-form-label">{label}</span>
                <input
                  className="scm-input"
                  value={createForm[key]}
                  onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                  required
                />
              </label>
            ))}
            <label className="scm-form-field">
              <span className="scm-form-label">Item type</span>
              <select
                className="scm-input"
                value={createForm.item_type}
                onChange={(e) => setCreateForm((f) => ({ ...f, item_type: e.target.value }))}
              >
                <option value="RM">RM</option>
                <option value="FG">FG</option>
              </select>
            </label>
          </div>
        </form>
      </ScmModal>
    </div>
  );
}
