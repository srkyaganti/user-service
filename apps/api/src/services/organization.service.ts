import { dbManager } from "@user-service/database";
import type { OrgRole } from "@user-service/database";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
	generateSlug,
} from "@user-service/shared";
import { logger } from "../lib/logger";

export interface CreateOrganizationDto {
	name: string;
	slug?: string;
	description?: string;
	logo?: string;
	metadata?: Record<string, any>;
}

export interface UpdateOrganizationDto {
	name?: string;
	slug?: string;
	description?: string;
	logo?: string;
	metadata?: Record<string, any>;
	settings?: Record<string, any>;
}

export class OrganizationService {
	async createOrganization(
		userId: string,
		tenantId: string,
		data: CreateOrganizationDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check if user exists
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		// Generate slug if not provided
		const slug = data.slug || generateSlug(data.name);

		// Check if slug is already taken
		const existingOrg = await db.organization.findUnique({
			where: { slug },
		});

		if (existingOrg) {
			throw new ConflictError("Organization slug already exists");
		}

		// Create organization with user as owner
		const org = await db.organization.create({
			data: {
				name: data.name,
				slug,
				description: data.description,
				logo: data.logo,
				metadata: data.metadata,
				members: {
					create: {
						userId,
						role: "OWNER",
						permissions: ["*"], // Full permissions for owner
					},
				},
			},
			include: {
				members: {
					include: {
						user: true,
					},
				},
			},
		});

		// Update user type to ORGANIZATIONAL or HYBRID
		await db.user.update({
			where: { id: userId },
			data: {
				userType: user.userType === "INDIVIDUAL" ? "ORGANIZATIONAL" : "HYBRID",
			},
		});

		// Log organization creation
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.created",
				resource: "organization",
				resourceId: org.id,
				metadata: { name: org.name, slug: org.slug },
				ipAddress: "0.0.0.0", // Would come from request context
				userAgent: "Unknown",
			},
		});

		return org;
	}

	async getOrganization(orgId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Get organization with user's membership
		const org = await db.organization.findUnique({
			where: { id: orgId },
			include: {
				members: {
					where: { userId },
					include: {
						user: true,
					},
				},
				_count: {
					select: {
						members: true,
						teams: true,
					},
				},
			},
		});

		if (!org) {
			throw new NotFoundError("Organization");
		}

		// Check if user is a member
		if (org.members.length === 0) {
			throw new ForbiddenError("You are not a member of this organization");
		}

		return {
			...org,
			currentUserRole: org.members[0].role,
			currentUserPermissions: org.members[0].permissions,
		};
	}

	async listOrganizations(userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const memberships = await db.organizationMember.findMany({
			where: { userId },
			include: {
				organization: {
					include: {
						_count: {
							select: {
								members: true,
								teams: true,
							},
						},
					},
				},
			},
		});

		return memberships.map((m) => ({
			...m.organization,
			role: m.role,
			permissions: m.permissions,
			joinedAt: m.joinedAt,
		}));
	}

	async updateOrganization(
		orgId: string,
		userId: string,
		tenantId: string,
		data: UpdateOrganizationDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check permissions
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

		if (!["OWNER", "ADMIN"].includes(member.role)) {
			throw new ForbiddenError(
				"Only owners and admins can update the organization",
			);
		}

		// Check slug uniqueness if updating
		if (data.slug) {
			const existingOrg = await db.organization.findUnique({
				where: { slug: data.slug },
			});

			if (existingOrg && existingOrg.id !== orgId) {
				throw new ConflictError("Organization slug already exists");
			}
		}

		// Update organization
		const org = await db.organization.update({
			where: { id: orgId },
			data: {
				name: data.name,
				slug: data.slug,
				description: data.description,
				logo: data.logo,
				metadata: data.metadata,
				settings: data.settings,
			},
		});

		// Log update
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.updated",
				resource: "organization",
				resourceId: org.id,
				metadata: { changes: data },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return org;
	}

	async deleteOrganization(orgId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Check if user is owner
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!member || member.role !== "OWNER") {
			throw new ForbiddenError("Only owners can delete the organization");
		}

		// Soft delete organization
		const org = await db.organization.update({
			where: { id: orgId },
			data: { deletedAt: new Date() },
		});

		// Log deletion
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.deleted",
				resource: "organization",
				resourceId: org.id,
				metadata: { name: org.name },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	// Member management
	async addMember(
		orgId: string,
		email: string,
		role: OrgRole,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check permissions
		const member = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
			throw new ForbiddenError("Only owners and admins can add members");
		}

		// Find user by email
		const newMember = await db.user.findUnique({
			where: { email },
		});

		if (!newMember) {
			throw new NotFoundError("User with this email not found");
		}

		// Check if already a member
		const existingMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId: newMember.id,
					orgId,
				},
			},
		});

		if (existingMember) {
			throw new ConflictError("User is already a member of this organization");
		}

		// Add member
		const membership = await db.organizationMember.create({
			data: {
				userId: newMember.id,
				orgId,
				role,
				permissions: this.getDefaultPermissions(role),
			},
			include: {
				user: true,
			},
		});

		// Update user type if needed
		if (newMember.userType === "INDIVIDUAL") {
			await db.user.update({
				where: { id: newMember.id },
				data: { userType: "ORGANIZATIONAL" },
			});
		}

		// Log addition
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.member_added",
				resource: "organization",
				resourceId: orgId,
				metadata: {
					memberId: newMember.id,
					email: newMember.email,
					role,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return membership;
	}

	async updateMemberRole(
		orgId: string,
		memberId: string,
		role: OrgRole,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check permissions
		const currentMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!currentMember || currentMember.role !== "OWNER") {
			throw new ForbiddenError("Only owners can update member roles");
		}

		// Don't allow changing own role
		if (memberId === userId) {
			throw new ValidationError("Cannot change your own role");
		}

		// Update role
		const member = await db.organizationMember.update({
			where: {
				userId_orgId: {
					userId: memberId,
					orgId,
				},
			},
			data: {
				role,
				permissions: this.getDefaultPermissions(role),
			},
			include: {
				user: true,
			},
		});

		// Log update
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.member_role_updated",
				resource: "organization",
				resourceId: orgId,
				metadata: {
					memberId,
					newRole: role,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return member;
	}

	async removeMember(
		orgId: string,
		memberId: string,
		userId: string,
		tenantId: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Check permissions
		const currentMember = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId,
					orgId,
				},
			},
		});

		if (!currentMember || !["OWNER", "ADMIN"].includes(currentMember.role)) {
			throw new ForbiddenError("Only owners and admins can remove members");
		}

		// Don't allow removing self if owner
		if (memberId === userId && currentMember.role === "OWNER") {
			// Check if there are other owners
			const ownerCount = await db.organizationMember.count({
				where: {
					orgId,
					role: "OWNER",
				},
			});

			if (ownerCount === 1) {
				throw new ValidationError("Cannot remove the last owner");
			}
		}

		// Remove member
		await db.organizationMember.delete({
			where: {
				userId_orgId: {
					userId: memberId,
					orgId,
				},
			},
		});

		// Check if user should revert to INDIVIDUAL type
		const remainingMemberships = await db.organizationMember.count({
			where: { userId: memberId },
		});

		if (remainingMemberships === 0) {
			await db.user.update({
				where: { id: memberId },
				data: { userType: "INDIVIDUAL" },
			});
		}

		// Log removal
		await db.auditLog.create({
			data: {
				userId,
				action: "organization.member_removed",
				resource: "organization",
				resourceId: orgId,
				metadata: { memberId },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	async listMembers(orgId: string, userId: string, tenantId: string) {
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

		// Get all members
		const members = await db.organizationMember.findMany({
			where: { orgId },
			include: {
				user: {
					select: {
						id: true,
						email: true,
						profile: true,
						createdAt: true,
					},
				},
				teamMembers: {
					include: {
						team: {
							select: {
								id: true,
								name: true,
							},
						},
					},
				},
			},
			orderBy: [{ role: "asc" }, { joinedAt: "desc" }],
		});

		return members;
	}

	private getDefaultPermissions(role: OrgRole): string[] {
		switch (role) {
			case "OWNER":
				return ["*"]; // All permissions
			case "ADMIN":
				return [
					"org.read",
					"org.update",
					"members.read",
					"members.create",
					"members.update",
					"members.delete",
					"teams.read",
					"teams.create",
					"teams.update",
					"teams.delete",
				];
			case "MEMBER":
				return ["org.read", "members.read", "teams.read"];
			case "GUEST":
				return ["org.read"];
			default:
				return [];
		}
	}
}

export const organizationService = new OrganizationService();
