import { PortalPageLoader } from "../../../common/components/PortalSpinner.jsx";

/** Centered loading placeholder for PM lists, editors, and panels. */
export default function ProjectPageLoader({ message = "Loading…", minHeight }) {
  return <PortalPageLoader message={message} minHeight={minHeight} />;
}
