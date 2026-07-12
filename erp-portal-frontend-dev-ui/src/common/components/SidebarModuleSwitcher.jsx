import React from "react";
import { NavLink } from "react-router-dom";

export default function SidebarModuleSwitcher({ links, label, pathname, onNavigate }) {
  if (!links.length) return null;

  return (
    <div className="pm-sidebar__section pm-sidebar__section--spaced">
      <div className="pm-sidebar__section-label">{label}</div>
      <div className="pm-sidebar__section-links">
        {links.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.end}
            className={({ isActive }) => {
              const active = item.match ? item.match.test(pathname) : isActive;
              return `pm-sidebar__link${active ? " pm-sidebar__link--active" : ""}`;
            }}
            onClick={onNavigate}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
