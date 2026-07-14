import React from "react";
import {
  HiOutlineBriefcase,
  HiOutlineCheckCircle,
  HiOutlineClipboardDocumentList,
  HiOutlineClock,
} from "react-icons/hi2";

const KPI_ICONS = {
  projects: HiOutlineBriefcase,
  tasks: HiOutlineClipboardDocumentList,
  completed: HiOutlineCheckCircle,
  hours: HiOutlineClock,
};

export default function KpiCard({ title, value, sub, tone = "default", accent, icon }) {
  const valueClass =
    tone === "danger"
      ? "pm-kpi-card__value pm-kpi-card__value--danger"
      : tone === "warn"
        ? "pm-kpi-card__value pm-kpi-card__value--warn"
        : tone === "orange"
          ? "pm-kpi-card__value pm-kpi-card__value--orange"
          : tone === "success"
            ? "pm-kpi-card__value pm-kpi-card__value--success"
            : "pm-kpi-card__value";

  const IconComponent = icon ? KPI_ICONS[icon] : null;
  const iconToneClass = icon ? `pm-kpi-card__icon-wrap--${icon}` : "";

  if (IconComponent) {
    return (
      <div className={`pm-kpi-card${accent ? " pm-kpi-card--accent" : ""}`}>
        <div className="pm-kpi-card__top">
          <h4 className="pm-kpi-card__title">{title}</h4>
          <span className={`pm-kpi-card__icon-wrap ${iconToneClass}`} aria-hidden>
            <IconComponent className="pm-kpi-card__icon" />
          </span>
        </div>
        <div className="pm-kpi-card__body">
          <p className={valueClass}>{value}</p>
          {sub ? <p className="pm-kpi-card__sub">{sub}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`pm-kpi-card${accent ? " pm-kpi-card--accent" : ""}`}>
      <h4 className="pm-kpi-card__title">{title}</h4>
      <div>
        <p className={valueClass}>{value}</p>
        {sub ? <p className="pm-kpi-card__sub">{sub}</p> : null}
      </div>
    </div>
  );
}
