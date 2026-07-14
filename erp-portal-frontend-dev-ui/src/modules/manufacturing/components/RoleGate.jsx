import { useManufacturingSession } from "../context/ManufacturingSessionContext.jsx";

/**
 * Conditional rendering by manufacturing role.
 *
 * <RoleGate allow={[ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR]}>
 *   <CreateButton />
 * </RoleGate>
 */
export default function RoleGate({ allow, children, fallback = null }) {
  const { hasRole } = useManufacturingSession();
  return hasRole(...allow) ? children : fallback;
}
