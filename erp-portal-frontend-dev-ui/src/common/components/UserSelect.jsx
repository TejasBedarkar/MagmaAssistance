import React, { useEffect, useState } from "react";
import { callMethodGet } from "../api/client.js";

/**
 * Dropdown of enabled Frappe users (name + full name).
 * Preserves a value not in the list (e.g. disabled user on an existing record).
 */
export default function UserSelect({
  value,
  onChange,
  required,
  placeholder = "Select user…",
  id,
  purpose,
  project,
  disabled = false,
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadErr("");
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (purpose) params.set("purpose", purpose);
        if (project) params.set("project", project);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const list = await callMethodGet(`project_management.api.get_assignable_users${qs}`);
        if (!cancelled) setUsers(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!cancelled) {
          setUsers([]);
          setLoadErr(e.message || "Could not load users");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purpose, project]);

  const names = new Set(users.map((u) => u.name));
  const showOrphan = value && !names.has(value);

  return (
    <>
      <select
        id={id}
        className="pm-select"
        required={required}
        disabled={disabled || (loading && !value)}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? "Loading users…" : placeholder}</option>
        {showOrphan ? (
          <option value={value}>{value}</option>
        ) : null}
        {users.map((u) => (
          <option key={u.name} value={u.name}>
            {u.label}
          </option>
        ))}
      </select>
      {loadErr ? (
        <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>{loadErr}</p>
      ) : null}
    </>
  );
}
