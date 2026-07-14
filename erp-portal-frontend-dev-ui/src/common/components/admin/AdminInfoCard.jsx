import React from "react";

export default function AdminInfoCard({ title, description, items }) {
  return (
    <div className="pm-card pm-admin-card">
      <h2 className="pm-admin-card__title">{title}</h2>
      <p className="pm-page-desc pm-admin-card__desc">{description}</p>
      {items?.length ? (
        <ul className="pm-admin-card__list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
