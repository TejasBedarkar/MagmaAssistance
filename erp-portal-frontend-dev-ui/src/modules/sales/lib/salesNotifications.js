/** Sales module notification refresh — also reloads global portal bell. */

import { PORTAL_NOTIFICATIONS_REFRESH } from "../../../common/utils/portalNotifications.js";

export const SALES_NOTIFICATIONS_REFRESH = "sales-portal-notifications-refresh";

export function refreshSalesNotifications() {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent(SALES_NOTIFICATIONS_REFRESH));
		window.dispatchEvent(new CustomEvent(PORTAL_NOTIFICATIONS_REFRESH));
	}
}
