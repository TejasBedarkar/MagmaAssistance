import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, Layers, Package, Star } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import { createBom, getBom, listBoms, updateBom } from "../api/bom.js";
import { listProducts } from "../api/products.js";
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
import { bomFormFromDetail } from "../utils/fieldHelpers.js";
import { CONSUME_OPERATION_OPTIONS } from "../utils/consumeOperations.js";
import { countWhere, distinctCount } from "../utils/scmPageHelpers.js";

const EMPTY_CREATE = {
  item_code: "",
  quantity: 1,
  items: [{ item_code: "", qty: 1, uom: "Nos", consume_at_operation: "" }],
};

export default function BomPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [productOpts, setProductOpts] = useState({ fg: [], rm: [] });

  useEffect(() => {
    if (!showForm) return;
    Promise.all([listProducts({ item_type: "FG", limit: 200 }), listProducts({ item_type: "RM", limit: 200 })])
      .then(([fg, rm]) => setProductOpts({ fg, rm }))
      .catch(() => toast.error("Could not load products for BOM."));
  }, [showForm]);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listBoms({ item_code: debouncedSearch || undefined, limit: 200 }),
    [debouncedSearch],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.item || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filtered, 25);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      active: countWhere(rows, (r) => r.is_active),
      default: countWhere(rows, (r) => r.is_default),
      fgItems: distinctCount(rows, "item"),
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
    setSelected(row.name);
    setDetail(null);
    setForm(null);
    setEditMode(false);
    setLoadingDetail(true);
    try {
      const data = await getBom(row.name);
      setDetail(data);
      setForm(bomFormFromDetail(data));
    } catch {
      toast.error("Could not load BOM.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const startEdit = () => {
    if (detail) setForm(bomFormFromDetail(detail));
    setEditMode(true);
  };

  const updateLineQty = (itemCode, qty) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((line) =>
        line.item_code === itemCode ? { ...line, qty: Number(qty) || 0 } : line,
      ),
    }));
  };

  const updateLineOperation = (itemCode, consume_at_operation) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((line) =>
        line.item_code === itemCode ? { ...line, consume_at_operation } : line,
      ),
    }));
  };

  const saveBom = async () => {
    if (!detail?.name || !form) return;
    setSaving(true);
    try {
      const updatedBom = await updateBom(detail.name, {
        quantity: form.quantity,
        is_active: form.is_active,
        is_default: form.is_default,
        items: form.items,
      });
      setDetail(updatedBom);
      setForm(bomFormFromDetail(updatedBom));
      setEditMode(false);
      toast.success("BOM updated.");
      reload();
    } catch (err) {
      toast.error(err?.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const closeCreateModal = () => {
    setShowForm(false);
    setCreateForm(EMPTY_CREATE);
  };

  const addRmLine = () => {
    setCreateForm((f) => ({
      ...f,
      items: [...f.items, { item_code: "", qty: 1, uom: "Nos", consume_at_operation: "" }],
    }));
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    const lines = createForm.items.filter((row) => row.item_code);
    if (!createForm.item_code || !lines.length) {
      toast.error("FG item and at least one RM line are required.");
      return;
    }
    setSaving(true);
    try {
      const created = await createBom({
        item_code: createForm.item_code,
        quantity: createForm.quantity,
        items: lines,
      });
      toast.success(`BOM ${created.name} created.`);
      closeCreateModal();
      reload();
      openRow({ name: created.name });
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: "name", header: "BOM", className: "scm-table__cell--link" },
    { key: "item", header: "FG Item", className: "scm-table__cell--strong" },
    { key: "quantity", header: "Qty" },
    {
      key: "is_active",
      header: "Status",
      render: (r) => (
        <ScmStatusBadge status={r.is_active ? "Active" : "Inactive"} tone={r.is_active ? "success" : "default"} />
      ),
    },
    {
      key: "is_default",
      header: "Default",
      render: (r) => (r.is_default ? "Yes" : "—"),
    },
  ];

  const modalOpen = Boolean(selected);

  return (
    <div className="scm-page scm-bom-page">
      <ScmPageHeader
        title="Bill of Materials"
        subtitle="ERPNext BOM — source of truth for Sales and Manufacturing checks"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/products", label: "Products" },
                { to: "/supply-chain/mrp", label: "MRP" },
                { to: "/supply-chain/inventory", label: "Stock" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <ScmPageKpiGrid>
        <ScmKpiCard label="Total BOMs" value={kpis.total} sub="Bill of material records" icon={<Layers size={16} />} />
        <ScmKpiCard
          label="Active"
          value={kpis.active}
          sub="In use for planning"
          tone="success"
          icon={<CheckCircle size={16} />}
        />
        <ScmKpiCard label="Default" value={kpis.default} sub="Primary BOM per FG" icon={<Star size={16} />} />
        <ScmKpiCard label="FG items" value={kpis.fgItems} sub="Distinct finished goods" icon={<Package size={16} />} />
      </ScmPageKpiGrid>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmPanel
        title="BOM definitions"
        subtitle="Finished good output qty and raw material component lines"
        action={
          <button type="button" className="scm-btn-primary" onClick={() => setShowForm(true)}>
            New BOM
          </button>
        }
      >
        <p className="scm-page-hint">
          Each BOM links one FG item to RM lines.{" "}
          <Link to="/supply-chain/products" className="scm-link-btn--sm">
            View products
          </Link>
        </p>
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetPage(); }}
        searchPlaceholder="Search BOM or FG item…"
      />

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Layers}
        emptyTitle="No BOMs"
        emptyDescription="Create BOMs in ERPNext or via API for FG items."
        getRowKey={(r) => r.name}
        activeKey={selected}
        onRowClick={openRow}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={25}
        onPageChange={setPage}
      />

      <ScmModal
        open={modalOpen}
        title={detail?.name || selected || "BOM"}
        subtitle={detail ? `FG: ${detail.item}` : "Loading…"}
        wide
        onClose={closeModal}
        footer={
          loadingDetail ? null : editMode ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={() => setEditMode(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="scm-btn-primary" onClick={saveBom} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              <button type="button" className="scm-btn-primary" onClick={startEdit} disabled={!detail}>
                Edit
              </button>
            </>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading BOM details…</p>
        ) : detail && form ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="FG Item" value={detail.item} />
              <ScmDetailField label="Company" value={detail.company} />
              {editMode ? (
                <>
                  <label className="scm-form-field">
                    <span className="scm-form-label">Output qty</span>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      className="scm-input"
                      value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                    />
                  </label>
                  <label className="scm-form-field">
                    <span className="scm-form-label">Active</span>
                    <select
                      className="scm-input"
                      value={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: Number(e.target.value) }))}
                    >
                      <option value={1}>Active</option>
                      <option value={0}>Inactive</option>
                    </select>
                  </label>
                  <label className="scm-form-field">
                    <span className="scm-form-label">Default BOM</span>
                    <select
                      className="scm-input"
                      value={form.is_default}
                      onChange={(e) => setForm((f) => ({ ...f, is_default: Number(e.target.value) }))}
                    >
                      <option value={1}>Yes</option>
                      <option value={0}>No</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <ScmDetailField label="Output qty" value={detail.quantity} />
                  <ScmDetailField label="Active" value={detail.is_active ? "Yes" : "No"} />
                  <ScmDetailField label="Default" value={detail.is_default ? "Yes" : "No"} />
                </>
              )}
            </div>
            <div className="scm-table-scroll">
              <table className="scm-table">
                <thead>
                  <tr className="scm-table__row">
                    {["RM Item", "Name", "Qty", "UOM", "Step / Operation", "Rate"].map((h) => (
                      <th key={h} className="scm-table__head">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(editMode ? form.items : detail.items || []).map((line) => (
                    <tr key={line.item_code} className="scm-table__row">
                      <td className="scm-table__cell scm-table__cell--strong">{line.item_code}</td>
                      <td className="scm-table__cell">{line.item_name || "—"}</td>
                      <td className="scm-table__cell">
                        {editMode ? (
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            className="scm-input"
                            value={line.qty}
                            onChange={(e) => updateLineQty(line.item_code, e.target.value)}
                          />
                        ) : (
                          line.qty
                        )}
                      </td>
                      <td className="scm-table__cell">{line.uom || "—"}</td>
                      <td className="scm-table__cell">
                        {editMode ? (
                          <select
                            className="scm-input"
                            value={line.consume_at_operation || ""}
                            onChange={(e) => updateLineOperation(line.item_code, e.target.value)}
                          >
                            <option value="">Any step</option>
                            {CONSUME_OPERATION_OPTIONS.filter(Boolean).map((op) => (
                              <option key={op} value={op}>{op}</option>
                            ))}
                          </select>
                        ) : (
                          line.consume_at_operation || "Any step"
                        )}
                      </td>
                      <td className="scm-table__cell">{line.rate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="scm-modal-loading">Could not load BOM.</p>
        )}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create BOM"
        subtitle="Finished good + raw material lines"
        wide
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="scm-btn-ghost" onClick={addRmLine} disabled={saving}>
              Add RM line
            </button>
            <button type="submit" form="scm-create-bom-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Creating…" : "Create BOM"}
            </button>
          </>
        }
      >
        <form id="scm-create-bom-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">FG item *</span>
              <select
                className="scm-input"
                value={createForm.item_code}
                onChange={(e) => setCreateForm((f) => ({ ...f, item_code: e.target.value }))}
                required
              >
                <option value="">Select FG…</option>
                {productOpts.fg.map((p) => (
                  <option key={p.item_code || p.name} value={p.item_code || p.name}>
                    {p.item_code || p.name} — {p.item_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Output qty</span>
              <input
                type="number"
                min="0.001"
                step="any"
                className="scm-input"
                value={createForm.quantity}
                onChange={(e) => setCreateForm((f) => ({ ...f, quantity: Number(e.target.value) || 1 }))}
                required
              />
            </label>
          </div>
          <div className="scm-table-scroll" style={{ marginTop: "1rem" }}>
            <table className="scm-table">
              <thead>
                <tr className="scm-table__row">
                  {["RM item", "Qty", "UOM", "Step / Operation"].map((h) => (
                    <th key={h} className="scm-table__head">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {createForm.items.map((line, idx) => (
                  <tr key={idx} className="scm-table__row">
                    <td className="scm-table__cell">
                      <select
                        className="scm-input"
                        value={line.item_code}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            items: f.items.map((row, i) =>
                              i === idx ? { ...row, item_code: e.target.value } : row,
                            ),
                          }))
                        }
                        required
                      >
                        <option value="">Select RM…</option>
                        {productOpts.rm.map((p) => (
                          <option key={p.item_code || p.name} value={p.item_code || p.name}>
                            {p.item_code || p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="scm-table__cell">
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        className="scm-input"
                        value={line.qty}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            items: f.items.map((row, i) =>
                              i === idx ? { ...row, qty: Number(e.target.value) || 0 } : row,
                            ),
                          }))
                        }
                        required
                      />
                    </td>
                    <td className="scm-table__cell">
                      <input
                        className="scm-input"
                        value={line.uom}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            items: f.items.map((row, i) =>
                              i === idx ? { ...row, uom: e.target.value } : row,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="scm-table__cell">
                      <select
                        className="scm-input"
                        value={line.consume_at_operation || ""}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            items: f.items.map((row, i) =>
                              i === idx ? { ...row, consume_at_operation: e.target.value } : row,
                            ),
                          }))
                        }
                      >
                        <option value="">Any step</option>
                        {CONSUME_OPERATION_OPTIONS.filter(Boolean).map((op) => (
                          <option key={op} value={op}>{op}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      </ScmModal>
    </div>
  );
}
