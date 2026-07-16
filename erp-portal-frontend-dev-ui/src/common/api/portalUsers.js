/**
 * Portal user admin API — list/get/save via project_management whitelisted methods.
 */
import { callMethod } from "./client.js";

function buildSavePayload(form, isNew) {
  const payload = {
    is_new: isNew ? 1 : 0,
    email: (form.email || "").trim(),
    username: form.username || "",
    enabled: form.enabled ? 1 : 0,
    language: "en",
    first_name: (form.first_name || "").trim(),
    middle_name: form.middle_name || "",
    last_name: form.last_name || "",
    time_zone: form.time_zone || "",
    send_welcome_email: isNew ? 1 : 0,
    gender: form.gender || "",
    phone: form.phone || "",
    mobile_no: form.mobile_no || "",
    birth_date: form.birth_date || "",
    location: form.location || "",
    interests: form.interests || "",
    bio: form.bio || "",
    module_profile: form.module_profile || "",
    desk_theme: form.desk_theme || "Dark",
    role_names: form.portalRole ? [form.portalRole] : [],
    company: form.company || "",
    date_of_joining: form.date_of_joining || "",
  };
  if (!isNew) {
    payload.name = (form.name || form.email || "").trim();
  }
  return payload;
}

export async function listPortalUsers({ limit = 200 } = {}) {
  const rows = await callMethod("project_management.api.list_portal_users", { limit });
  return rows || [];
}

export async function getPortalUser(name) {
  const doc = await callMethod("project_management.api.get_portal_user", { name });
  return doc;
}

export async function getPortalUserFormOptions() {
  const data = await callMethod("project_management.api.get_portal_user_form_options");
  return data || { default_company: "" };
}

export async function savePortalUser(form, isNew) {
  const payload = buildSavePayload(form, isNew);
  const result = await callMethod("project_management.api.save_portal_user", {
    payload: JSON.stringify(payload),
  });
  return result;
}

export function deskUserUrl(name) {
  const base = import.meta.env.VITE_SITE_ORIGIN || "";
  return `${base}/app/user/${encodeURIComponent(name)}`;
}

/** Toggle enabled via portal API (avoids direct User REST permission issues). */
export async function setPortalUserEnabled(name, enabled) {
  const result = await callMethod("project_management.api.set_portal_user_enabled", {
    name,
    enabled: enabled ? 1 : 0,
  });
  return result;
}

/** Send portal password-reset email (site admin; uses portal /update-password link). */
export async function resetPortalUserPassword(email) {
  const result = await callMethod("project_management.api.admin_reset_portal_user_password", {
    user: (email || "").trim(),
  });
  return result?.message || "Password reset email sent.";
}

/** Permanently delete a portal user (site admin only). */
export async function deletePortalUser(name) {
  const result = await callMethod("project_management.api.delete_portal_user", { name });
  return result;
}
