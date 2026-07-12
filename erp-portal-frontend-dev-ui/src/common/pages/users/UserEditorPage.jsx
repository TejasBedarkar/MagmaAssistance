import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getPortalUser, getPortalUserFormOptions, savePortalUser } from "../../api/portalUsers.js";
import {
  ALL_PORTAL_ROLES,
  PORTAL_ROLE_GROUPS,
  TIME_ZONE_DEFAULT,
  USER_EDITOR_TABS,
  displayPortalRole,
} from "../../constants/portalUserRoles.js";
import { PortalInlineLoader, PortalPageLoader } from "../../components/PortalSpinner.jsx";
import usePortalToast from "../../hooks/usePortalToast.js";
import {
  GENDER_OPTIONS,
  sanitizePersonName,
  sanitizePhone,
  todayIsoDate,
  portalUserErrorTab,
  validatePortalUserForm,
} from "../../utils/portalUserValidation.js";

const emptyForm = {
  enabled: 1,
  email: "",
  username: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  time_zone: TIME_ZONE_DEFAULT,
  gender: "",
  phone: "",
  mobile_no: "",
  birth_date: "",
  location: "",
  interests: "",
  bio: "",
  desk_theme: "Dark",
  portalRole: "",
  otherRoleNames: [],
  company: "",
  date_of_joining: "",
  employee_id: "",
};

function docToForm(doc) {
  if (!doc) return { ...emptyForm };
  return {
    enabled: doc.enabled ? 1 : 0,
    email: doc.email || doc.name || "",
    username: doc.username || "",
    first_name: doc.first_name || "",
    middle_name: doc.middle_name || "",
    last_name: doc.last_name || "",
    time_zone: doc.time_zone || TIME_ZONE_DEFAULT,
    gender: doc.gender || "",
    phone: doc.phone || "",
    mobile_no: doc.mobile_no || "",
    birth_date: doc.birth_date || "",
    location: doc.location || "",
    interests: doc.interests || "",
    bio: doc.bio || "",
    desk_theme: doc.desk_theme || "Dark",
    portalRole:
      (doc.roleNames || (doc.roles || []).map((r) => r.role).filter(Boolean)).find((r) =>
        ALL_PORTAL_ROLES.includes(r)
      ) || "",
    otherRoleNames: (doc.roleNames || (doc.roles || []).map((r) => r.role).filter(Boolean)).filter(
      (r) => !ALL_PORTAL_ROLES.includes(r)
    ),
    company: doc.company || "",
    date_of_joining: doc.date_of_joining || "",
    employee_id: doc.employee_id || "",
  };
}

function RequiredMark() {
  return (
    <span className="pm-required-mark" aria-hidden>
      *
    </span>
  );
}

