import { useAuth } from "../../../common/context/AuthContext.jsx";

/**
 * PM module auth — thin wrapper over common AuthContext.
 * Pages and route guards should prefer this hook for consistent PM flags.
 */
export default function useProjectAuth() {
	const auth = useAuth();
	const {
		user,
		fullName,
		roles,
		isManager,
		isAdministrator,
		isProgramManager,
		isDeveloper,
		isTester,
		isBusinessAnalyst,
		isDeliveryMember,
		designation,
		employeeId,
		department,
		company,
		canEditBudget,
		canEditStartDate,
		canDeleteProject,
		loading,
		error,
		refreshSession,
		login,
		logout,
	} = auth;

	return {
		user,
		fullName,
		roles,
		isManager,
		isAdministrator,
		isProgramManager,
		isDeveloper,
		isTester,
		isBusinessAnalyst,
		isDeliveryMember,
		designation,
		employeeId,
		department,
		company,
		canEditBudget,
		canEditStartDate,
		canDeleteProject,
		loading,
		error,
		refreshSession,
		login,
		logout,
		canManagePrograms: isProgramManager || isAdministrator,
		/** Developer / Tester delivery workflows. */
		isTeamMember: isDeliveryMember,
		canAccessMyDay: isDeliveryMember,
	};
}
