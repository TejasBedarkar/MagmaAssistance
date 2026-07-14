import { SALES_COLORS as C } from "../theme/tokens.js";

export default function WorkflowTimeline({
  stages = [],
  currentStage = "",
  onStageClick,
  getRouteForStage,
  loading = false,
}) {
  const interactive = typeof onStageClick === "function";

  return (
    <ol style={styles.row} aria-label="Sales workflow">
      {stages.map((stage, idx) => {
        const isActive = stage === currentStage;
        const to = getRouteForStage?.(stage);
        const canNavigate = interactive && !loading && Boolean(to);
        const btnStyle = {
          ...styles.btn,
          borderColor: isActive ? C.accentAlpha40 : C.border,
          background: isActive ? C.accentAlpha13 : C.surface2,
          color: isActive ? C.blue : C.text,
          cursor: canNavigate ? "pointer" : interactive && loading ? "wait" : "default",
          opacity: interactive && !canNavigate && !isActive ? 0.72 : 1,
        };

        return (
          <li key={stage} style={styles.item}>
            <button
              type="button"
              onClick={() => {
                if (canNavigate) onStageClick(stage, to);
              }}
              disabled={interactive && loading}
              aria-current={isActive ? "step" : undefined}
              aria-label={
                canNavigate
                  ? `Go to ${stage}`
                  : isActive
                    ? `${stage} (current step)`
                    : stage
              }
              title={canNavigate ? `Open ${stage}` : undefined}
              style={btnStyle}
            >
              <span style={styles.dot}>{idx + 1}</span>
              <span>{stage}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const styles = {
  row: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 8 },
  item: { margin: 0 },
  btn: {
    border: "1px solid",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "inherit",
    transition: "border-color 0.12s, background 0.12s, opacity 0.12s",
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "rgba(148,163,184,0.16)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
  },
};
