import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Factory, Gauge, ClipboardList } from "lucide-react";
import toast from "react-hot-toast";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import {
  bookPlantCapacityForQuotation,
  getSalesQuotationCapacityPlanning,
  listPlantCapacityBookings,
  listSalesQuotationsAwaitingCapacity,
  releasePlantCapacityForQuotation,
} from "../api/integration.js";
import { listPlants } from "../api/plant.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";

const QUICK_LINKS = [
  { to: "/supply-chain/plant", label: "Plant Master" },
  { to: "/supply-chain", label: "Dashboard" },
];

function capacityTone(row) {
  const plant = row?.plant_capacity || {};
  if (plant.verified_via_scm && !plant.capacity_ok) return "danger";
  const check = row?.capacity_check || {};
  if (check.capacity_committed || check.capacity_ready) return "success";
  if (check.needs_production_commit) return "warn";
  return "neutral";
}

function capacityLabel(row) {
  const plant = row?.plant_capacity || {};
  if (plant.verified_via_scm && !plant.capacity_ok) return "Plant short";
  const check = row?.capacity_check || {};
  if (check.capacity_committed) return "Committed";
  if (check.capacity_available) return "Capacity OK";
  if (check.needs_production_commit) return "PH commit required";
  return row?.delivery_plan_status || "Pending";
}

function fulfilmentPlantFromDetail(detail) {
  const plant = detail?.plant_capacity || {};
  return (
    plant.fulfilment_plant ||
    plant.plant_code ||
    plant.plant_name ||
    ""
  );
}

