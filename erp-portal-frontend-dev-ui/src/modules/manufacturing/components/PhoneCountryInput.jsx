import { useMemo } from 'react';

export const PHONE_COUNTRIES = [
  { code: '+91', flag: '🇮🇳', label: 'India' },
  { code: '+1', flag: '🇺🇸', label: 'USA' },
  { code: '+44', flag: '🇬🇧', label: 'UK' },
  { code: '+971', flag: '🇦🇪', label: 'UAE' },
  { code: '+65', flag: '🇸🇬', label: 'Singapore' },
  { code: '+61', flag: '🇦🇺', label: 'Australia' },
  { code: '+49', flag: '🇩🇪', label: 'Germany' },
  { code: '+81', flag: '🇯🇵', label: 'Japan' },
];

export function parseDriverPhone(value) {
  const raw = (value || '').trim();
  if (!raw) return { countryCode: '+91', local: '' };

  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const match = sorted.find((c) => raw.startsWith(c.code));
  if (match) {
    const local = raw.slice(match.code.length).replace(/\D/g, '');
    return { countryCode: match.code, local };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return { countryCode: '+91', local: digits.slice(2) };
  }
  if (digits.length === 10) {
    return { countryCode: '+91', local: digits };
  }
  return { countryCode: '+91', local: digits };
}

export function formatDriverPhone(countryCode, local) {
  const digits = (local || '').replace(/\D/g, '');
  if (!digits) return '';
  return `${countryCode} ${digits}`;
}

/**
 * Phone input with country code dropdown (default India +91).
 */
export default function PhoneCountryInput({ value, onChange, placeholder = '9876543210', disabled = false }) {
  const { countryCode, local } = useMemo(() => parseDriverPhone(value), [value]);

  const update = (nextCode, nextLocal) => {
    onChange(formatDriverPhone(nextCode, nextLocal));
  };

  return (
    <div className="mfg-phone-input">
      <select
        className="pm-input mfg-phone-input__code"
        value={countryCode}
        disabled={disabled}
        onChange={(e) => update(e.target.value, local)}
        aria-label="Country code"
      >
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.code} {c.label}
          </option>
        ))}
      </select>
      <input
        type="tel"
        className="pm-input mfg-phone-input__number"
        placeholder={placeholder}
        value={local}
        disabled={disabled}
        maxLength={15}
        onChange={(e) => update(countryCode, e.target.value.replace(/\D/g, ''))}
      />
    </div>
  );
}
