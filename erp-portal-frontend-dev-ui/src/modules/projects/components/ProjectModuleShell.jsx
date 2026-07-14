import { Outlet } from "react-router-dom";

/** Wraps PM routes — scopes theme vars under .projects-module-root */
export default function ProjectModuleShell() {
	return <div className="projects-module-root"><Outlet /></div>;
}
