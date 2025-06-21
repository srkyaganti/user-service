import type { Prisma, TenantSettings, TenantType } from "@repo/database";
import { getDbClient } from "../lib/database";
import { prisma } from "../lib/prisma";
import { CacheService } from "./cache.service";

export class TenantSettingsService {
	private cacheService: CacheService;

	constructor() {
		this.cacheService = new CacheService();
	}

	/**
	 * Get default settings based on tenant type
	 */
	private getDefaultSettingsByType(type: TenantType): Partial<TenantSettings> {
		switch (type) {
			case "B2B":
				return {
					// B2B defaults - more restrictive
					emailPasswordEnabled: true,
					magicLinkEnabled: false,
					googleAuthEnabled: true,
					githubAuthEnabled: false,
					microsoftAuthEnabled: true,
					mfaRequired: false,
					mfaRequiredForAdmins: true,
					totpEnabled: true,
					webauthnEnabled: true,
					requireActivation: true,
					requireMfaForActivation: false,
					passwordMinLength: 10,
					passwordRequireSpecial: true,
					passwordRequireNumber: true,
					passwordRequireUpper: true,
					sessionTimeout: 28800, // 8 hours
					refreshTokenExpiry: 604800, // 7 days
				};

			case "B2C":
				return {
					// B2C defaults - more user-friendly
					emailPasswordEnabled: true,
					magicLinkEnabled: true,
					googleAuthEnabled: true,
					githubAuthEnabled: true,
					microsoftAuthEnabled: false,
					mfaRequired: false,
					mfaRequiredForAdmins: false,
					totpEnabled: true,
					webauthnEnabled: true,
					requireActivation: false,
					requireMfaForActivation: false,
					passwordMinLength: 8,
					passwordRequireSpecial: false,
					passwordRequireNumber: true,
					passwordRequireUpper: false,
					sessionTimeout: 86400, // 24 hours
					refreshTokenExpiry: 2592000, // 30 days
				};

			case "HYBRID":
				return {
					// Hybrid defaults - balanced approach
					emailPasswordEnabled: true,
					magicLinkEnabled: true,
					googleAuthEnabled: true,
					githubAuthEnabled: true,
					microsoftAuthEnabled: true,
					mfaRequired: false,
					mfaRequiredForAdmins: true,
					totpEnabled: true,
					webauthnEnabled: true,
					requireActivation: false,
					requireMfaForActivation: false,
					passwordMinLength: 8,
					passwordRequireSpecial: true,
					passwordRequireNumber: true,
					passwordRequireUpper: true,
					sessionTimeout: 43200, // 12 hours
					refreshTokenExpiry: 1209600, // 14 days
				};

			default:
				// Default to B2B settings
				return this.getDefaultSettingsByType("B2B");
		}
	}

	/**
	 * Get tenant settings with caching
	 */
	async getSettings(tenantId: string): Promise<TenantSettings> {
		const cacheKey = `tenant:${tenantId}:settings`;

		// Try cache first
		const cached = await this.cacheService.get<TenantSettings>(cacheKey);
		if (cached) {
			return cached;
		}

		const db = await getDbClient(tenantId);

		// Get settings or create default if not exists
		let settings = await db.tenantSettings.findUnique({
			where: { id: "default" },
		});

		if (!settings) {
			// Get tenant type from master database
			const tenant = await prisma.tenant.findUnique({
				where: { id: tenantId },
				select: { type: true },
			});

			const defaultSettings = this.getDefaultSettingsByType(
				tenant?.type || "B2B",
			);

			settings = await db.tenantSettings.create({
				data: {
					id: "default",
					...defaultSettings,
				},
			});
		}

		// Cache for 1 hour
		await this.cacheService.set(cacheKey, settings, 3600);

		return settings;
	}

	/**
	 * Update tenant settings
	 */
	async updateSettings(
		tenantId: string,
		data: Partial<Omit<TenantSettings, "id" | "updatedAt">>,
	): Promise<TenantSettings> {
		const db = await getDbClient(tenantId);

		const settings = await db.tenantSettings.upsert({
			where: { id: "default" },
			update: data,
			create: {
				id: "default",
				...data,
			},
		});

		// Invalidate cache
		const cacheKey = `tenant:${tenantId}:settings`;
		await this.cacheService.delete(cacheKey);

		return settings;
	}

	/**
	 * Check if a login method is enabled
	 */
	async isLoginMethodEnabled(
		tenantId: string,
		method: "emailPassword" | "magicLink" | "google" | "github" | "microsoft",
	): Promise<boolean> {
		const settings = await this.getSettings(tenantId);

		switch (method) {
			case "emailPassword":
				return settings.emailPasswordEnabled;
			case "magicLink":
				return settings.magicLinkEnabled;
			case "google":
				return settings.googleAuthEnabled;
			case "github":
				return settings.githubAuthEnabled;
			case "microsoft":
				return settings.microsoftAuthEnabled;
			default:
				return false;
		}
	}

	/**
	 * Check if MFA is required for a user type
	 */
	async isMfaRequired(tenantId: string, isAdmin: boolean): Promise<boolean> {
		const settings = await this.getSettings(tenantId);

		if (isAdmin && settings.mfaRequiredForAdmins) {
			return true;
		}

		return settings.mfaRequired;
	}

	/**
	 * Check if account activation is required
	 */
	async isActivationRequired(tenantId: string): Promise<boolean> {
		const settings = await this.getSettings(tenantId);
		return settings.requireActivation;
	}

