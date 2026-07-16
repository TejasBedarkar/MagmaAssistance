import {
  PortalPageLoader,
  PortalInlineLoader,
  PortalBusyButtonContent,
} from "../../../common/components/PortalSpinner.jsx";

/** Full-page loading state — wraps shared PortalPageLoader for sales module. */
export default function SalesPageLoader({ label = "Loading…", minHeight }) {
  return <PortalPageLoader message={label} minHeight={minHeight} />;
}

/** Inline spinner for buttons / compact areas. */
export function SalesInlineLoader({ size = "sm", className = "" }) {
  return <PortalInlineLoader size={size} className={className} />;
}

/** Spinner + label inside pm-btn while an action is in progress. */
export { PortalBusyButtonContent as SalesBusyButtonContent };
