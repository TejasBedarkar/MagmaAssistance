import React from "react";
import { Route } from "react-router-dom";
import ModulePlaceholder from "../pages/ModulePlaceholder.jsx";
import { flatNavItems, routePathFromNavItem } from "../constants/moduleNavigation.js";

/**
 * One <Route> per sidebar link; shows a placeholder until the module UI is built.
 * @param {import('../constants/moduleNavigation.js').NavSection[]} sections
 * @param {{ default: string, [path: string]: string }} descriptions
 */
export function createPlaceholderRoutes(sections, descriptions = {}) {
  const items = flatNavItems(sections);
  const seen = new Set();

  return items.map((item) => {
    const path = routePathFromNavItem(item);
    if (seen.has(path)) return null;
    seen.add(path);

    const description =
      descriptions[path] ||
      descriptions.default ||
      `${item.label} screens will be connected when this module is ready in the portal.`;

    return (
      <Route
        key={path}
        path={path}
        element={
          <ModulePlaceholder
            title={item.label}
            description={description}
            moduleHome={sections[0]?.items[0]?.to}
          />
        }
      />
    );
  });
}
