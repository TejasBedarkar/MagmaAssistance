/** Cross-page signal so Sales Pipeline reloads after lead/opportunity/quotation actions. */
export const PIPELINE_REFRESH_EVENT = "sales-pipeline-refresh";

export function dispatchPipelineRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PIPELINE_REFRESH_EVENT));
  }
}

export function onPipelineRefresh(listener) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PIPELINE_REFRESH_EVENT, listener);
  return () => window.removeEventListener(PIPELINE_REFRESH_EVENT, listener);
}