export default function UserEditorPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isNew = id === "new" || location.pathname.endsWith("/users/new");
  const maxBirthDate = todayIsoDate();
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [rolesError, setRolesError] = useState(false);
  const [formOptions, setFormOptions] = useState({
    defaultCompany: "",
  });
  const { showToast } = usePortalToast();

  const pageTitle = [form.first_name, form.last_name].filter(Boolean).join(" ").trim() || form.email || id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await getPortalUserFormOptions();
        if (cancelled) return;
        setFormOptions({
          defaultCompany: opts.default_company || "",
        });
        if (isNew) {
          setForm((f) => ({
            ...f,
            company: f.company || opts.default_company || "",
            date_of_joining: f.date_of_joining || todayIsoDate(),
          }));
        }
      } catch (e) {
        if (!cancelled) showToast(e.message || "Could not load form options", "error", 4500);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, showToast]);

  useEffect(() => {
    if (isNew) {
      setForm({ ...emptyForm });
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const doc = await getPortalUser(id);
        if (!cancelled) setForm(docToForm(doc));
      } catch (e) {
        if (!cancelled) showToast(e.message || "Could not load user", "error", 4500);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew, showToast]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setNameField(key, value) {
    setField(key, sanitizePersonName(value));
  }

  function setPhoneField(key, value) {
    setField(key, sanitizePhone(value));
  }

  function selectPortalRole(role) {
    setRolesError(false);
    setField("portalRole", role);
  }

  async function onSave(e) {
    e?.preventDefault?.();
    const errors = validatePortalUserForm(form, { isNew });
    if (errors.length) {
      if (errors.some((msg) => msg.includes("portal role"))) {
        setRolesError(true);
      }
      setTab(portalUserErrorTab(errors[0]));
      const message =
        errors.length === 1 ? errors[0] : `${errors[0]} (${errors.length - 1} more field${errors.length > 2 ? "s" : ""} to fix)`;
      showToast(message, "error");
      return;
    }
    setRolesError(false);
    setSaving(true);
    try {
      const result = await savePortalUser(
        isNew
          ? { ...form, company: form.company || formOptions.defaultCompany || "" }
          : { ...form, name: id || form.email, company: form.company || formOptions.defaultCompany || "" },
        isNew
      );
      navigate("/users", { state: { userSaveNotice: result?.message || "User saved" } });
    } catch (ex) {
      showToast(ex.message || "Could not save user", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="pm-page pm-form-page pm-user-editor">
        <PortalPageLoader message="Loading user…" className="pm-users-loading" />
      </div>
    );
  }

  return (
    <div className="pm-page pm-form-page pm-user-editor">
      <div className="pm-form-page__head pm-user-editor__head">
        <Link to="/users" className="pm-back-link">
          ← Users
        </Link>
        {!isNew ? <h1 className="pm-form-page__title">{pageTitle}</h1> : null}
      </div>

      <form className="pm-card pm-form-card pm-user-editor-card" onSubmit={onSave}>
        <div className="pm-user-tabs" role="tablist" aria-label="User sections">
          {USER_EDITOR_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pm-user-tabs__tab${tab === t.id ? " pm-user-tabs__tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "roles" && !form.portalRole ? (
                <span className="pm-user-tabs__required-dot" title="Role required" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>

        <div className="pm-user-editor__body">
        {tab === "details" ? (
          <div className="pm-user-tab-panel pm-user-details-panel">
            <div className="pm-form-grid pm-user-details-grid">
              <div className="pm-field pm-form-grid__full">
                <label className="pm-label">Company</label>
                <input
                  className="pm-input pm-input--readonly"
                  value={form.company || formOptions.defaultCompany || ""}
                  readOnly
                  placeholder="Administrator company"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">
                  Email <RequiredMark />
                </label>
                <input
                  className="pm-input"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value.trim().toLowerCase())}
                  readOnly={!isNew}
                  placeholder="user@company.com"
                  autoComplete="email"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">
                  First name <RequiredMark />
                </label>
                <input
                  className="pm-input"
                  required
                  value={form.first_name}
                  onChange={(e) => setNameField("first_name", e.target.value)}
                  placeholder="Given name"
                  autoComplete="given-name"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Last name</label>
                <input
                  className="pm-input"
                  value={form.last_name}
                  onChange={(e) => setNameField("last_name", e.target.value)}
                  placeholder="Family name"
                  autoComplete="family-name"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Middle name</label>
                <input
                  className="pm-input"
                  value={form.middle_name}
                  onChange={(e) => setNameField("middle_name", e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Username</label>
                <input
                  className="pm-input"
                  value={form.username}
                  onChange={(e) => setField("username", e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Gender</label>
                <select
                  className="pm-select"
                  value={form.gender}
                  onChange={(e) => setField("gender", e.target.value)}
                >
                  <option value="">Select gender</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pm-field">
                <label className="pm-label">Phone</label>
                <input
                  className="pm-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone}
                  onChange={(e) => setPhoneField("phone", e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
              {form.employee_id ? (
                <div className="pm-field">
                  <label className="pm-label">Employee ID</label>
                  <input className="pm-input pm-input--readonly" value={form.employee_id} readOnly />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "roles" ? (
          <div className="pm-user-tab-panel pm-user-roles-panel">
            {rolesError ? (
              <p className="pm-user-required-note" role="alert">
                <RequiredMark /> Select exactly one portal role.
              </p>
            ) : null}

            <p className="pm-user-roles-panel__label">
              Portal role <RequiredMark />
            </p>

            <div className="pm-user-roles-grid" role="radiogroup" aria-label="Portal role">
              {PORTAL_ROLE_GROUPS.map((group) => (
                <section
                  key={group.id}
                  className={`pm-user-role-group pm-user-role-group--${group.id}`}
                  aria-labelledby={`role-group-${group.id}`}
                >
                  <h3 id={`role-group-${group.id}`} className="pm-user-role-group__title">
                    {group.label}
                  </h3>
                  <div className="pm-user-role-tiles">
                    {group.roles.map((role) => {
                      const selected = form.portalRole === role;
                      return (
                        <label
                          key={role}
                          className={`pm-user-role-tile${selected ? " pm-user-role-tile--selected" : ""}`}
                        >
                          <input
                            type="radio"
                            className="pm-user-role-tile__input"
                            name="portalRole"
                            checked={selected}
                            onChange={() => selectPortalRole(role)}
                          />
                          <span className="pm-user-role-tile__dot" aria-hidden />
                          <span className="pm-user-role-tile__label">{displayPortalRole(role)}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {form.otherRoleNames?.length ? (
              <p className="pm-user-roles-desk-note">
                Desk roles: {form.otherRoleNames.map(displayPortalRole).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "more" ? (
          <div className="pm-user-tab-panel">
            <div className="pm-form-grid">
              <div className="pm-field">
                <label className="pm-label">Mobile no</label>
                <input
                  className="pm-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.mobile_no}
                  onChange={(e) => setPhoneField("mobile_no", e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Birth date</label>
                <input
                  className="pm-input"
                  type="date"
                  max={maxBirthDate}
                  value={form.birth_date || ""}
                  onChange={(e) => setField("birth_date", e.target.value)}
                />
              </div>
              <div className="pm-field">
                <label className="pm-label">Time zone</label>
                <input className="pm-input" value={form.time_zone} onChange={(e) => setField("time_zone", e.target.value)} />
              </div>
              <div className="pm-field">
                <label className="pm-label">Date of joining</label>
                <input
                  className="pm-input"
                  type="date"
                  value={form.date_of_joining || ""}
                  onChange={(e) => setField("date_of_joining", e.target.value)}
                />
              </div>
              <div className="pm-field pm-form-grid__full">
                <label className="pm-label">Location</label>
                <input className="pm-input" value={form.location} onChange={(e) => setField("location", e.target.value)} />
              </div>
              <div className="pm-field">
                <label className="pm-label">Interests</label>
                <textarea className="pm-textarea pm-user-editor-textarea" rows={4} value={form.interests} onChange={(e) => setField("interests", e.target.value)} />
              </div>
              <div className="pm-field">
                <label className="pm-label">Bio</label>
                <textarea className="pm-textarea pm-user-editor-textarea" rows={4} value={form.bio} onChange={(e) => setField("bio", e.target.value)} />
              </div>
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="pm-user-tab-panel">
            <div className="pm-form-grid">
              <div className="pm-field">
                <label className="pm-label">Desk theme</label>
                <select className="pm-select" value={form.desk_theme} onChange={(e) => setField("desk_theme", e.target.value)}>
                  <option value="Dark">Dark</option>
                  <option value="Light">Light</option>
                  <option value="Automatic">Automatic</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}
        </div>

        <div className="pm-form-actions">
          <button type="submit" className="pm-btn pm-btn-primary" disabled={saving} aria-busy={saving}>
            {saving ? (
              <>
                <PortalInlineLoader size="sm" className="portal-spinner--in-btn" />
                {isNew ? "Creating…" : "Saving…"}
              </>
            ) : isNew ? (
              "Create user"
            ) : (
              "Save user"
            )}
          </button>
          <Link to="/users" className="pm-btn">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
