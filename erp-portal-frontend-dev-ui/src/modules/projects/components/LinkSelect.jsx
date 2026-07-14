import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { links } from "../api/index.js";
import CustomerCreateModal from "./CustomerCreateModal.jsx";
import { PortalInlineLoader } from "../../../common/components/PortalSpinner.jsx";

function displayLabel(label, value) {
  const raw = (label || value || "").trim();
  if (!raw) return value || "";
  return raw.replace(/<[^>]+>/g, "").trim();
}

/**
 * Frappe Link field picker (Customer, Cost Center, etc.) via search_link_options API.
 * Dropdown renders in a portal with fixed positioning so it does not overlap grid fields below.
 */
export default function LinkSelect({
  doctype,
  value,
  onChange,
  required,
  readOnly,
  placeholder = "Search…",
  id,
  allowCreate = false,
  createLabel = "Create new customer",
}) {
  const anchorRef = useRef(null);
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialName, setCreateInitialName] = useState("");

  const search = useCallback(
    async (txt) => {
      if (readOnly) return;
      setLoadErr("");
      setLoading(true);
      try {
        const list = await links.searchOptions(doctype, txt || "", 25);
        setOptions(Array.isArray(list) ? list : []);
      } catch (e) {
        setOptions([]);
        setLoadErr(e.message || "Could not load options");
      } finally {
        setLoading(false);
      }
    },
    [doctype, readOnly]
  );

  const updateMenuPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setMenuRect({
      top: r.bottom + 4,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return undefined;
    }
    updateMenuPosition();
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open, updateMenuPosition, options.length]);

  useEffect(() => {
    if (!readOnly && open) {
      const t = setTimeout(() => search(query), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [query, open, readOnly, search]);

  useEffect(() => {
    if (readOnly || !value || options.some((o) => o.value === value)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await links.getDisplayLabel(doctype, value, { silent: true });
        if (!cancelled && res?.label) {
          setOptions((prev) => [{ value, label: res.label }, ...prev.filter((o) => o.value !== value)]);
        }
      } catch {
        if (!cancelled) {
          setOptions((prev) => [{ value, label: value }, ...prev.filter((o) => o.value !== value)]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, doctype, options, readOnly]);

  function openCreateModal() {
    setCreateInitialName(query.trim());
    setCreateOpen(true);
    setOpen(false);
  }

  function onCustomerCreated({ value: picked, label }) {
    if (picked) {
      setOptions((prev) => {
        const rest = prev.filter((o) => o.value !== picked);
        return [{ value: picked, label }, ...rest];
      });
      onChange(picked);
      setQuery("");
    }
  }

  if (readOnly) {
    return <input className="pm-input" id={id} value={value || "—"} readOnly />;
  }

  const selectedLabel = displayLabel(options.find((o) => o.value === value)?.label, value);
  const showList = open && (options.length > 0 || allowCreate);
  const showCreateRow = allowCreate && open && doctype === "Customer";

  const dropdown =
    showList && menuRect
      ? createPortal(
          <ul
            className="pm-link-select__list pm-link-select__list--portal"
            role="listbox"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              zIndex: 10000,
            }}
          >
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className="pm-link-select__option"
                  title={displayLabel(o.label, o.value)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(o.value);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="pm-link-select__option-text">{displayLabel(o.label, o.value)}</span>
                </button>
              </li>
            ))}
            {showCreateRow ? (
              <li className="pm-link-select__create">
                <button
                  type="button"
                  className="pm-link-select__option pm-link-select__option--create"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openCreateModal}
                >
                  <span className="pm-link-select__option-text">
                    + {createLabel}
                    {query.trim() ? ` “${query.trim()}”` : ""}
                  </span>
                </button>
              </li>
            ) : null}
          </ul>,
          document.body
        )
      : null;

  return (
    <>
      <div ref={anchorRef} className={`pm-link-select${open ? " pm-link-select--open" : ""}`}>
        <div className="pm-link-select__field">
          <input
            id={id}
            className="pm-input"
            required={required && !value}
            value={open ? query : selectedLabel}
            placeholder={loading ? "Searching…" : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              if (!e.target.value) onChange("");
            }}
            onFocus={() => {
              setOpen(true);
              search(query);
            }}
            onBlur={() => {
              setTimeout(() => setOpen(false), 200);
            }}
            autoComplete="off"
          />
          {loading ? (
            <span className="pm-link-select__spinner" aria-hidden>
              <PortalInlineLoader size="xs" />
            </span>
          ) : null}
        </div>
        {loadErr ? <p className="pm-link-select__err">{loadErr}</p> : null}
      </div>
      {dropdown}

      {allowCreate && doctype === "Customer" ? (
        <CustomerCreateModal
          open={createOpen}
          initialName={createInitialName}
          onClose={() => setCreateOpen(false)}
          onCreated={onCustomerCreated}
        />
      ) : null}
    </>
  );
}
