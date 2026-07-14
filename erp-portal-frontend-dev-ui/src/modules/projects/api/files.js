import axios from "axios";
import { getCsrfToken as getPortalCsrfToken } from "../../../common/api/client.js";

function getCsrfToken() {
	return (
		getPortalCsrfToken() ||
		window.csrf_token ||
		document.cookie.match(/(?:^| )csrf_token=([^;]+)/)?.[1] ||
		document.querySelector('meta[name="csrf-token"]')?.content ||
		""
	);
}

/** Upload a file to Frappe and return the public file URL. */
export async function uploadFile(file) {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("is_private", "0");
	formData.append("folder", "Home");

	const res = await axios.post("/api/method/upload_file", formData, {
		withCredentials: true,
		headers: {
			"X-Frappe-CSRF-Token": decodeURIComponent(getCsrfToken()),
			"X-Requested-With": "XMLHttpRequest",
		},
	});

	const message = res.data?.message;
	return message?.file_url || message?.file_name || "";
}
