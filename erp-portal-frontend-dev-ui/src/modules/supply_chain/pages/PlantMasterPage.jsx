import { useMemo, useState } from "react";
import { Factory, Building2, Gauge, Layers } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import {
  createPlant,
  getPlant,
  getPlantCapacityAvailable,
  listPlants,
  mapDepartmentsToPlant,
  mapEmployeesToPlant,
  mapProductsToPlant,
  mapWarehousesToPlant,
} from "../api/plant.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const EMPTY_FORM = {
  plant_code: "",
  plant_name: "",
  plant_type: "Manufacturing",
  monthly_capacity: 1000,
};

const QUICK_LINKS = [
  { to: "/supply-chain/warehouses", label: "Warehouses" },
  { to: "/supply-chain/inventory", label: "Stock" },
  { to: "/supply-chain/capacity-planning", label: "Capacity planning" },
  { to: "/supply-chain/mrp", label: "MRP planning" },
];

export default function PlantMasterPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [capacity, setCapacity] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [mapWh, setMapWh] = useState("");
  const [mapDept, setMapDept] = useState("");
  const [mapEmployee, setMapEmployee] = useState({ employee: "", department: "", role_at_plant: "" });
  const [mapProduct, setMapProduct] = useState("");
  const [saving, setSaving] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listPlants({ search: debouncedSearch || undefined, limit: 100 }),
    [debouncedSearch],
  );

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(rows, 25);

  const kpis = useMemo(() => {
    const manufacturingCount = rows.filter(
      (r) => String(r.plant_type || "").toLowerCase() === "manufacturing",
    ).length;
    const totalCapacity = rows.reduce((sum, r) => sum + Number(r.monthly_capacity || 0), 0);
    const companyCount = new Set(rows.map((r) => r.company).filter(Boolean)).size;
    return {
      totalPlants: rows.length,
      manufacturingCount,
      totalCapacity,
      companyCount,
    };
  }, [rows]);

  const openRow = async (row) => {
    const code = row.plant_code || row.name;
    setSelected(code);
    setDetail(null);
    setCapacity(null);
    setLoadingDetail(true);
    try {
      const [plant, cap] = await Promise.all([
        getPlant(code),
        getPlantCapacityAvailable(code),
      ]);
      setDetail(plant);
      setCapacity(cap);
    } catch {
      toast.error("Could not load plant.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeModal = () => {
    setDetail(null);
    setSelected(null);
    setCapacity(null);
    setLoadingDetail(false);
  };

  const closeCreateModal = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createPlant(form);
      toast.success(`Plant ${form.plant_code} created.`);
      setShowForm(false);
      setForm(EMPTY_FORM);
      reload();
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const linkWarehouse = async () => {
    if (!selected || !mapWh) return;
    try {
      await mapWarehousesToPlant(selected, [{ warehouse_id: mapWh, type: "RM", status: "Active" }]);
      toast.success("Warehouse mapped.");
      openRow({ plant_code: selected });
    } catch (err) {
      toast.error(err?.message || "Mapping failed.");
    }
  };

  const linkDepartment = async () => {
    if (!selected || !mapDept) return;
    try {
      const existing = (detail?.departments || []).map((d) => ({
        department: d.department,
        is_primary: d.is_primary,
        status: d.status || "Active",
      }));
      await mapDepartmentsToPlant(selected, [
        ...existing,
        { department: mapDept, is_primary: false, status: "Active" },
      ]);
      toast.success("Department mapped.");
      openRow({ plant_code: selected });
      setMapDept("");
    } catch (err) {
      toast.error(err?.message || "Mapping failed.");
    }
  };

  const linkEmployee = async () => {
    if (!selected || !mapEmployee.employee) return;
    try {
      const existing = (detail?.employees || []).map((e) => ({
        employee: e.employee,
        department: e.department,
        role_at_plant: e.role_at_plant,
        is_default_plant: e.is_default_plant,
      }));
      await mapEmployeesToPlant(selected, [...existing, { ...mapEmployee, is_default_plant: false }]);
      toast.success("Employee mapped.");
      openRow({ plant_code: selected });
      setMapEmployee({ employee: "", department: "", role_at_plant: "" });
    } catch (err) {
      toast.error(err?.message || "Mapping failed.");
    }
  };

  const linkProduct = async () => {
    if (!selected || !mapProduct) return;
    try {
      const existing = (detail?.products || []).map((p) => ({
        product_code: p.product_code || p.item_code,
        can_manufacture: p.can_manufacture !== false,
      }));
      await mapProductsToPlant(selected, [
        ...existing,
        { product_code: mapProduct, can_manufacture: true },
      ]);
      toast.success("Product mapped.");
      openRow({ plant_code: selected });
      setMapProduct("");
    } catch (err) {
      toast.error(err?.message || "Mapping failed.");
    }
  };

  const columns = [
    { key: "plant_code", header: "Code", className: "scm-table__cell--link" },
    { key: "plant_name", header: "Name", className: "scm-table__cell--strong" },
    { key: "plant_type", header: "Type" },
    { key: "monthly_capacity", header: "Monthly cap." },
    { key: "company", header: "Company" },
  ];

  return (
    <div className="scm-page scm-plant-page">
      <ScmPageHeader
        title="Plant Master"
        subtitle="Multi-plant configuration, capacity, and warehouse mapping"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks links={QUICK_LINKS} />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <div className="scm-page-kpi-grid">
        <ScmKpiCard
          label="Total plants"
          value={kpis.totalPlants}
          sub="Active plant master records"
          icon={<Factory size={16} />}
        />
        <ScmKpiCard
          label="Manufacturing"
          value={kpis.manufacturingCount}
          sub="Manufacturing-type plants"
          icon={<Building2 size={16} />}
        />
        <ScmKpiCard
          label="Monthly capacity"
          value={kpis.totalCapacity.toLocaleString("en-IN")}
          sub="Combined units / month"
          icon={<Gauge size={16} />}
        />
        <ScmKpiCard
          label="Companies"
          value={kpis.companyCount}
          sub="Distinct legal entities"
          icon={<Layers size={16} />}
        />
      </div>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Configure plant"
          subtitle="Map warehouses, departments, employees, and products"
          action={
            <button type="button" className="scm-btn-primary" onClick={() => setShowForm(true)}>
              New plant
            </button>
          }
        >
          <p className="scm-page-hint">
            Select a plant from the list to map warehouses, departments, employees, and manufactured
            products. Use <strong>New plant</strong> to register a site before mapping.
          </p>
        </ScmPanel>
      </div>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          resetPage();
        }}
        searchPlaceholder="Search plant…"
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Factory}
        emptyTitle="No plants"
        emptyDescription="Create plants to map warehouses and capacity."
        getRowKey={(r) => r.plant_code || r.name}
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
        title={detail?.plant_name || selected || "Plant"}
        subtitle={detail?.plant_code || selected || "Loading…"}
        wide
        onClose={closeModal}
        footer={
          <button type="button" className="scm-btn-ghost" onClick={closeModal}>
            Close
          </button>
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading plant…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Type" value={detail.plant_type} />
              <ScmDetailField label="Working days" value={detail.configuration?.working_days} />
              <ScmDetailField label="Shifts" value={detail.configuration?.shift_count} />
              <ScmDetailField label="Monthly capacity" value={detail.capacity?.monthly_capacity} />
              <ScmDetailField label="Booked capacity" value={detail.capacity?.booked_capacity} />
              <ScmDetailField label="Available" value={capacity?.available_capacity} />
            </div>
            <p className="scm-form-label">Warehouses</p>
            <ul className="scm-activity-list">
              {(detail.warehouses || []).map((w) => (
                <li key={w.warehouse_id} className="scm-activity-item">
                  <span>
                    {w.warehouse_id} · {w.type}
                  </span>
                </li>
              ))}
            </ul>
            {(detail.departments || []).length > 0 ? (
              <>
                <p className="scm-form-label">Departments</p>
                <ul className="scm-activity-list">
                  {detail.departments.map((d) => (
                    <li key={d.department} className="scm-activity-item">
                      {d.department}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {(detail.employees || []).length > 0 ? (
              <>
                <p className="scm-form-label">Employees</p>
                <ul className="scm-activity-list">
                  {detail.employees.map((e) => (
                    <li key={e.employee} className="scm-activity-item">
                      {e.employee} · {e.department}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {(detail.products_manufactured || detail.products || []).length > 0 ? (
              <>
                <p className="scm-form-label">Products manufactured</p>
                <ul className="scm-activity-list">
                  {(detail.products_manufactured || detail.products || []).map((p) => (
                    <li key={p.product_code || p.item_code} className="scm-activity-item">
                      {p.product_code || p.item_code}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="scm-form-grid" style={{ marginTop: "1rem" }}>
              <label className="scm-form-field">
                <span className="scm-form-label">Map warehouse (§12.4)</span>
                <input
                  className="scm-input"
                  value={mapWh}
                  onChange={(e) => setMapWh(e.target.value)}
                  placeholder="RM-WH01"
                />
              </label>
              <label className="scm-form-field">
                <span className="scm-form-label">Map department (§12.5)</span>
                <input
                  className="scm-input"
                  value={mapDept}
                  onChange={(e) => setMapDept(e.target.value)}
                  placeholder="Production"
                />
              </label>
              <label className="scm-form-field">
                <span className="scm-form-label">Map employee ID (§12.6)</span>
                <input
                  className="scm-input"
                  value={mapEmployee.employee}
                  onChange={(e) => setMapEmployee((m) => ({ ...m, employee: e.target.value }))}
                  placeholder="EMP-001"
                />
              </label>
              <label className="scm-form-field">
                <span className="scm-form-label">Employee department</span>
                <input
                  className="scm-input"
                  value={mapEmployee.department}
                  onChange={(e) => setMapEmployee((m) => ({ ...m, department: e.target.value }))}
                />
              </label>
              <label className="scm-form-field">
                <span className="scm-form-label">Product code (§12.8)</span>
                <input
                  className="scm-input"
                  value={mapProduct}
                  onChange={(e) => setMapProduct(e.target.value)}
                  placeholder="FG001"
                />
              </label>
            </div>
            <div className="scm-form-actions">
              <button type="button" className="scm-btn-ghost" onClick={linkWarehouse}>
                Map warehouse
              </button>
              <button type="button" className="scm-btn-ghost" onClick={linkDepartment}>
                Map department
              </button>
              <button type="button" className="scm-btn-ghost" onClick={linkEmployee}>
                Map employee
              </button>
              <button type="button" className="scm-btn-ghost" onClick={linkProduct}>
                Map product
              </button>
            </div>
          </>
        ) : null}
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create plant"
        subtitle="Multi-plant configuration and warehouse mapping"
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="scm-create-plant-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <form id="scm-create-plant-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            {[
              ["plant_code", "Plant code"],
              ["plant_name", "Plant name"],
              ["monthly_capacity", "Monthly capacity"],
            ].map(([key, label]) => (
              <label key={key} className="scm-form-field">
                <span className="scm-form-label">{label}</span>
                <input
                  className="scm-input"
                  type={key === "monthly_capacity" ? "number" : "text"}
                  value={form[key]}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [key]: key === "monthly_capacity" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  required
                />
              </label>
            ))}
          </div>
        </form>
      </ScmModal>
    </div>
  );
}
