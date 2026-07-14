import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HiOutlineChevronDown } from 'react-icons/hi2';

export default function MfgCombobox({
  value,
  onChange,
  options = [],
  items = null,
  placeholder = 'Select or type…',
  id,
  disabled = false,
  maxMenuHeight = 200,
  placement = 'below',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const pendingPickRef = useRef(null);

  const useItems = items != null;

  const entries = useMemo(() => {
    if (useItems) return items;
    return options.map((opt) => ({ value: opt, label: String(opt) }));
  }, [items, options, useItems]);

  const selected = useMemo(
    () => entries.find((entry) => entry.value === value),
    [entries, value],
  );

  useEffect(() => {
    if (open) return;
    if (pendingPickRef.current != null) {
      if (value === pendingPickRef.current) pendingPickRef.current = null;
      return;
    }
    setQuery(useItems ? (selected?.label || '') : (value || ''));
  }, [selected, open, useItems, value]);

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const selectedLabel = String(selected?.label || '').trim().toLowerCase();
    // When the input still matches the current selection, show the full list (picker open).
    if (!q || q === selectedLabel) return entries;
    return entries.filter((entry) => entry.label.toLowerCase().includes(q));
  }, [entries, query, selected]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) {
      setMenuStyle(null);
      return undefined;
    }

    const updatePosition = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;

      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const shouldOpenAbove = placement === 'above'
        || (placement === 'auto' && spaceBelow < maxMenuHeight && spaceAbove > spaceBelow);
      const available = shouldOpenAbove ? spaceAbove : spaceBelow;
      const height = Math.min(maxMenuHeight, Math.max(120, available));

      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        maxHeight: height,
        zIndex: 1100,
        ...(shouldOpenAbove
          ? { bottom: window.innerHeight - rect.top + 2 }
          : { top: rect.bottom + 2 }),
      });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, filtered.length, maxMenuHeight, placement]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (entry) => {
    pendingPickRef.current = entry.value;
    setQuery(entry.label);
    onChange(entry.value);
    setOpen(false);
  };

  const onInput = (e) => {
    const next = e.target.value;
    setQuery(next);
    if (useItems) {
      const exact = entries.find(
        (entry) => entry.label.toLowerCase() === next.trim().toLowerCase(),
      );
      onChange(exact ? exact.value : '');
    } else {
      onChange(next);
    }
    setOpen(true);
  };

  return (
    <div className="mfg-combobox" ref={wrapRef}>
      <div className="mfg-combobox__control">
        <input
          id={id}
          type="text"
          className="pm-input mfg-combobox__input"
          placeholder={placeholder}
          value={query}
          title={query || placeholder}
          onChange={onInput}
          onFocus={() => !disabled && setOpen(true)}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <button
          type="button"
          className="mfg-combobox__toggle"
          onClick={() => !disabled && setOpen((prev) => !prev)}
          aria-label="Show options"
          tabIndex={-1}
          disabled={disabled}
        >
          <HiOutlineChevronDown size={16} aria-hidden />
        </button>
      </div>
      {open && filtered.length > 0 && menuStyle
        ? createPortal(
          <ul
            ref={menuRef}
            className="mfg-combobox__menu mfg-combobox__menu--portal"
            role="listbox"
            style={menuStyle}
          >
            {filtered.map((entry) => (
              <li key={entry.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.value === value}
                  className={`mfg-combobox__option${entry.value === value ? ' is-selected' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(entry);
                  }}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
        : null}
    </div>
  );
}
