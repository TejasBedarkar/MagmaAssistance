import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { HiOutlineEye, HiOutlineTrash } from "react-icons/hi2";
import api from "../../lib/apiUtils";
import SalesPageLoader from "../../components/SalesPageLoader.jsx";
import ConfirmDeleteModal from "../../components/ConfirmDeleteModal.jsx";
import SalesKpiCard from "../../components/SalesKpiCard.jsx";
import useSalesToast, { SalesToast } from "../../components/useSalesToast.jsx";
import { SALES_COLORS } from "../../theme/tokens.js";
import {
  PIPELINE_BOARD_ORDER,
  STAGE_TO_API,
  canMovePipelineCard,
  leadStatusToPipelineColumn,
  stageFromOpportunityRow,
} from "../../lib/pipelineStageMap.js";
import { onPipelineRefresh } from "../../lib/pipelineRefresh.js";
import { salesToday, rejectFutureDate } from "../../lib/dateValidation.js";

/* ─── Stage model (aligned with ERPNext Sales Stage + SPA mapping) ───────── */
const COLUMN_META = {
  Lead: { key: "Lead", title: "Lead Created", navLabel: "Lead Created", color: SALES_COLORS.blue, chartKey: "Lead" },
  Opportunity: {
    key: "Opportunity",
    title: "Bid Preparation",
    navLabel: "Bid Preparation",
    color: SALES_COLORS.teal,
    chartKey: "Bid Prep.",
  },
  Proposal: {
    key: "Proposal",
    title: "Proposal Submitted",
    navLabel: "Proposal Submitted",
    color: SALES_COLORS.indigo,
    chartKey: "Proposal",
  },
  Negotiation: { key: "Negotiation", title: "Negotiation", navLabel: "Negotiation", color: SALES_COLORS.purple, chartKey: "Negotiation" },
  "Closed Won": { key: "Closed Won", title: "Won", navLabel: "Won", color: SALES_COLORS.green, chartKey: "Won" },
  "Closed Lost": {
    key: "Closed Lost",
    title: "Lost",
    navLabel: "Lost",
    color: SALES_COLORS.red,
    chartKey: "Lost",
  },
};

const BOARD_ORDER = PIPELINE_BOARD_ORDER;

/** Resolved hex fills for Recharts SVG (CSS var() is unreliable in SVG cells). */
const PIPELINE_CHART_COLORS = {
  Lead: "#38bdf8",
  Opportunity: "#2dd4bf",
  Proposal: "#818cf8",
  Negotiation: "#a78bfa",
  "Closed Won": "#34d399",
  "Closed Lost": "#fb7185",
};

const PIPE_CHART_TYPE_COLORS = {
  leads: "#38bdf8",
  opportunities: "#a78bfa",
};

const PIPE_CHART_OUTCOME_COLORS = {
  Won: "#34d399",
  Lost: "#fb7185",
  Active: "#2dd4bf",
};

/** Fixed heights for Recharts — avoid width/height -1 when parent uses % before layout. */
const PIPE_CHART_HEIGHT = 220;
const CHART_MARGIN = { top: 8, right: 8, left: 4, bottom: 4 };

