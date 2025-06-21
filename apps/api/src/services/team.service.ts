import { dbManager } from "@user-service/database";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { logger } from "../lib/logger";

export interface CreateTeamDto {
	name: string;
	description?: string;
	permissions?: string[];
}

export interface UpdateTeamDto {
	name?: string;
	description?: string;
	permissions?: string[];
}

export class TeamService {
	async createTeam(
		orgId: string,
		userId: string,
		tenantId: string,
		data: CreateTeamDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check user permissions
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
			throw new ForbiddenError("Only owners and admins can create teams");
		}

		// Check if team name already exists in org
		const existingTeam = await db.team.findUnique({
			where: {
				orgId_name: {
					orgId,
					name: data.name,
				},
			},
		});

		if (existingTeam) {
			throw new ConflictError("Team name already exists in this organization");
		}

		// Create team
		const team = await db.team.create({
			data: {
				orgId,
				name: data.name,
				description: data.description,
				permissions: data.permissions || [],
			},
		});

		// Log creation
		await db.auditLog.create({
			data: {
				userId,
				action: "team.created",
				resource: "team",
				resourceId: team.id,
				metadata: {
					orgId,
					name: team.name,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return team;
	}

	async getTeam(teamId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const team = await db.team.findUnique({
			where: { id: teamId },
			include: {
				organization: true,
				members: {
					include: {
						member: {
							include: {
								user: {
									select: {
										id: true,
										email: true,
										profile: true,
									},
								},
							},
						},
					},
				},
				_count: {
					select: {
						members: true,
					},
				},
			},
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check if user is a member of the organization
		const orgMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!orgMember) {
			throw new ForbiddenError("You are not a member of this organization");
		}

		return team;
	}

	async listTeams(orgId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Check if user is a member
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!member) {
			throw new ForbiddenError("You are not a member of this organization");
		}

		const teams = await db.team.findMany({
			where: { orgId },
			include: {
				_count: {
					select: {
						members: true,
					},
				},
			},
			orderBy: {
				name: "asc",
			},
		});

		// Include user's membership status for each team
		const userTeamMemberships = await db.teamMember.findMany({
			where: {
				memberId: member.id,
				team: {
					orgId,
				},
			},
			select: {
				teamId: true,
				role: true,
			},
		});

		const membershipMap = new Map(
			userTeamMemberships.map((m) => [m.teamId, m]),
		);

		return teams.map((team) => ({
			...team,
			isMember: membershipMap.has(team.id),
			memberRole: membershipMap.get(team.id)?.role,
		}));
	}

	async updateTeam(
		teamId: string,
		userId: string,
		tenantId: string,
		data: UpdateTeamDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get team
		const team = await db.team.findUnique({
			where: { id: teamId },
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check permissions
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
			throw new ForbiddenError("Only owners and admins can update teams");
		}

		// Check name uniqueness if updating
		if (data.name && data.name !== team.name) {
			const existingTeam = await db.team.findUnique({
				where: {
					orgId_name: {
						orgId: team.orgId,
						name: data.name,
					},
				},
			});

			if (existingTeam) {
				throw new ConflictError(
					"Team name already exists in this organization",
				);
			}
		}

		// Update team
		const updatedTeam = await db.team.update({
			where: { id: teamId },
			data: {
				name: data.name,
				description: data.description,
				permissions: data.permissions,
			},
		});

		// Log update
		await db.auditLog.create({
			data: {
				userId,
				action: "team.updated",
				resource: "team",
				resourceId: teamId,
				metadata: { changes: data },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return updatedTeam;
	}

	async deleteTeam(teamId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Get team
		const team = await db.team.findUnique({
			where: { id: teamId },
			include: {
				_count: {
					select: {
						members: true,
					},
				},
			},
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check permissions
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
			throw new ForbiddenError("Only owners and admins can delete teams");
		}

		// Delete team (cascades to team members)
		await db.team.delete({
			where: { id: teamId },
		});

		// Log deletion
		await db.auditLog.create({
			data: {
				userId,
				action: "team.deleted",
				resource: "team",
				resourceId: teamId,
				metadata: {
					name: team.name,
					memberCount: team._count.members,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	// Team member management
	async addTeamMember(
		teamId: string,
		memberEmail: string,
		role: string,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get team
		const team = await db.team.findUnique({
			where: { id: teamId },
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check permissions
		const currentMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!currentMember || !["OWNER", "ADMIN"].includes(currentMember.role)) {
			throw new ForbiddenError("Only owners and admins can add team members");
		}

		// Find user by email
		const user = await db.user.findUnique({
			where: { email: memberEmail },
		});

		if (!user) {
			throw new NotFoundError("User with this email not found");
		}

		// Check if user is an organization member
		const orgMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId: user.id,
					orgId: team.orgId,
				},
			},
		});

		if (!orgMember) {
			throw new ValidationError("User must be an organization member first");
		}

		// Check if already a team member
		const existingMember = await db.teamMember.findUnique({
			where: {
				teamId_memberId: {
					teamId,
					memberId: orgMember.id,
				},
			},
		});

		if (existingMember) {
			throw new ConflictError("User is already a member of this team");
		}

		// Add team member
		const teamMember = await db.teamMember.create({
			data: {
				teamId,
				memberId: orgMember.id,
				role: role || "member",
			},
			include: {
				member: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
								profile: true,
							},
						},
					},
				},
			},
		});

		// Log addition
		await db.auditLog.create({
			data: {
				userId,
				action: "team.member_added",
				resource: "team",
				resourceId: teamId,
				metadata: {
					memberId: user.id,
					email: user.email,
					role,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return teamMember;
	}

	async updateTeamMemberRole(
		teamId: string,
		memberId: string,
		role: string,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get team
		const team = await db.team.findUnique({
			where: { id: teamId },
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check permissions
		const currentMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!currentMember || !["OWNER", "ADMIN"].includes(currentMember.role)) {
			throw new ForbiddenError(
				"Only owners and admins can update team member roles",
			);
		}

		// Update role
		const teamMember = await db.teamMember.update({
			where: {
				teamId_memberId: {
					teamId,
					memberId,
				},
			},
			data: { role },
			include: {
				member: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
								profile: true,
							},
						},
					},
				},
			},
		});

		// Log update
		await db.auditLog.create({
			data: {
				userId,
				action: "team.member_role_updated",
				resource: "team",
				resourceId: teamId,
				metadata: {
					memberId,
					newRole: role,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return teamMember;
	}

	async removeTeamMember(
		teamId: string,
		memberId: string,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get team
		const team = await db.team.findUnique({
			where: { id: teamId },
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check permissions
		const currentMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!currentMember || !["OWNER", "ADMIN"].includes(currentMember.role)) {
			throw new ForbiddenError(
				"Only owners and admins can remove team members",
			);
		}

		// Remove team member
		await db.teamMember.delete({
			where: {
				teamId_memberId: {
					teamId,
					memberId,
				},
			},
		});

		// Log removal
		await db.auditLog.create({
			data: {
				userId,
				action: "team.member_removed",
				resource: "team",
				resourceId: teamId,
				metadata: { memberId },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	async listTeamMembers(teamId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Get team and verify access
		const team = await db.team.findUnique({
			where: { id: teamId },
		});

		if (!team) {
			throw new NotFoundError("Team");
		}

		// Check if user is an org member
		const orgMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId: team.orgId,
				},
			},
		});

		if (!orgMember) {
			throw new ForbiddenError("You are not a member of this organization");
		}

		// Get team members
		const members = await db.teamMember.findMany({
			where: { teamId },
			include: {
				member: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
								profile: true,
								createdAt: true,
							},
						},
					},
				},
			},
			orderBy: {
				joinedAt: "desc",
			},
		});

		return members.map((tm) => ({
			id: tm.id,
			role: tm.role,
			joinedAt: tm.joinedAt,
			user: tm.member.user,
			organizationRole: tm.member.role,
		}));
	}
}

export const teamService = new TeamService();
