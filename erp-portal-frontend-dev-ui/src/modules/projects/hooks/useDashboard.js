import { useCallback, useEffect, useState } from "react";
import { dashboard } from "../api/index.js";
import useProjectAuth from "./useProjectAuth.js";

export default function useDashboard() {
	const { isManager, isAdministrator, isBusinessAnalyst, isDeliveryMember, refreshSession } =
		useProjectAuth();
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState("");
	const [updated, setUpdated] = useState("");
	const [extendTask, setExtendTask] = useState(null);
	const [extendDate, setExtendDate] = useState("");
	const [extendNote, setExtendNote] = useState("");
	const [reassignTask, setReassignTask] = useState(null);
	const [reassignNote, setReassignNote] = useState("");
	const [actionBusy, setActionBusy] = useState(false);
	const [actionBusyId, setActionBusyId] = useState("");

	const load = useCallback(async () => {
		setErr("");
		setLoading(true);
		try {
			await refreshSession();
			const d = await dashboard.getData();
			setData(d);
			setUpdated(new Date().toLocaleString());
		} catch (e) {
			setErr(e.message || "Failed to load dashboard");
		} finally {
			setLoading(false);
		}
	}, [refreshSession]);

	useEffect(() => {
		load();
	}, [load]);

	async function onExtend() {
		if (!extendTask || !extendDate || !extendNote.trim()) return;
		setActionBusyId(extendTask.name);
		setActionBusy(true);
		try {
			await dashboard.extendTaskDeadline(extendTask.name, extendDate, extendNote.trim());
			setExtendTask(null);
			setExtendDate("");
			setExtendNote("");
			await load();
		} catch (e) {
			setErr(e.message || "Extend failed");
		} finally {
			setActionBusy(false);
			setActionBusyId("");
		}
	}

	async function onReassign() {
		if (!reassignTask || !reassignNote.trim()) return;
		setActionBusyId(reassignTask.name);
		setActionBusy(true);
		try {
			await dashboard.reassignTaskToManager(reassignTask.name, reassignNote.trim());
			setReassignTask(null);
			setReassignNote("");
			await load();
		} catch (e) {
			setErr(e.message || "Reassign failed");
		} finally {
			setActionBusy(false);
			setActionBusyId("");
		}
	}

	async function onComplete(taskName) {
		if (!window.confirm("Mark this task as completed? Approved timesheet may be required.")) return;
		setActionBusyId(taskName);
		setActionBusy(true);
		try {
			await dashboard.completeTask(taskName);
			await load();
		} catch (e) {
			setErr(e.message || "Complete failed");
		} finally {
			setActionBusy(false);
			setActionBusyId("");
		}
	}

	return {
		isManager,
		isAdministrator,
		isBusinessAnalyst,
		isDeliveryMember,
		data,
		loading,
		err,
		updated,
		load,
		extendTask,
		setExtendTask,
		extendDate,
		setExtendDate,
		extendNote,
		setExtendNote,
		reassignTask,
		setReassignTask,
		reassignNote,
		setReassignNote,
		actionBusy,
		actionBusyId,
		onExtend,
		onReassign,
		onComplete,
	};
}