export default function CapacityPlanningPage() {
  const [searchParams] = useSearchParams();
  const quotationFromUrl = searchParams.get("q") || searchParams.get("quotation") || "";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [rows, setRows] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [plantFilter, setPlantFilter] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pendingRes, bookingRes, plantRows] = await Promise.all([
        listSalesQuotationsAwaitingCapacity(debouncedSearch || undefined, 50, plantFilter || undefined),
        listPlantCapacityBookings(plantFilter || undefined, 50),
        listPlants({ limit: 100 }),
      ]);
      setRows(pendingRes?.rows || []);
      setBookings(bookingRes?.rows || []);
      setPlants(plantRows || []);
      setUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(err?.message || "Could not load capacity planning.");
      setRows([]);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, plantFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!quotationFromUrl) return;
    openQuotation(quotationFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationFromUrl]);

  const hasPlants = plants.length > 0;

  const activeBookingForSelected = useMemo(() => {
    if (!selected) return null;
    return bookings.find((b) => b.quotation === selected) || null;
  }, [bookings, selected]);

  const kpis = useMemo(() => {
    const plantShort = rows.filter((r) => {
      const p = r.plant_capacity || {};
      return p.verified_via_scm && !p.capacity_ok;
    }).length;
    const totalBooked = bookings.reduce((sum, b) => sum + Number(b.booked_qty || 0), 0);
    const totalMonthly = plants.reduce((sum, p) => sum + Number(p.monthly_capacity || 0), 0);
    return {
      pending: rows.length,
      plantShort,
      activeBookings: bookings.length,
      totalBooked,
      totalMonthly,
    };
  }, [rows, bookings, plants]);

  const openQuotation = async (quotation) => {
    const name = String(quotation || "").trim();
    if (!name) return;
    setSelected(name);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await getSalesQuotationCapacityPlanning(name);
      setDetail(res?.row || null);
    } catch (err) {
      toast.error(err?.message || "Could not load quotation detail.");
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setSelected(null);
    setDetail(null);
    setDetailLoading(false);
  };

  const handleBookCapacity = async (allowOverbook = false) => {
    if (!selected) return;
    setActing(true);
    try {
      const plant = fulfilmentPlantFromDetail(detail);
      const qty = Number(detail?.plant_capacity?.required_qty || 0);
      const res = await bookPlantCapacityForQuotation(
        selected,
        plant || undefined,
        qty > 0 ? qty : undefined,
        allowOverbook,
      );
      toast.success(res?.message || "Plant capacity booked.");
      closeModal();
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not book plant capacity.");
    } finally {
      setActing(false);
    }
  };

  const handleReleaseCapacity = async () => {
    if (!selected) return;
    setActing(true);
    try {
      const res = await releasePlantCapacityForQuotation(selected);
      toast.success(res?.message || "Plant capacity released.");
      closeModal();
      await load();
    } catch (err) {
      toast.error(err?.message || "Could not release plant capacity.");
    } finally {
      setActing(false);
    }
  };

  const salesUrl = (name) => `/sales/quotations?q=${encodeURIComponent(name)}`;
  const plantShortOnDetail = Boolean(
    detail?.plant_capacity?.verified_via_scm && !detail?.plant_capacity?.capacity_ok,
  );

  return (
    <div className="scm-page scm-capacity-planning-page">
      <ScmPageHeader
        title="Capacity planning"
        subtitle="Sales quotations awaiting plant capacity commitment (Phase C)"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks links={QUICK_LINKS} />
            <button type="button" className="scm-btn-ghost" onClick={load} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      {!loading && !hasPlants ? (
        <div className="scm-dash-alert" role="alert">
          <p className="scm-dash-alert__text">
            <strong>No SCM plants configured.</strong>
            <span className="scm-dash-alert__muted">
              {" "}
              Create a plant with monthly capacity before capacity checks can verify via SCM.
            </span>
          </p>
          <Link to="/supply-chain/plant" className="scm-dash-alert__link">
            Create plant
          </Link>
        </div>
      ) : null}

      <div className="scm-page-kpi-grid">
        <ScmKpiCard
          label="Awaiting PH commit"
          value={kpis.pending}
          sub="Materials ready in Sales"
          icon={<ClipboardList size={16} />}
          tone="warn"
        />
        <ScmKpiCard
          label="Plant capacity short"
          value={kpis.plantShort}
          sub="SCM monthly capacity exceeded"
          icon={<Gauge size={16} />}
          tone={kpis.plantShort ? "danger" : "neutral"}
        />
        <ScmKpiCard
          label="Active bookings"
          value={kpis.activeBookings}
          sub={`${kpis.totalBooked.toLocaleString("en-IN")} units booked`}
          icon={<Factory size={16} />}
        />
        <ScmKpiCard
          label="Total plant capacity"
          value={kpis.totalMonthly.toLocaleString("en-IN")}
          sub="Combined monthly capacity"
          icon={<Factory size={16} />}
        />
      </div>

      <ScmListFilters
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search quotation or customer…"
        selectLabel="Plant"
        selectValue={plantFilter}
        selectOptions={[
          { value: "", label: "All plants" },
          ...plants.map((p) => ({
            value: p.plant_code || p.name,
            label: p.plant_name || p.plant_code || p.name,
          })),
        ]}
        onSelectChange={setPlantFilter}
      />

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <div className="scm-page-two-col">
        <ScmPanel
          title="Quotations awaiting capacity"
          subtitle="Production Head commits in Sales → Quotations"
        >
          {loading && !rows.length ? (
            <p className="scm-page-hint">Loading…</p>
          ) : rows.length ? (
            <ul className="scm-sales-planning-list">
              {rows.map((row) => (
                <li key={row.quotation}>
                  <button
                    type="button"
                    className="scm-link-btn--sm"
                    onClick={() => openQuotation(row.quotation)}
                  >
                    {row.quotation}
                  </button>
                  {row.party_name ? ` · ${row.party_name}` : ""}
                  {" · "}
                  <ScmStatusBadge
                    status={capacityLabel(row)}
                    tone={capacityTone(row) === "danger" ? "critical" : "default"}
                  />
                  {row.plant_capacity?.verified_via_scm ? (
                    <span>
                      {" · "}
                      {row.plant_capacity.plant_name || row.plant_capacity.plant_code}
                      {": "}
                      {Number(row.plant_capacity.available_capacity || 0).toFixed(0)} avail /{" "}
                      {Number(row.plant_capacity.required_qty || 0).toFixed(0)} need
                    </span>
                  ) : (
                    <span className="scm-page-hint"> · SCM plant not linked</span>
                  )}
                  <Link to={salesUrl(row.quotation)} className="scm-link-btn--sm">
                    Open in Sales
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="scm-page-hint">
              <p>
                No quotations match this filter. Sales quotations appear here when they reach{" "}
                <strong>Awaiting Production</strong> and capacity is not yet committed.
              </p>
              <p>
                Set the same <strong>fulfilment plant code</strong> on the quotation as in{" "}
                <Link to="/supply-chain/plant">Plant Master</Link> (e.g. PUNE-01).
              </p>
            </div>
          )}
        </ScmPanel>

        <ScmPanel title="Active plant bookings" subtitle="Booked monthly capacity per quotation">
          {bookings.length ? (
            <ul className="scm-sales-planning-list">
              {bookings.map((row) => (
                <li key={row.name}>
                  <button
                    type="button"
                    className="scm-link-btn--sm"
                    onClick={() => openQuotation(row.quotation)}
                  >
                    {row.quotation}
                  </button>
                  {" · "}
                  {row.plant_name || row.plant_code}
                  {" · "}
                  {Number(row.booked_qty || 0).toFixed(0)} units
                </li>
              ))}
            </ul>
          ) : (
            <p className="scm-page-hint">
              No active bookings. Use <strong>Book plant capacity</strong> on a quotation detail
              modal, or wait for Sales to wire automatic booking on Production Head commit.
            </p>
          )}
        </ScmPanel>
      </div>

      <ScmModal
        open={Boolean(selected)}
        title={detail?.quotation || selected || "Quotation"}
        subtitle={detail?.party_name || "Capacity planning detail"}
        wide
        onClose={closeModal}
        footer={
          <>
            {selected && !activeBookingForSelected ? (
              <>
                <button
                  type="button"
                  className="scm-btn-primary"
                  disabled={acting || detailLoading}
                  onClick={() => handleBookCapacity(false)}
                >
                  {acting ? "Booking…" : "Book plant capacity"}
                </button>
                {plantShortOnDetail ? (
                  <button
                    type="button"
                    className="scm-btn-ghost"
                    disabled={acting || detailLoading}
                    onClick={() => handleBookCapacity(true)}
                  >
                    Book anyway (overbook)
                  </button>
                ) : null}
              </>
            ) : null}
            {selected && activeBookingForSelected ? (
              <button
                type="button"
                className="scm-btn-ghost"
                disabled={acting || detailLoading}
                onClick={handleReleaseCapacity}
              >
                {acting ? "Releasing…" : "Release booking"}
              </button>
            ) : null}
            {selected ? (
              <Link to={salesUrl(selected)} className="scm-btn-ghost">
                Open in Sales
              </Link>
            ) : null}
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
          </>
        }
      >
        {detailLoading ? (
          <p className="scm-modal-loading">Loading…</p>
        ) : detail ? (
          <div className="scm-sales-planning-detail">
            <div className="scm-detail-grid">
              <ScmDetailField label="Delivery plan" value={detail.delivery_plan_status} />
              <ScmDetailField
                label="Materials"
                value={detail.materials_available ? "Available" : "Short"}
              />
              <ScmDetailField
                label="Capacity committed"
                value={detail.capacity_committed ? "Yes" : "No"}
              />
              <ScmDetailField label="Options ready" value={detail.options_ready ? "Yes" : "No"} />
              <ScmDetailField
                label="SCM booking"
                value={
                  activeBookingForSelected
                    ? `${Number(activeBookingForSelected.booked_qty || 0)} units active`
                    : "None"
                }
              />
            </div>

            {detail.plant_capacity ? (
              <>
                <p className="scm-form-label">SCM plant capacity</p>
                <div className="scm-detail-grid">
                  <ScmDetailField
                    label="Plant"
                    value={
                      detail.plant_capacity.plant_name ||
                      detail.plant_capacity.plant_code ||
                      detail.plant_capacity.fulfilment_plant
                    }
                  />
                  <ScmDetailField
                    label="Required qty"
                    value={detail.plant_capacity.required_qty}
                  />
                  <ScmDetailField
                    label="Available"
                    value={detail.plant_capacity.available_capacity}
                  />
                  <ScmDetailField
                    label="Monthly / booked"
                    value={`${detail.plant_capacity.monthly_capacity || 0} / ${detail.plant_capacity.booked_capacity || 0}`}
                  />
                  <ScmDetailField
                    label="Plant check"
                    value={
                      detail.plant_capacity.verified_via_scm
                        ? detail.plant_capacity.capacity_ok
                          ? "OK"
                          : "Short"
                        : "Not linked to SCM plant"
                    }
                  />
                </div>
              </>
            ) : null}

            {detail.capacity_check ? (
              <>
                <p className="scm-form-label">Manufacturing hours (MFG capacity check)</p>
                <div className="scm-detail-grid">
                  <ScmDetailField
                    label="Required hours"
                    value={Number(detail.capacity_check.required_hours || 0).toFixed(1)}
                  />
                  <ScmDetailField
                    label="Available hours"
                    value={Number(detail.capacity_check.available_hours || 0).toFixed(1)}
                  />
                  <ScmDetailField
                    label="Machine capacity"
                    value={detail.capacity_check.machine_capacity_available ? "OK" : "Short"}
                  />
                </div>
                {(detail.capacity_check.machines || []).length ? (
                  <table className="scm-table scm-table--compact scm-capacity-machine-table">
                    <thead>
                      <tr>
                        <th>Machine</th>
                        <th>Req (h)</th>
                        <th>Booked (h)</th>
                        <th>Avail (h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.capacity_check.machines.slice(0, 8).map((row) => (
                        <tr key={row.machine || row.workstation || row.workstation_name}>
                          <td>{row.machine || row.workstation_name || row.workstation}</td>
                          <td>{Number(row.required_hours || 0).toFixed(1)}</td>
                          <td>{Number(row.booked_hours || 0).toFixed(1)}</td>
                          <td>{Number(row.available_hours || 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <p className="scm-page-hint">No detail available.</p>
        )}
      </ScmModal>
    </div>
  );
}
