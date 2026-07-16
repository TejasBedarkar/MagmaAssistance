import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Package,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  computeShortages,
  createMaterialRequestFromDemand,
  explodeDemand,
} from "../api/mrp.js";
import ScmPageHeader from "../components/ScmPageHeader.jsx";
import ScmStatusBadge from "../components/ScmStatusBadge.jsx";
import ScmKpiCard from "../components/ScmKpiCard.jsx";
import ScmPanel from "../components/ScmPanel.jsx";
import ScmQuickLinks from "../components/ScmQuickLinks.jsx";

const EMPTY_LINE = { item_code: "", qty: 1 };

const QUICK_LINKS = [
  { to: "/supply-chain/bom", label: "BOM" },
  { to: "/supply-chain/material-requests", label: "Material requests" },
  { to: "/supply-chain/reservations", label: "Reservations" },
  { to: "/supply-chain/inventory", label: "Stock" },
];

export default function MrpPage() {
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [createdMr, setCreatedMr] = useState(null);

  const demandItems = lines.filter((l) => l.item_code.trim() && Number(l.qty) > 0);

  const runAnalysis = async () => {
    if (!demandItems.length) {
      toast.error("Add at least one item with quantity.");
      return;
    }
    setLoading(true);
    setCreatedMr(null);
    try {
      const data = await computeShortages(demandItems);
      setResult(data);
    } catch (err) {
      toast.error(err?.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const runExplode = async () => {
    if (!demandItems.length) return;
    setLoading(true);
    try {
      const data = await explodeDemand(demandItems);
      setResult({ ...data, shortages: [], sufficient: data.items || [], all_available: true });
      toast.success(`Exploded ${data.items?.length || 0} RM line(s).`);
    } catch (err) {
      toast.error(err?.message || "Explosion failed.");
    } finally {
      setLoading(false);
    }
  };

  const createMr = async () => {
    if (!demandItems.length) return;
    setActing(true);
    try {
      const res = await createMaterialRequestFromDemand({
        items: demandItems,
        source_doctype: "MRP Demand",
        source_name: "Portal",
        auto_submit: 1,
      });
      const mrName = res.name || res.material_request?.name;
      setCreatedMr(mrName);
      toast.success(`MR ${mrName} created.`);
    } catch (err) {
      toast.error(err?.message || "Could not create MR.");
    } finally {
      setActing(false);
    }
  };

  const updateLine = useCallback((idx, key, value) => {
    setLines((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  }, []);

  const shortages = result?.shortages || [];
  const exploded = result?.items || [];

  const kpis = useMemo(() => {
    const totalShortageQty = shortages.reduce(
      (sum, row) => sum + Number(row.shortage_qty || 0),
      0,
    );
    return {
      explodedCount: exploded.length,
      shortageCount: result?.shortage_count ?? shortages.length,
      allAvailable: result ? (result.all_available ? "Yes" : "No") : "—",
      totalShortageQty,
    };
  }, [result, exploded.length, shortages]);

  return (
    <div className="scm-page scm-mrp-page">
      <ScmPageHeader
        title="MRP planning"
        subtitle="Multi-level BOM explosion, shortage analysis, and MR generation"
        actions={
          <>
            <ScmQuickLinks links={QUICK_LINKS} />
            <button type="button" className="scm-btn-ghost" disabled={loading} onClick={runExplode}>
              Explode BOM
            </button>
            <button type="button" className="scm-btn-primary" disabled={loading} onClick={runAnalysis}>
              {loading ? "Analyzing…" : "Analyze shortages"}
            </button>
          </>
        }
      />

      <div className="scm-page-kpi-grid">
        <ScmKpiCard
          label="Exploded lines"
          value={kpis.explodedCount}
          sub="RM requirements from BOM"
          icon={<Layers size={16} />}
        />
        <ScmKpiCard
          label="Shortages"
          value={kpis.shortageCount}
          sub="Items below required qty"
          tone={kpis.shortageCount > 0 ? "danger" : "default"}
          icon={<AlertTriangle size={16} />}
        />
        <ScmKpiCard
          label="All available"
          value={kpis.allAvailable}
          sub="Stock covers demand"
          tone={kpis.allAvailable === "No" ? "warn" : "default"}
          icon={<CheckCircle2 size={16} />}
        />
        <ScmKpiCard
          label="Total shortage qty"
          value={kpis.totalShortageQty.toLocaleString("en-IN")}
          sub="Units to procure"
          tone={kpis.totalShortageQty > 0 ? "danger" : "default"}
          icon={<Package size={16} />}
        />
      </div>

      <div className="scm-page-two-col">
        <ScmPanel
          title="Demand planning"
          subtitle="FG / SFG items to produce or sell"
        >
          {lines.map((line, idx) => (
            <div key={`demand-${idx}`} className="scm-form-grid" style={{ marginBottom: "0.5rem" }}>
              <label className="scm-form-field">
                <span className="scm-form-label">Item code</span>
                <input
                  className="scm-input"
                  value={line.item_code}
                  onChange={(e) => updateLine(idx, "item_code", e.target.value)}
                  placeholder="SCM-DEMO-FG-001"
                />
              </label>
              <label className="scm-form-field">
                <span className="scm-form-label">Qty</span>
                <input
                  type="number"
                  min="1"
                  className="scm-input"
                  value={line.qty}
                  onChange={(e) => updateLine(idx, "qty", Number(e.target.value))}
                />
              </label>
              {lines.length > 1 ? (
                <button
                  type="button"
                  className="scm-btn-ghost"
                  onClick={() => setLines((r) => r.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="scm-btn-ghost"
            onClick={() => setLines((r) => [...r, { ...EMPTY_LINE }])}
          >
            Add line
          </button>
        </ScmPanel>
      </div>

      {createdMr ? (
        <div className="scm-mock-notice" style={{ marginBottom: "1rem" }}>
          Material Request <strong>{createdMr}</strong> created.{" "}
          <Link to={`/supply-chain/material-requests?mr=${encodeURIComponent(createdMr)}`} className="scm-link-btn--sm">
            Open MR
          </Link>
          {" · "}
          <Link to="/supply-chain/purchase-orders" className="scm-link-btn--sm">
            Create PO
          </Link>
        </div>
      ) : null}

      {result ? (
        <>
          {shortages.length > 0 ? (
            <ScmPanel
              title="Shortage lines"
              subtitle="Items below required quantity"
              action={
                <button type="button" className="scm-btn-primary" disabled={acting} onClick={createMr}>
                  {acting ? "Creating…" : "Create MR from shortages"}
                </button>
              }
              className="scm-mrp-shortages-panel"
            >
              <div className="scm-table-scroll">
                <table className="scm-table">
                  <thead>
                    <tr className="scm-table__row">
                      {["Item", "Required", "Available", "Shortage", "Status"].map((h) => (
                        <th key={h} className="scm-table__head">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shortages.map((row) => (
                      <tr key={row.item_code} className="scm-table__row">
                        <td className="scm-table__cell scm-table__cell--strong">{row.item_code}</td>
                        <td className="scm-table__cell">{row.required_qty}</td>
                        <td className="scm-table__cell">{row.available_qty}</td>
                        <td className="scm-table__cell">{row.shortage_qty}</td>
                        <td className="scm-table__cell">
                          <ScmStatusBadge status="Shortage" tone="critical" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScmPanel>
          ) : null}

          {exploded.length > 0 && !shortages.length ? (
            <ScmPanel title="Exploded requirements" subtitle="All materials in stock">
              <div className="scm-table-scroll">
                <table className="scm-table">
                  <thead>
                    <tr className="scm-table__row">
                      {["Item", "Required qty", "UOM"].map((h) => (
                        <th key={h} className="scm-table__head">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exploded.map((row) => (
                      <tr key={row.item_code} className="scm-table__row">
                        <td className="scm-table__cell scm-table__cell--strong">{row.item_code}</td>
                        <td className="scm-table__cell">{row.required_qty ?? row.qty}</td>
                        <td className="scm-table__cell">{row.uom || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScmPanel>
          ) : null}
        </>
      ) : (
        <p className="scm-modal-loading">Enter FG demand and run shortage analysis.</p>
      )}
    </div>
  );
}
