import { pmCall, pmCallGet, pmMethodGetUrl } from "./pmCall.js";

export const links = {
	getDisplayLabel: (doctype, name, options) =>
		pmCallGet(pmMethodGetUrl("get_link_display_label", { doctype, name }), options),
	searchOptions: (doctype, txt = "", limit = 20) =>
		pmCallGet(pmMethodGetUrl("search_link_options", { doctype, txt, limit })),
	getCustomerCreateDefaults: () => pmCallGet(pmMethodGetUrl("get_portal_customer_create_defaults")),
	createCustomer: (payload) => pmCall("create_portal_customer", payload),
};
