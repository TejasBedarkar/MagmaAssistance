export const PORTAL_NOTIFICATIONS_REFRESH = "pm-portal-notifications-refresh";

export function refreshPortalNotifications() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PORTAL_NOTIFICATIONS_REFRESH));
  }
}
