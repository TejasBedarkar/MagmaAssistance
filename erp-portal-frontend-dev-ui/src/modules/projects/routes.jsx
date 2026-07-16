import "./theme/projectsModule.css";
import "./theme/pages/index.css";
import React from "react";
import { Route } from "react-router-dom";
import ManagerOnlyNew from "./components/ManagerOnlyNew.jsx";
import ProjectModuleShell from "./components/ProjectModuleShell.jsx";
import ProjectDeliveryPage from "./pages/ProjectDeliveryPage.jsx";
import PortalHomeRedirect from "../../common/components/PortalHomeRedirect.jsx";
import ProjectsList from "./pages/ProjectsList.jsx";
import ProjectEditor from "./pages/ProjectEditor.jsx";
import TasksList from "./pages/TasksList.jsx";
import TasksLayout from "./pages/TasksLayout.jsx";
import TasksBoard from "./pages/TasksBoard.jsx";
import TasksCalendar from "./pages/TasksCalendar.jsx";
import TaskEditor from "./pages/TaskEditor.jsx";
import TimesheetsList from "./pages/TimesheetsList.jsx";
import TimesheetEditor from "./pages/TimesheetEditor.jsx";
import MilestonesList from "./pages/MilestonesList.jsx";
import MilestoneEditor from "./pages/MilestoneEditor.jsx";
import TeamAssignments from "./pages/TeamAssignments.jsx";
import MyDay from "./pages/MyDay.jsx";
import TeamOnlyRoute from "./components/TeamOnlyRoute.jsx";
import DeliveryOrManagerRoute from "./components/DeliveryOrManagerRoute.jsx";

/** Project Management routes — same URLs as before refactor. */
export function ProjectRoutes() {
	return (
		<Route element={<ProjectModuleShell />}>
			<Route index element={<PortalHomeRedirect />} />
			<Route
				path="my-day"
				element={
					<TeamOnlyRoute>
						<MyDay />
					</TeamOnlyRoute>
				}
			/>
			<Route path="projects" element={<ProjectsList />} />
			<Route path="projects/:id/delivery" element={<ProjectDeliveryPage />} />
			<Route
				path="projects/:id"
				element={
					<ManagerOnlyNew redirectTo="/projects">
						<ProjectEditor />
					</ManagerOnlyNew>
				}
			/>
			<Route
				path="team"
				element={
					<DeliveryOrManagerRoute>
						<TeamAssignments />
					</DeliveryOrManagerRoute>
				}
			/>
			<Route path="tasks" element={<TasksLayout />}>
				<Route index element={<TasksList />} />
				<Route path="board" element={<TasksBoard />} />
				<Route path="calendar" element={<TasksCalendar />} />
			</Route>
			<Route
				path="tasks/:id"
				element={
					<ManagerOnlyNew redirectTo="/tasks">
						<TaskEditor />
					</ManagerOnlyNew>
				}
			/>
			<Route
				path="timesheets"
				element={
					<DeliveryOrManagerRoute>
						<TimesheetsList />
					</DeliveryOrManagerRoute>
				}
			/>
			<Route
				path="timesheets/:id"
				element={
					<DeliveryOrManagerRoute>
						<TimesheetEditor />
					</DeliveryOrManagerRoute>
				}
			/>
			<Route path="milestones" element={<MilestonesList />} />
			<Route
				path="milestones/:id"
				element={
					<ManagerOnlyNew redirectTo="/milestones">
						<MilestoneEditor />
					</ManagerOnlyNew>
				}
			/>
		</Route>
	);
}
