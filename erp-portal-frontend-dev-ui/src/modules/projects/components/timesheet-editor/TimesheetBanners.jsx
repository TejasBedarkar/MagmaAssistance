export default function TimesheetBanners({
	err,
	ctx,
	teamReadOnly,
	isManager,
	isApproved,
	isRejected,
}) {
	return (
		<>
			{ctx?.help_text ? <p className="pm-page-desc pm-page-desc--tight">{ctx.help_text}</p> : null}
			{err ? <div className="pm-error-banner">{err}</div> : null}
			{teamReadOnly ? (
				<div className="pm-info-banner">
					This timesheet is approved and cannot be edited. Contact your program manager if a change is
					needed.
				</div>
			) : null}
			{isManager && isApproved ? (
				<div className="pm-info-banner">
					This timesheet is already approved. Approve/Reject are only for submitted entries.
				</div>
			) : null}
			{!isManager && isRejected ? (
				<div className="pm-warn-banner">
					This timesheet was rejected. Update the details below and resubmit for manager approval.
				</div>
			) : null}
		</>
	);
}