/** Example placeholders for Bid preparation (empty fields; user types values). */
function bidPrepExamples(card) {
  const customer = card?.leadName || card?.title || "customer";
  const rev = normalizeOpportunityRevenue(card?.expectedRevenue);
  const budget =
    rev > 0
      ? `₹ ${rev.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
      : "₹5,00,000";
  return {
    req_summary: `e.g. ${customer} — 500 units, delivery to site, target budget ${budget}`,
    scope_of_work: "e.g. Supply, delivery to site, installation, 30-day support",
    quote_amount: rev > 0 ? `e.g. ${Math.round(rev)}` : "e.g. 500000",
    timeline: "e.g. 4–6 weeks from PO / advance",
    bid_remarks: "e.g. Price subject to freight; GST extra if applicable",
  };
}

function PipeField({ label, required, hint, children }) {
  return (
    <label className="pipe-field">
      <span className="pipe-field-label">
        {label}
        {required ? " *" : ""}
      </span>
      {hint ? <span className="pipe-field-hint">{hint}</span> : null}
      {children}
    </label>
  );
}

const TOK = {
  bg: SALES_COLORS.bg,
  surface: SALES_COLORS.surface,
  surface2: SALES_COLORS.surface2,
  border: SALES_COLORS.border,
  text: SALES_COLORS.text,
  sub: SALES_COLORS.sub,
  muted: SALES_COLORS.muted,
  accent: SALES_COLORS.blue,
  purple: SALES_COLORS.purple,
  purpleDim: SALES_COLORS.purpleDim,
  purpleLt: SALES_COLORS.purpleLt,
  blue: SALES_COLORS.blue,
  blueDim: SALES_COLORS.blueDim,
  green: SALES_COLORS.green,
  greenDim: SALES_COLORS.greenDim,
  teal: SALES_COLORS.teal,
  red: SALES_COLORS.red,
  redDim: SALES_COLORS.redDim,
  amber: SALES_COLORS.amber,
  overlay: SALES_COLORS.overlay,
  chartGrid: SALES_COLORS.chartGrid,
  shadowLg: "0 24px 60px rgba(0,0,0,.55)",
};

const CHART_TICK = { fontSize: 11, fill: TOK.muted, fontWeight: 600 };

function PipeChartTip({ active, payload, label, valueMode = "count" }) {
  if (!active || !payload?.length) return null;
  const fmtVal = (v) => {
    if (typeof v !== "number") return v;
    return valueMode === "currency" ? fmtMoney(v) : Number(v).toLocaleString("en-IN");
  };
  return (
    <div className="dash-tip">
      {label != null && label !== "" && <p className="dash-tip-label">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="dash-tip-row">
          <span className="dash-tip-dot" style={{ "--tip-color": p.color || p.fill || p.payload?.fill }} />
          <span className="dash-tip-text">
            {p.name}
            <span className="dash-tip-val">{fmtVal(p.value)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PipeDashboardBarChart({ data, dataKey, valueMode = "count", yMoney = false }) {
  if (!data?.length) {
    return <div className="pipe-chart-empty">No pipeline data yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={PIPE_CHART_HEIGHT} minWidth={0}>
      <BarChart
        data={data}
        margin={{ ...CHART_MARGIN, bottom: 8 }}
        barCategoryGap="22%"
      >
        <CartesianGrid strokeDasharray="4 8" stroke={TOK.chartGrid} vertical={false} strokeOpacity={0.6} />
        <XAxis
          dataKey="shortName"
          tick={CHART_TICK}
          interval={0}
          angle={-22}
          textAnchor="end"
          height={54}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={CHART_TICK}
          width={yMoney ? 48 : 32}
          tickFormatter={yMoney ? fmtAxisMoney : undefined}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(56,189,248,0.08)" }}
          content={({ active, payload }) => (
            <PipeChartTip
              active={active}
              payload={payload}
              label={payload?.[0]?.payload?.name}
              valueMode={valueMode}
            />
          )}
        />
        <Bar dataKey={dataKey} name={valueMode === "currency" ? "Value" : "Records"} radius={[6, 6, 0, 0]} maxBarSize={48}>
          {data.map((row) => (
            <Cell key={`${dataKey}-${row.key}`} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PipeDashboardDonut({ data, emptyLabel = "No data" }) {
  if (!data?.length) {
    return <div className="pipe-chart-empty">{emptyLabel}</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={PIPE_CHART_HEIGHT} minWidth={0}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="44%"
          innerRadius={52}
          outerRadius={78}
          paddingAngle={2}
          stroke="transparent"
          isAnimationActive={false}
        >
          {data.map((row) => (
            <Cell key={row.name} fill={row.fill} />
          ))}
        </Pie>
        <Tooltip
          cursor={false}
          content={({ active, payload }) => (
            <PipeChartTip active={active} payload={payload} label={payload?.[0]?.name} valueMode="count" />
          )}
        />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", paddingTop: 6 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Per-opportunity ceiling (10 Cr) — ignores bad demo/typo amounts in totals. */
const MAX_OPPORTUNITY_AMOUNT = 1e8;

const parseAmount = (n) => {
  if (n == null || n === "") return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;
  const cleaned = String(n).replace(/,/g, "").trim();
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
};

const normalizeOpportunityRevenue = (n) => {
  const num = parseAmount(n);
  if (num <= 0) return 0;
  if (num > MAX_OPPORTUNITY_AMOUNT) return 0;
  return num;
};

const fmtMoney = (n) => `₹ ${parseAmount(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const fmtK = (n) => {
  const num = parseAmount(n);
  if (num >= 1e7) {
    const cr = num / 1e7;
    return `₹${cr.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Cr`;
  }
  if (num >= 1e5) {
    const lakhs = num / 1e5;
    return `₹${lakhs.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
  }
  if (num >= 1e3) return `₹${(num / 1e3).toFixed(0)}k`;
  return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const sumExpectedRevenue = (arr) => arr.reduce((s, c) => s + normalizeOpportunityRevenue(c.expectedRevenue), 0);

function pipelineCustomerLeadLabel(card) {
  if (!card) return "—";
  if (card.type === "opportunity") return card.leadName || "—";
  return card.company || card.email || card.phone || "—";
}

function pipelineValueLabel(card) {
  const rev = normalizeOpportunityRevenue(card?.expectedRevenue);
  return rev > 0 ? fmtMoney(rev) : "—";
}

const QUALIFIED_PLUS_LEAD_STATUSES = new Set(["Qualified", "Interested", "Contacted"]);

const fmtAxisMoney = (v) => {
  const n = parseAmount(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${n}`;
};

const stageFromOpportunity = stageFromOpportunityRow;

const parseServerError = (e, fallback) => {
  const data = e?.response?.data;
  try {
    if (data?._server_messages) {
      const arr = JSON.parse(data._server_messages);
      const first = Array.isArray(arr) ? arr[0] : arr;
      if (first) return String(first).replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').trim().slice(0, 280);
    }
    if (data?._error_message) return String(data._error_message).trim().slice(0, 280);
    if (data?.exception) return String(data.exception).replace(/frappe\.exceptions\.\w+:/g, "").trim().slice(0, 280);
  } catch {
    /* ignore */
  }
  return fallback;
};

export default function Pipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [activeStage, setActiveStage] = useState("All");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [columnFilter, setColumnFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** Errors for pipeline actions while the details modal is open (main `error` sits under the overlay). */
  const [modalError, setModalError] = useState("");
  const [stageActionBusy, setStageActionBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [stageForms, setStageForms] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pipeline_stage_forms") || "{}");
    } catch {
      return {};
    }
  });
  /** Ignore stale responses when React Strict Mode re-runs effects (do not abort in-flight XHR). */
  const loadSeq = useRef(0);
  const deepLinkOppRef = useRef(null);
  const { toast, showToast } = useSalesToast(3600);

  useEffect(() => {
    localStorage.setItem("pipeline_stage_forms", JSON.stringify(stageForms));
  }, [stageForms]);

  useEffect(() => {
    setModalError("");
  }, [selectedCard]);

  const isDashboardView = activeStage === "Dashboard";

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedCard || selectedCard.type !== "opportunity") return;
      try {
        const body = new URLSearchParams({ opportunity_id: selectedCard.id });
        const res = await api.post("/api/method/sales_app.api.opportunity.get_pipeline_details", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        const details = res?.data?.message?.details || {};
        const merged = Object.assign({}, details.Opportunity || {}, details.Proposal || {}, details.Negotiation || {});
        if (Object.keys(merged).length) {
          setStageForms((prev) => ({
            ...prev,
            [`opportunity:${selectedCard.id}`]: {
              ...(prev[`opportunity:${selectedCard.id}`] || {}),
              ...merged,
            },
          }));
        }
      } catch {
        /* keep local */
      }
    };
    loadDetails();
  }, [selectedCard]);

  const canDrop = (card, targetColumn) => canMovePipelineCard(card, targetColumn);

  const load = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/method/sales_app.api.pipeline_internal.get_pipeline_spa_data", {
        timeout: 120000,
      });
      if (seq !== loadSeq.current) return;
      const payload = res.data.message || {};
      const leads = payload.leads || [];
      const oppList = payload.opportunities || [];
      const leadNameById = Object.fromEntries(leads.map((l) => [l.name, l.lead_name || l.name]));

      const leadCardsRaw = leads.map((l) => {
        const st = String(l.status || "").trim();
        const column = leadStatusToPipelineColumn(st);
        return {
          id: l.name,
          title: l.lead_name || l.name,
          type: "lead",
          column,
          leadStatus: st,
          company: (l.company || "").trim(),
          email: (l.email || "").trim(),
          phone: (l.phone || "").trim(),
          expectedRevenue: normalizeOpportunityRevenue(l.expected_revenue ?? l.expected_order_value),
        };
      });

      const leadIdsWithOpp = new Set(
        oppList
          .filter((o) => (o.opportunity_from || "") === "Lead")
          .map((o) => o.party_name_id || o.party_name)
          .filter(Boolean)
      );

      const leadCards = leadCardsRaw.filter((c) => {
        if (c.type !== "lead") return true;
        if (c.column !== "Opportunity") return true;
        return !leadIdsWithOpp.has(c.id);
      });

      const oppCards = oppList
        .filter((o) => {
          if (o.opportunity_from !== "Lead") return false;
          const leadRef = o.party_name_id || o.party_name;
          return Boolean(leadRef);
        })
        .map((o) => ({
          id: o.name,
          title: o.opportunity_name || o.name,
          leadName: leadNameById[o.party_name_id || o.party_name] || o.party_label || o.party_name || "—",
          leadId: o.party_name_id || o.party_name,
          type: "opportunity",
          column: stageFromOpportunity(o),
          expectedRevenue: normalizeOpportunityRevenue(o.expected_revenue ?? o.opportunity_amount),
          probability: Number(o.probability ?? 0) || 0,
          status: o.status || "",
          salesStageRaw: o.sales_stage || o.stage || "",
        }));

      setCards([...leadCards, ...oppCards]);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(parseServerError(e, "Failed to load pipeline data."));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = onPipelineRefresh(() => {
      load();
    });
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  /** Open pipeline card modal when arriving from Opportunity (?opp=CRM-OPP-…). */
  useEffect(() => {
    const oppId = (searchParams.get("opp") || "").trim();
    if (!oppId) {
      deepLinkOppRef.current = null;
      return;
    }
    if (loading) return;
    if (deepLinkOppRef.current === oppId) return;

    const card = cards.find((c) => c.type === "opportunity" && c.id === oppId);
    if (card) {
      deepLinkOppRef.current = oppId;
      setActiveStage(card.column);
      setSelectedCard(card);
      setError("");
      setSearchParams({}, { replace: true });
      return;
    }

    deepLinkOppRef.current = oppId;
    setError(
      `Opportunity ${oppId} is not on Delivery Pipeline. Link it to a lead (Qualify or Convert) first.`,
    );
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, cards, loading]);

  const getNextColumn = (card) => {
    if (!card) return null;
    if (card.type === "lead") {
      return card.column === "Lead" ? "Opportunity" : null;
    }
    const nextMap = {
      Lead: "Opportunity",
      Opportunity: "Proposal",
      Proposal: "Negotiation",
      Negotiation: "Closed Won",
      "Closed Won": null,
      "Closed Lost": null,
    };
    return nextMap[card.column] ?? null;
  };

  const getFormValue = (card, field) => {
    const key = `${card?.type || ""}:${card?.id || ""}`;
    return stageForms[key]?.[field] || "";
  };

  const setFormValue = (card, field, value) => {
    const key = `${card?.type || ""}:${card?.id || ""}`;
    setModalError("");
    setStageForms((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }));
  };

  const persistOpportunityDetails = async (card) => {
    if (!card || card.type !== "opportunity") return true;
    const rowKey = `${card.type}:${card.id}`;
    const detailsKey = `opportunity:${card.id}`;
    const detailPayload = { ...(stageForms[detailsKey] || {}), ...(stageForms[rowKey] || {}) };
    try {
      await api.post(
        "/api/method/sales_app.api.opportunity.save_pipeline_details",
        new URLSearchParams({
          opportunity_id: card.id,
          stage: card.column,
          details: JSON.stringify(detailPayload),
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      return true;
    } catch (e) {
      const msg = parseServerError(e, "Could not save stage details.");
      setError(msg);
      setModalError(msg);
      return false;
    }
  };

  const moveCard = async (card, targetColumn) => {
    if (!card || !targetColumn) {
      const msg = "Invalid next step.";
      setError(msg);
      setModalError(msg);
      return;
    }
    setModalError("");
    setStageActionBusy(true);
    try {
      if (targetColumn === card.column) {
        const ok = await persistOpportunityDetails(card);
        if (!ok) return;
        setSelectedCard(null);
        setError("");
        await load();
        return;
      }
      if (!canDrop(card, targetColumn)) {
        const msg = "That stage change is not allowed from here.";
        setError(msg);
        setModalError(msg);
        return;
      }
      if (card.type === "lead") {
        if (targetColumn === "Opportunity") {
          await api.post(
            "/api/method/sales_app.api.lead.qualify_lead",
            new URLSearchParams({ name: card.id }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );
        } else if (targetColumn === "Closed Lost") {
          await api.post(
            "/api/method/sales_app.api.lead.update_lead_status",
            new URLSearchParams({ name: card.id, status: "Dropped" }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );
        }
      } else {
        const ok = await persistOpportunityDetails(card);
        if (!ok) return;
        await api.post(
          "/api/method/sales_app.api.opportunity.update_stage",
          new URLSearchParams({ opportunity_id: card.id, stage: STAGE_TO_API[targetColumn] }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
      }
      setSelectedCard(null);
      setError("");
      await load();
    } catch (e) {
      const msg = parseServerError(e, "Unable to move to next stage.");
      setError(msg);
      setModalError(msg);
    } finally {
      setStageActionBusy(false);
    }
  };

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeStage !== "All" && c.column !== activeStage) return false;
      if (typeFilter === "lead" && c.type !== "lead") return false;
      if (typeFilter === "opportunity" && c.type !== "opportunity") return false;
      if (columnFilter !== "all" && c.column !== columnFilter) return false;
      if (!q) return true;
      const hay = [c.title, c.id, c.leadName, c.company, c.email, c.phone, c.type, c.column, c.leadStatus].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [cards, activeStage, search, typeFilter, columnFilter]);

  const kpis = useMemo(() => {
    const scope = activeStage === "All" ? cards : cards.filter((c) => c.column === activeStage);
    const opps = scope.filter((c) => c.type === "opportunity");
    const leads = scope.filter((c) => c.type === "lead");
    const won = scope.filter((c) => c.column === "Closed Won");
    const lost = scope.filter((c) => c.column === "Closed Lost");
    const value = sumExpectedRevenue(opps);
    const wonValue = sumExpectedRevenue(won);
    const openLeads = leads.filter((c) => c.leadStatus === "Open").length;
    const qualifiedPlus = leads.filter((c) => QUALIFIED_PLUS_LEAD_STATUSES.has(c.leadStatus)).length;
    return {
      total: scope.length,
      leads: leads.length,
      opps: opps.length,
      won: won.length,
      lost: lost.length,
      wonValue,
      value,
      openLeads,
      qualifiedPlus,
    };
  }, [cards, activeStage]);

  const stageKpiCards = useMemo(() => {
    const inView = {
      key: "in_view",
      label: "In view",
      value: kpis.total,
    };

    switch (activeStage) {
      case "Lead":
        return [
          inView,
          {
            key: "stage_leads",
            label: "Leads",
            value: kpis.leads,
          },
          {
            key: "open_leads",
            label: "Open",
            value: kpis.openLeads,
          },
          {
            key: "qualified_plus",
            label: "Qualified+",
            value: kpis.qualifiedPlus,
          },
        ];
      case "Closed Won":
        return [
          inView,
          {
            key: "stage_won",
            label: "Won deals",
            value: kpis.won,
            tone: "success",
          },
          {
            key: "won_value",
            label: "Won value",
            value: fmtK(kpis.wonValue),
            money: true,
          },
        ];
      case "Closed Lost":
        return [
          inView,
          {
            key: "lost_count",
            label: "Lost",
            value: kpis.lost,
            tone: "danger",
          },
          {
            key: "stage_leads",
            label: "Leads",
            value: kpis.leads,
          },
          {
            key: "stage_opps",
            label: "Opportunities",
            value: kpis.opps,
          },
        ];
      case "Opportunity":
      case "Proposal":
      case "Negotiation":
        return [
          inView,
          {
            key: "stage_opps",
            label: "Opportunities",
            value: kpis.opps,
          },
          {
            key: "stage_value",
            label: "Pipeline value",
            value: fmtK(kpis.value),
            money: true,
          },
        ];
      case "All":
      default:
        return [
          inView,
          {
            key: "stage_leads",
            label: "Leads",
            value: kpis.leads,
          },
          {
            key: "stage_opps",
            label: "Opportunities",
            value: kpis.opps,
          },
          {
            key: "stage_value",
            label: "Pipeline value",
            value: fmtK(kpis.value),
            money: true,
          },
        ];
    }
  }, [activeStage, kpis]);

  /** Full-pipeline chart series (not filtered by stage tab). */
  const chartStageBars = useMemo(() => {
    return BOARD_ORDER.map((col) => ({
      key: col,
      name: COLUMN_META[col]?.navLabel || col,
      shortName: COLUMN_META[col]?.chartKey || col,
      fill: PIPELINE_CHART_COLORS[col] ?? "#94a3b8",
      count: cards.filter((c) => c.column === col).length,
      value: sumExpectedRevenue(cards.filter((c) => c.column === col && c.type === "opportunity")),
    }));
  }, [cards]);

  /** Dashboard count chart — always show every stage (matches top tabs). */
  const chartStageBarsFull = chartStageBars;

  /** Full-pipeline dashboard KPIs (same scope as charts). */
  const dashKpis = useMemo(() => {
    const opps = cards.filter((c) => c.type === "opportunity");
    const leads = cards.filter((c) => c.type === "lead");
    const won = opps.filter((c) => c.column === "Closed Won");
    const lost = opps.filter((c) => c.column === "Closed Lost");
    const activeOpps = opps.filter((c) => c.column !== "Closed Won" && c.column !== "Closed Lost");
    const totalRev = sumExpectedRevenue(opps);
    const openRev = sumExpectedRevenue(activeOpps);
    const wonRev = sumExpectedRevenue(won);
    const closedN = won.length + lost.length;
    const winRatePct = closedN > 0 ? Math.round((100 * won.length) / closedN) : null;
    return {
      total: cards.length,
      leads: leads.length,
      opps: opps.length,
      activeOpps: activeOpps.length,
      totalRev,
      openRev,
      wonRev,
      wonN: won.length,
      lostN: lost.length,
      winRatePct,
    };
  }, [cards]);

  const dashKpiCards = useMemo(
    () => [
      { key: "dash_total", label: "Total records", value: dashKpis.total },
      { key: "dash_leads", label: "Leads", value: dashKpis.leads },
      {
        key: "dash_opps",
        label: "Opportunities",
        value: dashKpis.opps,
        meta: `${dashKpis.activeOpps} active in funnel`,
      },
      {
        key: "dash_open_pipeline",
        label: "Open pipeline",
        value: fmtK(dashKpis.openRev),
        money: true,
        meta: dashKpis.winRatePct != null
          ? `Win rate ${dashKpis.winRatePct}% · Won ${fmtK(dashKpis.wonRev)}`
          : "Excl. won & lost",
      },
    ],
    [dashKpis],
  );

  const chartTypeSplit = useMemo(
    () =>
      [
        { name: "Leads", value: dashKpis.leads, fill: PIPE_CHART_TYPE_COLORS.leads },
        { name: "Opportunities", value: dashKpis.opps, fill: PIPE_CHART_TYPE_COLORS.opportunities },
      ].filter((d) => d.value > 0),
    [dashKpis],
  );

  const chartOutcomeSplit = useMemo(
    () =>
      [
        { name: "Won", value: dashKpis.wonN, fill: PIPE_CHART_OUTCOME_COLORS.Won },
        { name: "Lost", value: dashKpis.lostN, fill: PIPE_CHART_OUTCOME_COLORS.Lost },
        { name: "Active", value: dashKpis.activeOpps, fill: PIPE_CHART_OUTCOME_COLORS.Active },
      ].filter((d) => d.value > 0),
    [dashKpis],
  );

  const openDeleteConfirm = (c, e) => {
    e?.stopPropagation?.();
    setError("");
    setDeleteTarget(c);
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError("");
    try {
      const c = deleteTarget;
      if (c.type === "lead") {
        await api.post(
          "/api/method/sales_app.api.lead.delete_lead",
          new URLSearchParams({ name: c.id }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
      } else {
        await api.post(
          "/api/method/sales_app.api.opportunity.delete_opportunity",
          new URLSearchParams({ name: c.id }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
      }
      if (selectedCard?.id === c.id && selectedCard?.type === c.type) setSelectedCard(null);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const msg = parseServerError(err, "Delete failed.");
      setError(msg);
      showToast(msg, "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const navItems = useMemo(() => {
    const items = [
      { key: "Dashboard", label: "Dashboard", count: cards.length, color: SALES_COLORS.indigo },
      { key: "All", label: "All Stages", count: cards.length, color: SALES_COLORS.muted },
      { key: "Lead", label: "Lead Created", count: cards.filter((c) => c.column === "Lead").length, color: COLUMN_META.Lead.color },
    ];
    items.push(
      { key: "Opportunity", label: "Bid Preparation", count: cards.filter((c) => c.column === "Opportunity").length, color: COLUMN_META.Opportunity.color },
      { key: "Proposal", label: "Proposal Submitted", count: cards.filter((c) => c.column === "Proposal").length, color: COLUMN_META.Proposal.color },
      { key: "Negotiation", label: "Negotiation", count: cards.filter((c) => c.column === "Negotiation").length, color: COLUMN_META.Negotiation.color },
      { key: "Closed Won", label: "Won", count: cards.filter((c) => c.column === "Closed Won").length, color: COLUMN_META["Closed Won"].color },
      { key: "Closed Lost", label: "Lost", count: cards.filter((c) => c.column === "Closed Lost").length, color: COLUMN_META["Closed Lost"].color }
    );
    return items;
  }, [cards]);

  return (
    <>
      <SalesToast toast={toast} />
      <div className="pm-page pipe-page">
        <nav className="pipe-stages" aria-label="Pipeline stages">
          {navItems.map((item) => {
            const active = activeStage === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`pipe-stage-btn${active ? " pipe-stage-btn-active" : ""}`}
                onClick={() => {
                  setActiveStage(item.key);
                  setError("");
                }}
              >
                <span>{item.label}</span>
                <span className="pipe-stage-count">{item.count}</span>
              </button>
            );
          })}
        </nav>

        {error ? <div className="pipe-err">{error}</div> : null}

        {loading ? (
          <SalesPageLoader label="Loading pipeline…" />
        ) : isDashboardView ? (
          <section className="pipe-dash" aria-label="Pipeline overview">
            <div className="pipe-kpis pipe-dash-kpis pipe-dash-kpis--static">
              {dashKpiCards.map((item) => (
                <SalesKpiCard
                  key={item.key}
                  compact
                  className={item.money ? "sales-kpi-card--money" : undefined}
                  label={item.label}
                  value={item.value}
                  meta={item.meta}
                  aria-label={`${item.label}: ${item.value}`}
                />
              ))}
            </div>

            <div className="pipe-dash-grid">
              <div className="pipe-dash-card">
                <p className="pipe-dash-title">Records by stage</p>
                <p className="pipe-dash-sub">Record count across each pipeline stage.</p>
                <div className="pipe-dash-chart">
                  <PipeDashboardBarChart data={chartStageBarsFull} dataKey="count" valueMode="count" />
                </div>
              </div>
              <div className="pipe-dash-card">
                <p className="pipe-dash-title">Expected value by stage</p>
                <p className="pipe-dash-sub">Opportunity revenue across all pipeline stages.</p>
                <div className="pipe-dash-chart">
                  <PipeDashboardBarChart
                    data={chartStageBarsFull}
                    dataKey="value"
                    valueMode="currency"
                    yMoney
                  />
                </div>
              </div>
              <div className="pipe-dash-card">
                <p className="pipe-dash-title">Lead vs opportunity</p>
                <p className="pipe-dash-sub">Split of records on the delivery pipeline.</p>
                <div className="pipe-dash-chart">
                  <PipeDashboardDonut data={chartTypeSplit} emptyLabel="No pipeline records yet." />
                </div>
              </div>
              <div className="pipe-dash-card">
                <p className="pipe-dash-title">Deal outcome</p>
                <p className="pipe-dash-sub">Won, lost, and active opportunities.</p>
                <div className="pipe-dash-chart">
                  <PipeDashboardDonut data={chartOutcomeSplit} emptyLabel="No opportunities yet." />
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            <div className="pipe-kpis pipe-dash-kpis--static">
              {stageKpiCards.map((item) => (
                <SalesKpiCard
                  key={item.key}
                  compact
                  className={item.money ? "sales-kpi-card--money" : undefined}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                  aria-label={`${item.label}: ${item.value}`}
                />
              ))}
            </div>

            <div className="pipe-toolbar">
              <input
                className="pipe-search"
                placeholder="Search name, ID, lead…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="pipe-filter-section" role="group" aria-label="Filter pipeline list">
                <span className="pipe-filter-label">Filter</span>
                <select
                  className="pipe-select pipe-select--filter"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label="Filter by record type"
                >
                  <option value="all">All types</option>
                  <option value="lead">Leads only</option>
                  <option value="opportunity">Opportunities only</option>
                </select>
                <select
                  className="pipe-select pipe-select--filter"
                  value={columnFilter}
                  onChange={(e) => setColumnFilter(e.target.value)}
                  aria-label="Filter by stage"
                >
                  <option value="all">All stages</option>
                  {BOARD_ORDER.map((col) => (
                    <option key={col} value={col}>
                      {COLUMN_META[col]?.title || col}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="pm-btn pm-btn-primary pipe-btn pipe-btn-primary" onClick={() => load()}>
                Refresh
              </button>
            </div>

            <div className="pipe-table-wrap">
              <table className="pm-table pipe-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Stage</th>
                    <th>Customer / Lead</th>
                    <th>Value</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCards.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="pipe-table-empty">
                        No records match your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCards.map((c) => (
                      <tr
                        key={`${c.type}-${c.id}`}
                        className="pipe-row-click"
                        onClick={() => {
                          setError("");
                          setSelectedCard(c);
                        }}
                      >
                        <td className="pipe-td-title">{c.title}</td>
                        <td>
                          <span className={`pipe-badge ${c.type === "lead" ? "pipe-badge--lead" : "pipe-badge--opp"}`}>
                            {c.type === "lead" ? "Lead" : "Opportunity"}
                          </span>
                        </td>
                        <td>
                          <span
                            className="pipe-badge pipe-stage-badge"
                            style={{ "--pipe-stage-color": COLUMN_META[c.column]?.color }}
                          >
                            {COLUMN_META[c.column]?.title || c.column}
                          </span>
                        </td>
                        <td className="pipe-td-muted">{pipelineCustomerLeadLabel(c)}</td>
                        <td className="pipe-td-value">{pipelineValueLabel(c)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="pipe-actions">
                            <button
                              type="button"
                              className="pipe-btn pipe-btn-icon pipe-btn-view"
                              aria-label="View details"
                              title="View"
                              onClick={() => setSelectedCard(c)}
                            >
                              <HiOutlineEye aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="pipe-btn pipe-btn-icon pipe-btn-del"
                              aria-label="Delete"
                              title="Delete"
                              onClick={(e) => openDeleteConfirm(c, e)}
                            >
                              <HiOutlineTrash aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {selectedCard && (
        <div
          className="pipe-modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setSelectedCard(null)}
        >
          <div className="pipe-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="pipe-modal-h3">{selectedCard.title}</h3>
            {selectedCard.type === "opportunity" && (
              <p className="pipe-modal-meta">
                Lead: <strong>{selectedCard.leadName || "—"}</strong>
                {selectedCard.expectedRevenue ? (
                  <>
                    {" "}
                    · Value: <strong>{fmtMoney(selectedCard.expectedRevenue)}</strong>
                  </>
                ) : null}
              </p>
            )}
            {selectedCard.type === "lead" && (
              <p className="pipe-modal-meta">
                {selectedCard.company ? (
                  <>
                    Organization: <strong>{selectedCard.company}</strong>
                  </>
                ) : null}
                {selectedCard.email ? (
                  <>
                    {selectedCard.company ? " · " : ""}
                    Email: <strong>{selectedCard.email}</strong>
                  </>
                ) : null}
                {selectedCard.leadStatus ? (
                  <>
                    {(selectedCard.company || selectedCard.email) ? " · " : ""}
                    Status: <strong>{selectedCard.leadStatus}</strong>
                  </>
                ) : null}
              </p>
            )}
            <p className="pipe-modal-meta pipe-modal-meta--sm">
              Stage:{" "}
              <strong>{COLUMN_META[selectedCard.column]?.title || selectedCard.column}</strong>
            </p>
            <p className="pipe-modal-meta pipe-modal-meta--xs">
              Next:{" "}
              <strong className="pipe-modal-next">
                {(() => {
                  const next = getNextColumn(selectedCard);
                  return next ? COLUMN_META[next]?.title || next : "—";
                })()}
              </strong>
            </p>

            {selectedCard.type === "lead" && selectedCard.column === "Lead" ? (
              <div className="pipe-modal-panel">
                <div className="pipe-modal-panel-title">Lead</div>
                <p className="pipe-modal-panel-desc">
                  Qualify marks the lead as qualified and creates an opportunity in Bid Preparation.
                  {selectedCard.leadStatus && !["Qualified", "Interested"].includes(selectedCard.leadStatus)
                    ? ` Current status: ${selectedCard.leadStatus} — will be advanced automatically.`
                    : null}
                  {" "}Drop marks the lead as dropped (Lost).
                </p>
                <div className="pipe-modal-actions-row">
                  <button type="button" className="pm-btn pm-btn-primary pipe-btn pipe-btn-primary pipe-btn-action" onClick={() => moveCard(selectedCard, "Opportunity")}>
                    Qualify
                  </button>
                  <button type="button" className="pipe-btn pipe-btn-danger-outline pipe-btn-action" onClick={() => moveCard(selectedCard, "Closed Lost")}>
                    Drop
                  </button>
                </div>
              </div>
            ) : null}

            {modalError ? (
              <div role="alert" className="pipe-modal-err">
                {modalError}
              </div>
            ) : null}

            {selectedCard.type === "opportunity" && selectedCard.column === "Opportunity" && (() => {
              const ex = bidPrepExamples(selectedCard);
              return (
              <div className="pipe-modal-panel">
                <div className="pipe-modal-panel-title pipe-modal-panel-title--lg">Bid preparation</div>
                <div className="pipe-form-grid">
                  <PipeField
                    label="Requirement summary"
                    hint="What the customer needs — product, quantity, location."
                  >
                    <textarea
                      className="pipe-input pipe-textarea"
                      placeholder={ex.req_summary}
                      value={getFormValue(selectedCard, "req_summary")}
                      onChange={(e) => setFormValue(selectedCard, "req_summary", e.target.value)}
                      rows={3}
                    />
                  </PipeField>
                  <PipeField label="Scope of work" hint="Main activities you will deliver.">
                    <textarea
                      className="pipe-input pipe-textarea"
                      placeholder={ex.scope_of_work}
                      value={getFormValue(selectedCard, "scope_of_work")}
                      onChange={(e) => setFormValue(selectedCard, "scope_of_work", e.target.value)}
                      rows={4}
                    />
                  </PipeField>
                  <PipeField label="Quote amount (₹)" hint="Enter amount in rupees (numbers only).">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="pipe-input"
                      placeholder={ex.quote_amount}
                      value={getFormValue(selectedCard, "quote_amount")}
                      onChange={(e) => setFormValue(selectedCard, "quote_amount", e.target.value)}
                    />
                  </PipeField>
                  <PipeField label="Timeline" hint="When work will be completed.">
                    <input
                      className="pipe-input"
                      placeholder={ex.timeline}
                      value={getFormValue(selectedCard, "timeline")}
                      onChange={(e) => setFormValue(selectedCard, "timeline", e.target.value)}
                    />
                  </PipeField>
                  <PipeField label="Payment terms">
                    <select
                      className="pipe-input"
                      value={getFormValue(selectedCard, "payment_terms")}
                      onChange={(e) => setFormValue(selectedCard, "payment_terms", e.target.value)}
                    >
                      <option value="">Select payment terms</option>
                      <option>100% Advance</option>
                      <option>50% Advance, 50% After Delivery</option>
                      <option>Milestone Based</option>
                      <option>Monthly Payment</option>
                    </select>
                  </PipeField>
                  <PipeField label="Internal approval">
                    <select
                      className="pipe-input"
                      value={getFormValue(selectedCard, "internal_approval")}
                      onChange={(e) => setFormValue(selectedCard, "internal_approval", e.target.value)}
                    >
                      <option value="">Select status</option>
                      <option>Pending</option>
                      <option>Approved</option>
                      <option>Rejected</option>
                    </select>
                  </PipeField>
                  <PipeField label="Remarks" hint="Optional — notes for your team.">
                    <textarea
                      className="pipe-input pipe-textarea"
                      placeholder={ex.bid_remarks}
                      value={getFormValue(selectedCard, "bid_remarks")}
                      onChange={(e) => setFormValue(selectedCard, "bid_remarks", e.target.value)}
                      rows={2}
                    />
                  </PipeField>
                </div>
              </div>
              );
            })()}

            {selectedCard.type === "opportunity" && selectedCard.column === "Proposal" && (
              <div className="pipe-modal-panel">
                <div className="pipe-modal-panel-title">Proposal submitted</div>
                <div className="pipe-form-grid pipe-form-grid--sm">
                  <input className="pipe-input" placeholder="Proposal no. *" value={getFormValue(selectedCard, "proposal_no")} onChange={(e) => setFormValue(selectedCard, "proposal_no", e.target.value)} />
                  <input className="pipe-input" type="date" max={salesToday()} value={getFormValue(selectedCard, "proposal_date")} onChange={(e) => setFormValue(selectedCard, "proposal_date", rejectFutureDate(e.target.value))} />
                  <input className="pipe-input" type="number" placeholder="Proposal amount *" value={getFormValue(selectedCard, "proposal_amount")} onChange={(e) => setFormValue(selectedCard, "proposal_amount", e.target.value)} />
                  <select className="pipe-input" value={getFormValue(selectedCard, "submission_mode")} onChange={(e) => setFormValue(selectedCard, "submission_mode", e.target.value)}>
                    <option value="">Submission mode *</option>
                    <option>Email</option>
                    <option>WhatsApp</option>
                    <option>Printed Copy</option>
                    <option>Portal Upload</option>
                    <option>Meeting</option>
                  </select>
                  <input className="pipe-input" type="date" placeholder="Valid until" value={getFormValue(selectedCard, "valid_until")} onChange={(e) => setFormValue(selectedCard, "valid_until", e.target.value)} />
                  <input className="pipe-input" type="date" value={getFormValue(selectedCard, "expected_response_date")} onChange={(e) => setFormValue(selectedCard, "expected_response_date", e.target.value)} />
                  <select className="pipe-input" value={getFormValue(selectedCard, "initial_response")} onChange={(e) => setFormValue(selectedCard, "initial_response", e.target.value)}>
                    <option value="">Customer initial response *</option>
                    <option>Awaiting Response</option>
                    <option>Interested</option>
                    <option>Need Changes</option>
                    <option>Price Concern</option>
                    <option>Not Interested</option>
                    <option>Invalid / No Response</option>
                  </select>
                  <select className="pipe-input" value={getFormValue(selectedCard, "follow_up_required")} onChange={(e) => setFormValue(selectedCard, "follow_up_required", e.target.value)}>
                    <option value="">Follow-up required?</option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                  {getFormValue(selectedCard, "follow_up_required") === "Yes" && (
                    <>
                      <input className="pipe-input" type="date" value={getFormValue(selectedCard, "follow_up_date")} onChange={(e) => setFormValue(selectedCard, "follow_up_date", e.target.value)} />
                      <textarea className="pipe-input pipe-textarea" value={getFormValue(selectedCard, "follow_up_notes")} onChange={(e) => setFormValue(selectedCard, "follow_up_notes", e.target.value)} placeholder="Follow-up notes" />
                    </>
                  )}
                  <textarea className="pipe-input pipe-textarea" value={getFormValue(selectedCard, "proposal_remarks")} onChange={(e) => setFormValue(selectedCard, "proposal_remarks", e.target.value)} placeholder="Remarks" />
                </div>
                <div className="pipe-modal-actions-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="pipe-btn pipe-btn-action"
                    disabled={stageActionBusy}
                    onClick={() => moveCard(selectedCard, "Opportunity")}
                  >
                    Back to Bid Preparation
                  </button>
                </div>
              </div>
            )}

            {selectedCard.type === "opportunity" && selectedCard.column === "Negotiation" && (
              <div className="pipe-modal-panel">
                <div className="pipe-modal-panel-title">Negotiation</div>
                <div className="pipe-form-grid pipe-form-grid--sm">
                  <input className="pipe-input" type="number" placeholder="Customer budget" value={getFormValue(selectedCard, "neg_budget")} onChange={(e) => setFormValue(selectedCard, "neg_budget", e.target.value)} />
                  <input className="pipe-input" type="number" placeholder="Final offer" value={getFormValue(selectedCard, "neg_final_offer")} onChange={(e) => setFormValue(selectedCard, "neg_final_offer", e.target.value)} />
                  <input className="pipe-input" placeholder="Discount / concession" value={getFormValue(selectedCard, "neg_discount")} onChange={(e) => setFormValue(selectedCard, "neg_discount", e.target.value)} />
                  <input className="pipe-input" placeholder="Decision maker" value={getFormValue(selectedCard, "neg_decision_maker")} onChange={(e) => setFormValue(selectedCard, "neg_decision_maker", e.target.value)} />
                  <input className="pipe-input" type="date" placeholder="Expected closure" value={getFormValue(selectedCard, "neg_closure_date")} onChange={(e) => setFormValue(selectedCard, "neg_closure_date", e.target.value)} />
                  <textarea className="pipe-input pipe-textarea" value={getFormValue(selectedCard, "neg_summary")} onChange={(e) => setFormValue(selectedCard, "neg_summary", e.target.value)} placeholder="Summary" />
                  <div className="pipe-form-grid-2">
                    <button type="button" className="pm-btn pm-btn-primary pipe-btn pipe-btn-primary pipe-btn-action--md" onClick={() => moveCard(selectedCard, "Closed Won")}>
                      Won
                    </button>
                    <button type="button" className="pipe-btn pipe-btn-danger-outline pipe-btn-action--md" onClick={() => moveCard(selectedCard, "Closed Lost")}>
                      Lost
                    </button>
                  </div>
                  <button
                    type="button"
                    className="pipe-btn pipe-btn-action"
                    style={{ marginTop: 10 }}
                    disabled={stageActionBusy}
                    onClick={() => moveCard(selectedCard, "Opportunity")}
                  >
                    Back to Bid Preparation
                  </button>
                </div>
              </div>
            )}

            <div className="pipe-modal-footer">
              <button type="button" className="pipe-btn pipe-btn-action--close" onClick={() => setSelectedCard(null)}>
                Close
              </button>
              {selectedCard.type === "opportunity" || (selectedCard.type === "lead" && selectedCard.column === "Lead") ? (
                <button
                  type="button"
                  disabled={stageActionBusy || !getNextColumn(selectedCard)}
                  className="pm-btn pm-btn-primary pipe-btn pipe-btn-primary pipe-btn-action--next"
                  onClick={() => moveCard(selectedCard, getNextColumn(selectedCard))}
                >
                  {stageActionBusy ? "Saving…" : "Next stage"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        target={deleteTarget ? { id: deleteTarget.id, label: deleteTarget.title } : null}
        title={deleteTarget?.type === "lead" ? "Delete Lead" : "Delete Opportunity"}
        confirmLabel="Delete"
        loading={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </>
  );
}
