import { SALES_COLORS as C } from "../theme/tokens.js";

export default function AccessDeniedState({ title = "Access denied", detail = "You do not have permission for this page." }) {
  return (
    <section style={styles.wrap} aria-live="polite">
      <h2 style={styles.title}>{title}</h2>
      <p style={styles.detail}>{detail}</p>
    </section>
  );
}

const styles = {
  wrap: {
    margin: "24px auto",
    maxWidth: 680,
    padding: "22px",
    borderRadius: 12,
    background: C.surface,
    border: `1px solid ${C.border}`,
    color: C.text,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: C.amber },
  detail: { margin: "8px 0 0", fontSize: 13, color: C.sub },
};
