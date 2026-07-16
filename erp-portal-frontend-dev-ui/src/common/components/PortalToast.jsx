import {
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineInformationCircle,
  HiOutlineXCircle,
  HiOutlineXMark,
} from "react-icons/hi2";
import { Toaster, toast } from "react-hot-toast";
import "../styles/portalToast.css";

const ICONS = {
  success: HiOutlineCheckCircle,
  error: HiOutlineXCircle,
  warn: HiOutlineExclamationTriangle,
  info: HiOutlineInformationCircle,
};

function normalizeType(type) {
  if (type === "warning") return "warn";
  if (type === "success" || type === "error" || type === "warn" || type === "info") return type;
  return "success";
}

function toastIdFor(message, type) {
  const text = String(message || "").trim().slice(0, 160);
  return `portal-${type}-${text}`;
}

function PortalToastMessage({ t, message, type }) {
  const tone = normalizeType(type);
  const Icon = ICONS[tone] || ICONS.success;

  return (
    <div
      className={`portal-toast${t.visible ? " portal-toast--visible" : " portal-toast--hidden"} portal-toast--${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="portal-toast__icon" aria-hidden>
        <Icon className="portal-toast__icon-svg" />
      </span>
      <span className="portal-toast__msg">{message}</span>
      <button
        type="button"
        className="portal-toast__close"
        onClick={() => toast.dismiss(t.id)}
        aria-label="Dismiss"
      >
        <HiOutlineXMark className="portal-toast__close-icon" aria-hidden />
      </button>
    </div>
  );
}

/** Imperative toast — use from any module: `showPortalToast("Saved", "success")` */
export function showPortalToast(message, type = "success", durationMs = 3600) {
  if (!message) return;
  const tone = normalizeType(type);
  const id = toastIdFor(message, tone);

  toast.custom((t) => <PortalToastMessage t={t} message={String(message)} type={tone} />, {
    id,
    duration: durationMs,
  });
}

/** Mount once in Layout — shared portal toaster for all modules. */
export default function PortalToaster() {
  return (
    <Toaster
      position="bottom-right"
      gutter={10}
      containerClassName="portal-toast-container"
      containerStyle={{ zIndex: 10050 }}
    />
  );
}