	/**
	 * Validate password against tenant policy
	 */
	async validatePassword(
		tenantId: string,
		password: string,
	): Promise<{ valid: boolean; errors: string[] }> {
		const settings = await this.getSettings(tenantId);
		const errors: string[] = [];

		if (password.length < settings.passwordMinLength) {
			errors.push(
				`Password must be at least ${settings.passwordMinLength} characters long`,
			);
		}

		if (
			settings.passwordRequireSpecial &&
			!/[!@#$%^&*(),.?":{}|<>]/.test(password)
		) {
			errors.push("Password must contain at least one special character");
		}

		if (settings.passwordRequireNumber && !/\d/.test(password)) {
			errors.push("Password must contain at least one number");
		}

		if (settings.passwordRequireUpper && !/[A-Z]/.test(password)) {
			errors.push("Password must contain at least one uppercase letter");
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Initialize default system roles based on tenant type
	 */
	async initializeSystemRoles(tenantId: string): Promise<void> {
		const db = await getDbClient(tenantId);

		// Get tenant type
		const tenant = await prisma.tenant.findUnique({
			where: { id: tenantId },
			select: { type: true },
		});

		let systemRoles: any[] = [];

		if (tenant?.type === "B2B" || tenant?.type === "HYBRID") {
			// B2B roles
			systemRoles = [
				{
					name: "super_admin",
					displayName: "Super Administrator",
					description: "Full system access including tenant management",
					permissions: ["*"],
					isSystem: true,
				},
				{
					name: "admin",
					displayName: "Administrator",
					description: "Administrative access to most features",
					permissions: [
						"users.view",
						"users.create",
						"users.update",
						"users.delete",
						"organizations.view",
						"organizations.create",
						"organizations.update",
						"teams.view",
						"teams.create",
						"teams.update",
						"teams.delete",
						"settings.view",
						"settings.update",
						"audit.view",
					],
					isSystem: true,
				},
				{
					name: "manager",
					displayName: "Manager",
					description: "Can manage users and teams within their organization",
					permissions: [
						"users.view",
						"users.create",
						"users.update",
						"teams.view",
						"teams.create",
						"teams.update",
						"organizations.view",
					],
					isSystem: true,
				},
				{
					name: "member",
					displayName: "Member",
					description: "Basic user with read access",
					permissions: ["users.view.self", "organizations.view", "teams.view"],
					isSystem: true,
				},
			];
		}

		if (tenant?.type === "B2C" || tenant?.type === "HYBRID") {
			// B2C roles
			const b2cRoles = [
				{
					name: "premium_user",
					displayName: "Premium User",
					description: "Premium tier user with additional features",
					permissions: [
						"premium.features",
						"export.data",
						"api.access",
						"priority.support",
					],
					isSystem: true,
				},
				{
					name: "standard_user",
					displayName: "Standard User",
					description: "Standard tier user",
					permissions: ["basic.features", "profile.manage", "settings.update"],
					isSystem: true,
				},
				{
					name: "free_user",
					displayName: "Free User",
					description: "Free tier user with limited access",
					permissions: ["basic.features.limited", "profile.view"],
					isSystem: true,
				},
			];

			systemRoles = [...systemRoles, ...b2cRoles];
		}

		// Create roles if they don't exist
		for (const role of systemRoles) {
			await db.role.upsert({
				where: { name: role.name },
				create: role,
				update: {}, // Don't update system roles
			});
		}
	}

	/**
	 * Assign default role to new user based on tenant type and settings
	 */
	async assignDefaultRole(
		tenantId: string,
		userId: string,
		isFirstUser = false,
	): Promise<void> {
		const db = await getDbClient(tenantId);

		// Get tenant type
		const tenant = await prisma.tenant.findUnique({
			where: { id: tenantId },
			select: { type: true },
		});

		let roleName: string;

		if (tenant?.type === "B2B") {
			// B2B: First user gets admin, others get member
			roleName = isFirstUser ? "admin" : "member";
		} else if (tenant?.type === "B2C") {
			// B2C: First user gets premium (as founder), others get free tier
			roleName = isFirstUser ? "premium_user" : "free_user";
		} else {
			// HYBRID: First user gets admin, others get standard_user
			roleName = isFirstUser ? "admin" : "standard_user";
		}

		const role = await db.role.findUnique({
			where: { name: roleName },
		});

		if (role) {
			await db.userRole
				.create({
					data: {
						userId,
						roleId: role.id,
					},
				})
				.catch(() => {
					// Ignore if already exists
				});
		}
	}

	/**
	 * Check if user has specific permission
	 */
	async hasPermission(
		tenantId: string,
		userId: string,
		permission: string,
	): Promise<boolean> {
		const db = await getDbClient(tenantId);

		const userRoles = await db.userRole.findMany({
			where: { userId },
			include: { role: true },
		});

		for (const userRole of userRoles) {
			// Super admin has all permissions
			if (userRole.role.permissions.includes("*")) {
				return true;
			}

			// Check specific permission
			if (userRole.role.permissions.includes(permission)) {
				return true;
			}

			// Check wildcard permissions (e.g., users.* matches users.view)
			const permissionParts = permission.split(".");
			for (let i = 1; i <= permissionParts.length; i++) {
				const wildcardPermission = `${permissionParts.slice(0, i).join(".")}.*`;
				if (userRole.role.permissions.includes(wildcardPermission)) {
					return true;
				}
			}
		}

		return false;
	}
}
