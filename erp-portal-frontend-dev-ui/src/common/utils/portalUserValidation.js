/** Validation helpers for portal user create/edit forms. */

export const GENDER_OPTIONS = ["Male", "Female"];

const PERSON_NAME_RE = /^[\p{L}\s'.-]+$/u;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep only letters, spaces, apostrophe, hyphen, dot. */
export function sanitizePersonName(value) {
  return String(value || "")
    .replace(/[^\p{L}\s'.-]/gu, "")
    .replace(/\s{2,}/g, " ");
}

export function validatePersonName(value, { required = false, label = "Name" } = {}) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return required ? `${label} is required` : null;
  }
  if (trimmed.length < 2) {
    return `${label} must be at least 2 characters`;
  }
  if (!PERSON_NAME_RE.test(trimmed)) {
    return `${label} can only contain letters and spaces`;
  }
  return null;
}

export function validateEmail(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "Email is required";
  if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address";
  return null;
}

/** Digits only, max 10. */
export function sanitizePhone(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);
}

export function validatePhone(value, { required = false, label = "Phone" } = {}) {
  const digits = sanitizePhone(value);
  if (!digits) {
    return required ? `${label} is required` : null;
  }
  if (digits.length !== 10) {
    return `${label} must be exactly 10 digits`;
  }
  return null;
}

export function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function validateBirthDate(value, { required = false } = {}) {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return required ? "Birth date is required" : null;
  }
  const date = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Enter a valid birth date";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) {
    return "Birth date cannot be in the future";
  }
  const minYear = today.getFullYear() - 100;
  if (date.getFullYear() < minYear) {
    return "Enter a valid birth date";
  }
  return null;
}

export function validatePortalUserForm(form, { isNew = false } = {}) {
  const errors = [];

  const emailErr = validateEmail(form.email);
  if (emailErr) errors.push(emailErr);

  const firstErr = validatePersonName(form.first_name, { required: true, label: "First name" });
  if (firstErr) errors.push(firstErr);

  const lastErr = validatePersonName(form.last_name, { label: "Last name" });
  if (lastErr) errors.push(lastErr);

  const middleErr = validatePersonName(form.middle_name, { label: "Middle name" });
  if (middleErr) errors.push(middleErr);

  const phoneErr = validatePhone(form.phone, { label: "Phone" });
  if (phoneErr) errors.push(phoneErr);

  const mobileErr = validatePhone(form.mobile_no, { label: "Mobile number" });
  if (mobileErr) errors.push(mobileErr);

  const birthErr = validateBirthDate(form.birth_date);
  if (birthErr) errors.push(birthErr);

  if (form.gender && !GENDER_OPTIONS.includes(form.gender)) {
    errors.push("Select Male or Female for gender");
  }

  if (!form.portalRole) {
    errors.push("Select exactly one portal role");
  }

  return errors;
}

/** Which editor tab should open for the first validation message. */
export function portalUserErrorTab(message = "") {
  const msg = String(message);
  if (msg.includes("portal role")) return "roles";
  if (msg.includes("Birth date") || msg.includes("Mobile number")) return "more";
  return "details";
}
