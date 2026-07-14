import {
  PortalInlineLoader,
  PortalPageLoader,
} from '../../../common/components/PortalSpinner.jsx';

function normalizeInlineSize(size) {
  if (typeof size === 'string' && ['xs', 'sm', 'md', 'lg'].includes(size)) {
    return size;
  }
  const n = Number(size);
  if (Number.isNaN(n)) return 'sm';
  if (n <= 14) return 'xs';
  if (n <= 18) return 'sm';
  if (n <= 24) return 'md';
  return 'lg';
}

/** Centered loading placeholder for manufacturing lists, editors, and panels. */
export default function MfgPageLoader({ label = 'Loading…', className = '', minHeight }) {
  return (
    <PortalPageLoader
      message={label}
      className={['mfg-page-loader', className].filter(Boolean).join(' ')}
      minHeight={minHeight}
    />
  );
}

export function MfgInlineLoader({ size = 'sm', className = '', label }) {
  if (label) {
    return (
      <PortalPageLoader
        message={label}
        className={['mfg-page-loader', className].filter(Boolean).join(' ')}
        minHeight={120}
      />
    );
  }

  return (
    <PortalInlineLoader
      size={normalizeInlineSize(size)}
      className={className}
    />
  );
}

export function PageLoader(props) {
  return <MfgPageLoader {...props} />;
}

export function InlineLoader(props) {
  return <MfgInlineLoader {...props} />;
}
