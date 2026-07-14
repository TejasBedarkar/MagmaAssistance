import React from "react";
import { Link, useParams } from "react-router-dom";
import ProjectPageLoader from "../components/ProjectPageLoader.jsx";
import TimesheetBanners from "../components/timesheet-editor/TimesheetBanners.jsx";
import TimesheetForm from "../components/timesheet-editor/TimesheetForm.jsx";
import useTimesheetEditor from "../hooks/useTimesheetEditor.js";

export default function TimesheetEditor() {
	const { id } = useParams();
	const editor = useTimesheetEditor(id);

	if (editor.loading) {
		return <ProjectPageLoader message="Loading timesheet…" />;
	}

	return (
		<div className="pm-page pm-form-page">
			<div className="pm-form-page__head">
				<Link to="/timesheets" className="pm-back-link">
					← Timesheets
				</Link>
			</div>

			<TimesheetBanners
				err={editor.err}
				ctx={editor.ctx}
				teamReadOnly={editor.teamReadOnly}
				isManager={editor.isManager}
				isApproved={editor.isApproved}
				isRejected={editor.isRejected}
			/>

			<TimesheetForm {...editor} />
		</div>
	);
}
