import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderTree, Globe, Truck, Users } from "lucide-react";
import toast from "react-hot-toast";
import usePagedRows from "../../../common/hooks/usePagedRows.js";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import useScmList from "../hooks/useScmList.js";
import { createSupplier, getSupplier, listSuppliers } from "../api/suppliers.js";
import {
  getSupplierComplianceStatus,
  getSupplierMaterialAssociation,
  getSupplierPerformanceHistory,
  listSupplierDocuments,
  uploadSupplierDocument,
} from "../api/supplierDocuments.js";
import { uploadFile } from "../../manufacturing/api/files.js";
import FileDropZone from "../../manufacturing/components/FileDropZone.jsx";
import { revokeFilePreview } from "../../manufacturing/utils/filePreview.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmListFilters from "../components/ScmListFilters.jsx";
import ScmDataTable from "../components/ScmDataTable.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPageKpiGrid from "../components/ScmPageKpiGrid.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";
import ScmModal from "../components/ScmModal.jsx";
import { ScmDetailField } from "../components/ScmDetailPanel.jsx";
import { countWhere, distinctCount } from "../utils/scmPageHelpers.js";

const EMPTY_FORM = { supplier_name: "", supplier_group: "All Supplier Groups", country: "" };

const DOC_TYPES = [
  { value: "GST", label: "GST (required for PO)" },
  { value: "PAN", label: "PAN (required for PO)" },
  { value: "MSME", label: "MSME" },
  { value: "ISO", label: "ISO" },
  { value: "Contract", label: "Contract / Agreement" },
  { value: "Bank", label: "Bank details" },
  { value: "Other", label: "Other" },
];

const EMPTY_DOC_FORM = {
  document_type: DOC_TYPES[0].value,
  document_name: "",
  valid_from: "",
  valid_to: "",
  remarks: "",
};

