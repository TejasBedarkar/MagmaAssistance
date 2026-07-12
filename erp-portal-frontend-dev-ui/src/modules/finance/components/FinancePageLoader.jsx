import { PortalPageLoader } from "../../../common/components/PortalSpinner.jsx";

/** Centered loading placeholder for finance tables and panels. */
export default function FinancePageLoader({ message = "Loading…", minHeight }) {
  return <PortalPageLoader message={message} minHeight={minHeight} />;
}
