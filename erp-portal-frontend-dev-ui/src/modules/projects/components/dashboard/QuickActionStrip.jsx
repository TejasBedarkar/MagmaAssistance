import React from "react";

function IconSun({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconClock({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconList({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconCalendar({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

function IconArrow({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const ACTIONS = [
  {
    id: "my-day",
    label: "My Day",
    description: "Today's focus list",
    path: "/my-day",
    Icon: IconSun,
    featured: true,
    tone: "sky",
  },
  {
    id: "log-time",
    label: "Log time",
    description: "Record hours",
    path: "/timesheets/new",
    Icon: IconClock,
    tone: "violet",
  },
  {
    id: "all-tasks",
    label: "All tasks",
    description: "Browse assignments",
    path: "/tasks",
    Icon: IconList,
    tone: "emerald",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Due dates view",
    path: "/tasks/calendar",
    Icon: IconCalendar,
    tone: "amber",
  },
];

export default function QuickActionStrip({ onNavigate }) {
  return (
    <div className="pm-quick-actions-strip" role="toolbar" aria-label="Quick action shortcuts">
      {ACTIONS.map((action) => {
        const { Icon } = action;
        return (
          <button
            key={action.id}
            type="button"
            className={`pm-quick-action${action.featured ? " pm-quick-action--featured" : ""}`}
            onClick={() => onNavigate(action.path)}
          >
            <span className={`pm-quick-action__icon pm-quick-action__icon--${action.tone}`}>
              <Icon size={20} />
            </span>
            <span className="pm-quick-action__copy">
              <span className="pm-quick-action__label">{action.label}</span>
              <span className="pm-quick-action__desc">{action.description}</span>
            </span>
            <span className="pm-quick-action__arrow" aria-hidden="true">
              <IconArrow />
            </span>
          </button>
        );
      })}
    </div>
  );
}