const SUPPLIER_DOC_TYPE_OPTIONS = ["GST", "PAN", "MSME", "ISO", "Contract", "Bank", "Other"];

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [perf, setPerf] = useState(null);
  const [materials, setMaterials] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM);
  const [docFiles, setDocFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const { rows, loading, error, updated, reload } = useScmList(
    () => listSuppliers({ search: debouncedSearch || undefined, limit: 200 }),
    [debouncedSearch],
  );

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(rows, 25);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      groups: distinctCount(rows, "supplier_group"),
      countries: distinctCount(rows, "country"),
      grouped: countWhere(rows, (r) => r.supplier_group && r.supplier_group !== "All Supplier Groups"),
    }),
    [rows],
  );

  const openRow = async (row) => {
    setSelected(row.name);
    setDetail(null);
    setPerf(null);
    setMaterials(null);
    setDocuments([]);
    setCompliance(null);
    setLoadingDetail(true);
    try {
      const [sup, performance, assoc, docs, complianceStatus] = await Promise.all([
        getSupplier(row.name),
        getSupplierPerformanceHistory(row.name).catch(() => null),
        getSupplierMaterialAssociation(row.name).catch(() => null),
        listSupplierDocuments(row.name).catch(() => []),
        getSupplierComplianceStatus(row.name).catch(() => null),
      ]);
      setDetail(sup);
      setPerf(performance);
      setMaterials(assoc);
      setDocuments(docs);
      setCompliance(complianceStatus);
    } catch {
      toast.error("Could not load supplier.");
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeModal = () => {
    setDetail(null);
    setSelected(null);
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
      await createSupplier(form);
      toast.success("Supplier created.");
      setShowForm(false);
      setForm(EMPTY_FORM);
      reload();
    } catch (err) {
      toast.error(err?.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const submitDocument = async (e) => {
    e.preventDefault();
    if (!detail?.name) return;
    if (!docFiles.length) {
      toast.error("Please add at least one file.");
      return;
    }
    setSaving(true);
    try {
      const created = [];
      for (const item of docFiles) {
        if (!item?.file) continue;
        const fileUrl = await uploadFile(item.file);
        const typeFromCard = String(item.attachment_type || "").trim();
        const type = SUPPLIER_DOC_TYPE_OPTIONS.includes(typeFromCard)
          ? typeFromCard
          : docForm.document_type;
        const payload = {
          supplier: detail.name,
          document_type: type,
          document_name: docForm.document_name || item.file.name,
          file_url: fileUrl,
          valid_from: docForm.valid_from || undefined,
          valid_to: docForm.valid_to || undefined,
          remarks: docForm.remarks || undefined,
        };
        await uploadSupplierDocument(payload);
        created.push(payload.document_name);
      }
      toast.success(`Uploaded ${created.length} document(s).`);
      setShowDocForm(false);
      setDocForm(EMPTY_DOC_FORM);
      (docFiles || []).forEach((f) => revokeFilePreview(f?.preview));
      setDocFiles([]);
      const docs = await listSupplierDocuments(detail.name);
      setDocuments(docs);
      const complianceStatus = await getSupplierComplianceStatus(detail.name).catch(() => null);
      setCompliance(complianceStatus);
    } catch (err) {
      toast.error(err?.message || "Upload failed.");
    } finally {
      setSaving(false);
    }
  };

  const resetDocModal = () => {
    (docFiles || []).forEach((f) => revokeFilePreview(f?.preview));
    setShowDocForm(false);
    setDocForm(EMPTY_DOC_FORM);
    setDocFiles([]);
  };

  const handleDocFilesChange = (updater) => {
    setDocFiles((prev) => (typeof updater === "function" ? updater(prev) : updater));
  };

  const columns = [
    { key: "name", header: "ID", className: "scm-table__cell--link" },
    { key: "supplier_name", header: "Name", className: "scm-table__cell--strong" },
    { key: "supplier_group", header: "Group" },
    { key: "country", header: "Country" },
  ];

  return (
    <div className="scm-page scm-suppliers-page">
      <ScmPageHeader
        title="Suppliers"
        subtitle="Vendor master for purchase orders"
        updated={updated}
        loading={loading}
        actions={
          <>
            <ScmQuickLinks
              links={[
                { to: "/supply-chain/rfq", label: "RFQ" },
                { to: "/supply-chain/purchase-orders", label: "PO" },
                { to: "/supply-chain/grn", label: "GRN" },
              ]}
            />
            <button type="button" className="scm-btn-ghost" onClick={reload} disabled={loading}>
              Refresh
            </button>
          </>
        }
      />

      <ScmPageKpiGrid>
        <ScmKpiCard label="Total suppliers" value={kpis.total} sub="Vendor master records" icon={<Truck size={16} />} />
        <ScmKpiCard label="Vendor groups" value={kpis.groups} sub="Distinct categories" icon={<FolderTree size={16} />} />
        <ScmKpiCard label="Countries" value={kpis.countries} sub="Geographic spread" icon={<Globe size={16} />} />
        <ScmKpiCard label="Classified" value={kpis.grouped} sub="Assigned to a group" icon={<Users size={16} />} />
      </ScmPageKpiGrid>

      {error ? <div className="scm-error-banner">{error}</div> : null}

      <ScmPanel
        title="Vendor master"
        subtitle="Onboard suppliers before RFQ and purchase orders"
        action={
          <button type="button" className="scm-btn-primary" onClick={() => setShowForm(true)}>
            New supplier
          </button>
        }
      >
        <p className="scm-page-hint">
          Upload GST, PAN, and agreements from supplier detail.{" "}
          <Link to="/supply-chain/rfq" className="scm-link-btn--sm">
            Create RFQ
          </Link>
        </p>
      </ScmPanel>

      <ScmListFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); resetPage(); }}
        searchPlaceholder="Search supplier…"
      />

      <ScmDataTable
        columns={columns}
        rows={pageRows}
        loading={loading}
        emptyIcon={Truck}
        emptyTitle="No suppliers"
        emptyDescription="Add vendors before creating purchase orders."
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
        open={Boolean(selected)}
        title={detail?.supplier_name || selected || "Supplier"}
        subtitle={detail?.name || selected || "Loading…"}
        onClose={closeModal}
        footer={
          detail && !loadingDetail ? (
            <>
              <button type="button" className="scm-btn-ghost" onClick={closeModal}>
                Close
              </button>
              <button type="button" className="scm-btn-primary" onClick={() => setShowDocForm(true)}>
                Upload document
              </button>
            </>
          ) : (
            <button type="button" className="scm-btn-ghost" onClick={closeModal}>
              Close
            </button>
          )
        }
      >
        {loadingDetail ? (
          <p className="scm-modal-loading">Loading supplier…</p>
        ) : detail ? (
          <>
            <div className="scm-detail-grid">
              <ScmDetailField label="Group" value={detail.supplier_group} />
              <ScmDetailField label="Country" value={detail.country} />
              <ScmDetailField
                label="PO compliance"
                value={
                  compliance?.compliant
                    ? "Ready for purchase orders"
                    : compliance
                      ? `Missing: ${(compliance.missing || []).join(", ") || "—"}`
                      : "—"
                }
              />
            </div>
            {compliance && !compliance.compliant ? (
              <p className="scm-page-hint" style={{ marginTop: "0.75rem" }}>
                Upload active <strong>GST</strong> and <strong>PAN</strong> documents before creating a purchase order.
              </p>
            ) : null}
            {perf?.metrics ? (
              <>
                <h4 className="scm-detail-section-title">Performance</h4>
                <div className="scm-detail-grid">
                  <ScmDetailField label="Total orders" value={perf.metrics.total_orders} />
                  <ScmDetailField label="On-time %" value={perf.metrics.on_time_delivery_pct != null ? `${perf.metrics.on_time_delivery_pct}%` : "—"} />
                  <ScmDetailField label="Quality rejection %" value={perf.metrics.quality_rejection_pct != null ? `${perf.metrics.quality_rejection_pct}%` : "—"} />
                  <ScmDetailField label="Avg lead time" value={perf.metrics.avg_lead_time_days != null ? `${perf.metrics.avg_lead_time_days} days` : "—"} />
                </div>
              </>
            ) : null}
            {(materials?.materials_supplied || materials?.materials || []).length > 0 ? (
              <>
                <h4 className="scm-detail-section-title">Materials supplied</h4>
                <ul className="scm-detail-list">
                  {(materials.materials_supplied || materials.materials || []).slice(0, 8).map((m) => (
                    <li key={m.item_code || m.material}>{m.item_code || m.material} — last {m.last_qty} @ {m.last_rate}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {documents.length > 0 ? (
              <>
                <h4 className="scm-detail-section-title">Documents (PDF §1.4.5)</h4>
                <ul className="scm-detail-list">
                  {documents.map((d) => (
                    <li key={d.name}>
                      {d.document_type}: {d.document_name} ({d.status})
                      {d.file || d.file_url ? (
                        <> — <a href={d.file || d.file_url} target="_blank" rel="noreferrer">View</a></>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="scm-modal-loading">No vendor documents on file.</p>
            )}
          </>
        ) : null}
      </ScmModal>

      <ScmModal
        open={showDocForm}
        title="Upload vendor document"
        subtitle={detail?.supplier_name || detail?.name}
        onClose={resetDocModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={resetDocModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="scm-upload-doc-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Upload"}
            </button>
          </>
        }
      >
        <form id="scm-upload-doc-form" onSubmit={submitDocument}>
          <div style={{ marginBottom: "0.75rem" }}>
            <FileDropZone
              files={docFiles}
              onChange={handleDocFilesChange}
              typeOptions={SUPPLIER_DOC_TYPE_OPTIONS}
              compact
            />
          </div>
          <div className="scm-form-grid">
            <label className="scm-form-field">
              <span className="scm-form-label">Default document type</span>
              <select
                className="scm-input"
                value={docForm.document_type}
                onChange={(e) => setDocForm((f) => ({ ...f, document_type: e.target.value }))}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Document name</span>
              <input
                className="scm-input"
                value={docForm.document_name}
                onChange={(e) => setDocForm((f) => ({ ...f, document_name: e.target.value }))}
              />
            </label>
            <p className="scm-page-hint scm-form-field--full" style={{ margin: 0 }}>
              Each preview card can have its own type (GST/PAN/etc). Upload creates one record per file.
            </p>
            <label className="scm-form-field">
              <span className="scm-form-label">Valid from</span>
              <input
                className="scm-input"
                type="date"
                value={docForm.valid_from}
                onChange={(e) => setDocForm((f) => ({ ...f, valid_from: e.target.value }))}
              />
            </label>
            <label className="scm-form-field">
              <span className="scm-form-label">Valid to</span>
              <input
                className="scm-input"
                type="date"
                value={docForm.valid_to}
                onChange={(e) => setDocForm((f) => ({ ...f, valid_to: e.target.value }))}
              />
            </label>
          </div>
        </form>
      </ScmModal>

      <ScmModal
        open={showForm}
        title="Create supplier"
        subtitle="Vendor master for purchase orders"
        onClose={closeCreateModal}
        footer={
          <>
            <button type="button" className="scm-btn-ghost" onClick={closeCreateModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="scm-create-supplier-form" className="scm-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <form id="scm-create-supplier-form" onSubmit={submitCreate}>
          <div className="scm-form-grid">
            {[
              ["supplier_name", "Supplier name"],
              ["supplier_group", "Group"],
              ["country", "Country"],
            ].map(([key, label]) => (
              <label key={key} className="scm-form-field">
                <span className="scm-form-label">{label}</span>
                <input
                  className="scm-input"
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  required={key === "supplier_name"}
                />
              </label>
            ))}
          </div>
        </form>
      </ScmModal>
    </div>
  );
}
