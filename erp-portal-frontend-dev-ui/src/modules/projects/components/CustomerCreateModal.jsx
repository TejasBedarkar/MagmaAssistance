import React, { useEffect, useState } from "react";
import { links } from "../api/index.js";
import LinkSelect from "./LinkSelect.jsx";
import Modal from "../../../common/components/Modal.jsx";
import { PortalBusyButtonContent } from "../../../common/components/PortalSpinner.jsx";

const EMPTY = {
  customer_name: "",
  customer_type: "Company",
  customer_group: "",
  territory: "",
  tax_id: "",
  website: "",
  email_id: "",
  mobile_no: "",
  industry: "",
  default_currency: "",
  salutation: "",
  gender: "",
  tax_category: "",
  market_segment: "",
};

export default function CustomerCreateModal({ open, initialName = "", onClose, onCreated }) {
  const [form, setForm] = useState({ ...EMPTY, customer_name: initialName });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setForm({ ...EMPTY, customer_name: initialName });
    setErr("");
    let cancelled = false;
    (async () => {
      try {
        const res = await links.getCustomerCreateDefaults();
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          customer_group: res?.customer_group || "",
          territory: res?.territory || "",
          default_currency: res?.default_currency || "",
        }));
      } catch {
        /* defaults optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialName]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit() {
    const name = form.customer_name.trim();
    if (!name) {
      setErr("Customer name is required");
      return;
    }
    if (!form.customer_group?.trim()) {
      setErr("Customer group is required");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const payload = {
        customer_name: name,
        customer_type: form.customer_type,
        customer_group: form.customer_group.trim(),
        territory: form.territory?.trim() || undefined,
        tax_id: form.tax_id?.trim() || undefined,
        website: form.website?.trim() || undefined,
        email_id: form.email_id?.trim() || undefined,
        mobile_no: form.mobile_no?.trim() || undefined,
        industry: form.industry?.trim() || undefined,
        default_currency: form.default_currency?.trim() || undefined,
        salutation: form.salutation?.trim() || undefined,
        gender: form.gender?.trim() || undefined,
        tax_category: form.tax_category?.trim() || undefined,
        market_segment: form.market_segment?.trim() || undefined,
      };
      const res = await links.createCustomer(payload);
      const picked = res?.value || res?.name;
      const label = res?.label || picked;
      if (picked) {
        onCreated?.({ value: picked, label });
        onClose?.();
      }
    } catch (e) {
      setErr(e.message || "Could not create customer");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const isIndividual = form.customer_type === "Individual";

  return (
    <Modal
      wide
      title="Create new customer"
      onClose={() => !busy && onClose?.()}
      footer={
        <>
          <button type="button" className="pm-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pm-btn pm-btn-primary" disabled={busy} onClick={onSubmit} aria-busy={busy}>
            <PortalBusyButtonContent busy={busy} busyLabel="Creating…" idleLabel="Create customer" />
          </button>
        </>
      }
    >
      {err ? <div className="pm-error-banner">{err}</div> : null}

      <div className="pm-form-grid">
        <div className="pm-field pm-form-grid__full">
          <label className="pm-label">Customer name *</label>
          <input
            className="pm-input"
            value={form.customer_name}
            onChange={(e) => setField("customer_name", e.target.value)}
            placeholder="Company or person name"
            autoFocus
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Customer type *</label>
          <select
            className="pm-select"
            value={form.customer_type}
            onChange={(e) => setField("customer_type", e.target.value)}
          >
            <option value="Company">Company</option>
            <option value="Individual">Individual</option>
            <option value="Partnership">Partnership</option>
          </select>
        </div>

        <div className="pm-field">
          <label className="pm-label">Customer group *</label>
          <LinkSelect
            doctype="Customer Group"
            value={form.customer_group}
            onChange={(v) => setField("customer_group", v)}
            placeholder="Search customer group…"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Territory</label>
          <LinkSelect
            doctype="Territory"
            value={form.territory}
            onChange={(v) => setField("territory", v)}
            placeholder="Search territory…"
          />
        </div>

        {isIndividual ? (
          <>
            <div className="pm-field">
              <label className="pm-label">Salutation</label>
              <LinkSelect
                doctype="Salutation"
                value={form.salutation}
                onChange={(v) => setField("salutation", v)}
                placeholder="Mr, Ms…"
              />
            </div>
            <div className="pm-field">
              <label className="pm-label">Gender</label>
              <LinkSelect
                doctype="Gender"
                value={form.gender}
                onChange={(v) => setField("gender", v)}
                placeholder="Search gender…"
              />
            </div>
          </>
        ) : null}

        <div className="pm-field">
          <label className="pm-label">Tax ID / GSTIN</label>
          <input
            className="pm-input"
            value={form.tax_id}
            onChange={(e) => setField("tax_id", e.target.value)}
            placeholder="Tax identification number"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Tax category</label>
          <LinkSelect
            doctype="Tax Category"
            value={form.tax_category}
            onChange={(v) => setField("tax_category", v)}
            placeholder="Search tax category…"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Website</label>
          <input
            className="pm-input"
            type="url"
            value={form.website}
            onChange={(e) => setField("website", e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Email</label>
          <input
            className="pm-input"
            type="email"
            value={form.email_id}
            onChange={(e) => setField("email_id", e.target.value)}
            placeholder="contact@company.com"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Mobile</label>
          <input
            className="pm-input"
            type="tel"
            value={form.mobile_no}
            onChange={(e) => setField("mobile_no", e.target.value)}
            placeholder="+91 …"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Industry</label>
          <LinkSelect
            doctype="Industry Type"
            value={form.industry}
            onChange={(v) => setField("industry", v)}
            placeholder="Search industry…"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Market segment</label>
          <LinkSelect
            doctype="Market Segment"
            value={form.market_segment}
            onChange={(v) => setField("market_segment", v)}
            placeholder="Search segment…"
          />
        </div>

        <div className="pm-field">
          <label className="pm-label">Billing currency</label>
          <LinkSelect
            doctype="Currency"
            value={form.default_currency}
            onChange={(v) => setField("default_currency", v)}
            placeholder="INR, USD…"
          />
        </div>
      </div>
    </Modal>
  );
}
