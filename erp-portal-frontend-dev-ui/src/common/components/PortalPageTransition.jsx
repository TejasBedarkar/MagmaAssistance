import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

function shouldSkipPageEnter(pathname) {
	return pathname.includes("/tasks/board") || pathname.includes("/delivery");
}

/** Resets main scroll and applies a quick enter transition on route change (app-wide, SCM-aligned). */
export default function PortalPageTransition({ scrollRef }) {
	const { pathname } = useLocation();

	useEffect(() => {
		const el = scrollRef?.current;
		if (el) {
			el.scrollTo({ top: 0, behavior: "instant" });
		}
	}, [pathname, scrollRef]);

	const skipEnter = shouldSkipPageEnter(pathname);

	return (
		<div key={pathname} className={skipEnter ? undefined : "pm-page-enter"}>
			<Outlet />
		</div>
	);
}
