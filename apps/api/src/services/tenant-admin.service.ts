import type { Tenant, User } from "@repo/database";
import { getDbClient } from "../lib/database";
import { prisma } from "../lib/prisma";
import { AuditService } from "./audit.service";
import { TenantSettingsService } from "./tenant-settings.service";

export class TenantAdminService {
	private tenantSettingsService: TenantSettingsService;
	private auditService: AuditService;

	constructor() {
		this.tenantSettingsService = new TenantSettingsService();
		this.auditService = new AuditService();
	}

	/**
	 * Check if user is tenant admin
	 */
	async isTenantAdmin(tenantId: string, userId: string): Promise<boolean> {
		const db = await getDbClient(tenantId);

		const user = await db.user.findUnique({
			where: { id: userId },
			select: { isTenantAdmin: true },
		});

		return user?.isTenantAdmin || false;
	}

	/**
	 * Grant tenant admin privileges
	 */
	async grantAdminPrivileges(
		tenantId: string,
		userId: string,
		grantedBy: string,
	): Promise<User> {
		const db = await getDbClient(tenantId);

		const user = await db.user.update({
			where: { id: userId },
			data: { isTenantAdmin: true },
		});

		// Assign super_admin role
		const superAdminRole = await db.role.findUnique({
			where: { name: "super_admin" },
		});

		if (superAdminRole) {
			await db.userRole.upsert({
				where: {
					userId_roleId: {
						userId,
						roleId: superAdminRole.id,
					},
				},
				create: {
					userId,
					roleId: superAdminRole.id,
				},
				update: {},
			});
		}

		// Log audit event
		await this.auditService.log(tenantId, {
			userId: grantedBy,
			action: "tenant_admin.grant",
			resource: "user",
			resourceId: userId,
			metadata: {
				targetUserId: userId,
			},
		});

		return user;
	}

	/**
	 * Revoke tenant admin privileges
	 */
	async revokeAdminPrivileges(
		tenantId: string,
		userId: string,
		revokedBy: string,
	): Promise<User> {
		const db = await getDbClient(tenantId);

		const user = await db.user.update({
			where: { id: userId },
			data: { isTenantAdmin: false },
		});

		// Remove super_admin role
		const superAdminRole = await db.role.findUnique({
			where: { name: "super_admin" },
		});

		if (superAdminRole) {
			await db.userRole.deleteMany({
				where: {
					userId,
					roleId: superAdminRole.id,
				},
			});
		}

		// Log audit event
		await this.auditService.log(tenantId, {
			userId: revokedBy,
			action: "tenant_admin.revoke",
			resource: "user",
			resourceId: userId,
			metadata: {
				targetUserId: userId,
			},
		});

		return user;
	}

	/**
	 * List all tenant admins
	 */
	async listAdmins(tenantId: string): Promise<User[]> {
		const db = await getDbClient(tenantId);

		return db.user.findMany({
			where: {
				isTenantAdmin: true,
				deletedAt: null,
			},
			orderBy: {
				createdAt: "desc",
			},
		});
	}

	/**
	 * Update tenant settings (admin only)
	 */
	async updateTenantSettings(
		tenantId: string,
		adminId: string,
		settings: any,
	): Promise<any> {
		// Verify admin privileges
		const isAdmin = await this.isTenantAdmin(tenantId, adminId);
		if (!isAdmin) {
			throw new Error("Unauthorized: Admin privileges required");
		}

		// Update settings
		const updatedSettings = await this.tenantSettingsService.updateSettings(
			tenantId,
			settings,
		);

		// Log audit event
		await this.auditService.log(tenantId, {
			userId: adminId,
			action: "tenant_settings.update",
			resource: "tenant_settings",
			resourceId: "default",
			metadata: {
				changes: settings,
			},
		});

		return updatedSettings;
	}

	/**
	 * Update tenant information (admin only)
	 */
	async updateTenantInfo(
		tenantId: string,
		adminId: string,
		data: Partial<Pick<Tenant, "name" | "config" | "settings">>,
	): Promise<Tenant> {
		// Verify admin privileges
		const isAdmin = await this.isTenantAdmin(tenantId, adminId);
		if (!isAdmin) {
			throw new Error("Unauthorized: Admin privileges required");
		}

		// Update tenant in master database
		const tenant = await prisma.tenant.update({
			where: { id: tenantId },
			data,
		});

		// Log audit event
		await this.auditService.log(tenantId, {
			userId: adminId,
			action: "tenant.update",
			resource: "tenant",
			resourceId: tenantId,
			metadata: {
				changes: data,
			},
		});

		return tenant;
	}

	/**
	 * Get tenant usage statistics (admin only)
	 */
	async getTenantStats(tenantId: string, adminId: string): Promise<any> {
		// Verify admin privileges
		const isAdmin = await this.isTenantAdmin(tenantId, adminId);
		if (!isAdmin) {
			throw new Error("Unauthorized: Admin privileges required");
		}

		const db = await getDbClient(tenantId);

		const [userCount, orgCount, activeSessionCount, mfaEnabledCount] =
			await Promise.all([
				db.user.count({ where: { deletedAt: null } }),
				db.organization.count({ where: { deletedAt: null } }),
				db.session.count({
					where: {
						expiresAt: { gt: new Date() },
					},
				}),
				db.user.count({
					where: {
						deletedAt: null,
						mfaSettings: {
							some: {
								enabled: true,
							},
						},
					},
				}),
			]);

		return {
			users: {
				total: userCount,
				mfaEnabled: mfaEnabledCount,
			},
			organizations: {
				total: orgCount,
			},
			sessions: {
				active: activeSessionCount,
			},
		};
	}

	/**
	 * Enforce MFA for all users (admin only)
	 */
	async enforceMfaForAllUsers(
		tenantId: string,
		adminId: string,
		enforceForAdminsOnly = false,
	): Promise<void> {
		// Verify admin privileges
		const isAdmin = await this.isTenantAdmin(tenantId, adminId);
		if (!isAdmin) {
			throw new Error("Unauthorized: Admin privileges required");
		}

		// Update tenant settings
		const settings = enforceForAdminsOnly
			? { mfaRequiredForAdmins: true }
			: { mfaRequired: true };

		await this.tenantSettingsService.updateSettings(tenantId, settings);

		// Log audit event
		await this.auditService.log(tenantId, {
			userId: adminId,
			action: "mfa.enforce",
			resource: "tenant_settings",
			resourceId: "default",
			metadata: {
				enforceForAdminsOnly,
			},
		});
	}
}
