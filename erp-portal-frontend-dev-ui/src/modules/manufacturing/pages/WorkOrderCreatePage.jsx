import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Save } from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import { workOrders } from '@/api';
import { mfgPath } from '../paths.js';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import { MfgButton, MfgPage } from '@/components/MfgPageLayout.jsx';

const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'];

const emptyBomRow = () => ({ item_code: '', item_name: '', required_qty: 1 });

export default function WorkOrderCreatePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    customer: '',
    item_code: '',
    qty: 1,
    expected_delivery_date: '',
    priority: 'Medium',
  });
  const [bomItems, setBomItems] = useState([emptyBomRow()]);
  const [saving, setSaving] = useState(false);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const updateBom = (idx, key, value) => {
    setBomItems((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const items = bomItems
        .filter((row) => String(row.item_code || '').trim())
        .map((row) => ({
          item_code: row.item_code.trim(),
          item_name: (row.item_name || '').trim() || undefined,
          required_qty: Number(row.required_qty) || 0,
        }));

      const res = await workOrders.create({
        ...form,
        ...(items.length ? { items } : {}),
      });
      toast.success(`Created ${res.name}`);
      navigate(mfgPath(`/work-orders/${res.name}`));
    } catch {
      // toasted by interceptor
    } finally {
      setSaving(false);
    }
  };

  return (
    <MfgPage className="mfg-wo-create">
      <div className="mfg-wo-create__inner">
        <Link to={mfgPath('/work-orders')} className="mfg-wo-back">
          <ArrowLeft size={16} /> Back to Work Orders
        </Link>

        <header className="mfg-wo-create__header">
          <h1>New Work Order</h1>
          <p>
            Create a work order and define BOM items. Store Keeper will only fill available stock later.
          </p>
        </header>

        <form onSubmit={submit} className="card mfg-wo-create-form">
          <div className="mfg-wo-create-form__fields">
            <Field label="Customer" required>
              <input
                className="pm-input"
                value={form.customer}
                onChange={(e) => update('customer', e.target.value)}
                placeholder="e.g. ACME Manufacturing Pvt Ltd"
                required
              />
            </Field>

            <Field label="Deliverable" required>
              <input
                className="pm-input"
                value={form.item_code}
                onChange={(e) => update('item_code', e.target.value)}
                placeholder="e.g. GEAR-SHAFT-450"
                required
              />
            </Field>

            <Field label="Quantity" required>
              <input
                type="number"
                min="1"
                className="pm-input"
                value={form.qty}
                onChange={(e) => update('qty', Number(e.target.value))}
                required
              />
            </Field>

            <Field label="Priority">
              <MfgCombobox
                value={form.priority}
                onChange={(priority) => update('priority', priority)}
                options={PRIORITY_OPTIONS}
                placeholder="Select priority…"
              />
            </Field>

            <div className="mfg-wo-create-form__field--date">
              <Field label="Expected Delivery Date" required>
                <input
                  type="date"
                  className="pm-input mfg-wo-modal-form__date"
                  value={form.expected_delivery_date}
                  onChange={(e) => update('expected_delivery_date', e.target.value)}
                  required
                />
              </Field>
            </div>
          </div>

          <section className="mfg-wo-create-form__bom">
            <div className="mfg-wo-create-form__bom-head">
              <h2>BOM / Raw Materials</h2>
              <p>These items auto-fill when Store Keeper creates a material check.</p>
            </div>

            <div className="mfg-wo-create-form__bom-panel">
              <div
                className="mfg-material-check-form__head mfg-material-check-form__head--3col mfg-wo-create-form__bom-panel-head"
                aria-hidden="true"
              >
                <span>Item code</span>
                <span>Name (optional)</span>
                <span className="mfg-wo-create-form__qty-label">Required qty</span>
              </div>
              <div className="mfg-wo-create-form__bom-scroll">
                {bomItems.map((row, idx) => (
                  <div
                    key={idx}
                    className="mfg-material-check-form__row mfg-material-check-form__row--3col mfg-wo-create-form__bom-row"
                  >
                    <input
                      className="pm-input"
                      placeholder="e.g. RM-GEAR-01"
                      value={row.item_code}
                      onChange={(e) => updateBom(idx, 'item_code', e.target.value)}
                      aria-label={`Item code row ${idx + 1}`}
                    />
                    <input
                      className="pm-input"
                      placeholder="Description"
                      value={row.item_name}
                      onChange={(e) => updateBom(idx, 'item_name', e.target.value)}
                      aria-label={`Item name row ${idx + 1}`}
                    />
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="pm-input mfg-wo-create-form__qty-input"
                      value={row.required_qty}
                      onChange={(e) => updateBom(idx, 'required_qty', Number(e.target.value))}
                      aria-label={`Required qty row ${idx + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <MfgButton
              type="button"
              variant="secondary"
              size="sm"
              className="mfg-material-check-form__add"
              onClick={() => setBomItems([...bomItems, emptyBomRow()])}
            >
              <Plus size={14} aria-hidden /> Add material
            </MfgButton>
          </section>

          <div className="mfg-wo-create-form__footer">
            <MfgButton type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </MfgButton>
            <MfgButton type="submit" variant="primary" disabled={saving}>
              <Save size={16} aria-hidden />
              {saving ? 'Creating…' : 'Create Work Order'}
            </MfgButton>
          </div>
        </form>
      </div>
    </MfgPage>
  );
}
