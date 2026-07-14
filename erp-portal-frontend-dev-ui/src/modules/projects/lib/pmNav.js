import {
  PROJECT_NAV_SECTIONS,
  TEAM_PROJECT_NAV_SECTIONS,
  BA_PROJECT_NAV_SECTIONS,
} from "../../../common/constants/moduleNavigation.js";

/**
 * PM sidebar sections by portal role (manager / BA / delivery team).
 */
export function resolveProjectNavSections({
  isManager = false,
  isBusinessAnalyst = false,
} = {}) {
  if (isManager) return PROJECT_NAV_SECTIONS;
  if (isBusinessAnalyst) return BA_PROJECT_NAV_SECTIONS;
  return TEAM_PROJECT_NAV_SECTIONS;
}
