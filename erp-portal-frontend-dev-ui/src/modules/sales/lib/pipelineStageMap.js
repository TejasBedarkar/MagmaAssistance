/**
 * Sales Deal Pipeline — single source of truth for board columns, API stages, and transitions.
 * Keep aligned with sales_app.api.opportunity.STAGE_FLOW (Discussion = Bid Preparation column).
 */

export const STAGE_TO_API = {
  Opportunity: "Discussion",
  Proposal: "Proposal",
  Negotiation: "Negotiation",
  "Closed Won": "Closed Won",
  "Closed Lost": "Closed Lost",
};

export const API_STAGE_TO_PIPELINE_COLUMN = {
  Discussion: "Opportunity",
  Proposal: "Proposal",
  Negotiation: "Negotiation",
  "Closed Won": "Closed Won",
  "Closed Lost": "Closed Lost",
};

export const PIPELINE_COLUMN_LABELS = {
  Lead: "Lead Created",
  Opportunity: "Bid Preparation",
  Proposal: "Proposal Submitted",
  Negotiation: "Negotiation",
  "Closed Won": "Won",
  "Closed Lost": "Lost",
};

/** Kanban column order (Pipeline.jsx board). */
export const PIPELINE_BOARD_ORDER = [
  "Lead",
  "Opportunity",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
];

/** Lead.status values that stay in the Lead Created pipeline column. */
export const LEAD_CREATED_STATUSES = new Set([
  "Open",
  "Contacted",
  "Qualified",
  "Hold",
  "Replied",
  "Interested",
  "Lead",
]);

/**
 * Map Lead.status → pipeline board column key.
 * Keep aligned with pipeline_internal._lead_status_to_pipeline_column.
 */
export function leadStatusToPipelineColumn(status) {
  const st = String(status || "").trim();
  if (st === "Dropped") return "Closed Lost";
  if (st === "Opportunity" || st === "Converted") return "Opportunity";
  if (LEAD_CREATED_STATUSES.has(st)) return "Lead";
  return "Lead";
}

/**
 * Allowed pipeline column moves — mirrors backend STAGE_FLOW mapped to board columns.
 * Discussion ↔ Opportunity, Proposal ↔ Negotiation, terminal Won/Lost.
 */
export const PIPELINE_COLUMN_TRANSITIONS = {
  Lead: ["Opportunity", "Closed Lost"],
  Opportunity: ["Proposal", "Closed Lost"],
  Proposal: ["Opportunity", "Negotiation", "Closed Lost"],
  Negotiation: ["Opportunity", "Closed Won", "Closed Lost"],
  "Closed Won": [],
  "Closed Lost": [],
};

/** Sales pipeline lists opportunities created from a lead with a party reference. */
export function opportunityOnDeliveryPipeline(opp) {
  const from = String(opp?.opportunity_from || "").trim();
  const party = opp?.party_name_id || opp?.party_name;
  return from === "Lead" && Boolean(party);
}

/**
 * API stage to set when user clicks Interested on the Opportunity page.
 * Returns null if stage should not change (navigate to pipeline only).
 */
export function interestedTargetApiStage(canonicalStage) {
  if (canonicalStage === "Negotiation") return null;
  if (canonicalStage === "Closed Won" || canonicalStage === "Closed Lost") return null;
  return "Negotiation";
}

export function pipelineColumnForApiStage(apiStage) {
  return API_STAGE_TO_PIPELINE_COLUMN[apiStage] || "Opportunity";
}

export function pipelineColumnLabel(columnKey) {
  return PIPELINE_COLUMN_LABELS[columnKey] || columnKey;
}

export function pipelineColumnToApiStage(columnKey) {
  return STAGE_TO_API[columnKey] || columnKey;
}

/** Map opportunity row → pipeline board column (same rules as pipeline_internal._stage_from_opportunity). */
export function stageFromOpportunityRow(op) {
  const stage = String(op?.sales_stage || op?.stage || "").trim().toLowerCase();
  const status = String(op?.status || "").trim().toLowerCase();
  if (stage === "closed won" || stage === "won" || status === "won") return "Closed Won";
  if (stage === "closed lost" || stage === "lost" || status === "lost") return "Closed Lost";
  if (
    stage === "discussion"
    || stage === "prospecting"
    || stage === "qualification"
    || stage === "needs analysis"
  ) {
    return "Opportunity";
  }
  if (stage === "proposal" || stage === "proposal/price quote" || stage === "quotation") {
    return "Proposal";
  }
  if (stage === "negotiation" || stage === "negotiation/review") return "Negotiation";
  return "Opportunity";
}

/** Whether a card may move to targetColumn on the deal pipeline board. */
export function canMovePipelineCard(card, targetColumn) {
  if (!card || !targetColumn || card.column === targetColumn) return false;
  if (card.type === "lead") {
    return (PIPELINE_COLUMN_TRANSITIONS.Lead || []).includes(targetColumn);
  }
  if (card.type !== "opportunity") return false;
  return (PIPELINE_COLUMN_TRANSITIONS[card.column] || []).includes(targetColumn);
}

/** All valid target columns for a pipeline card (excluding current). */
export function allowedPipelineTargets(card) {
  if (!card) return [];
  const key = card.type === "lead" ? "Lead" : card.column;
  return (PIPELINE_COLUMN_TRANSITIONS[key] || []).filter((col) => col !== card.column);
}
