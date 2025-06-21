import { generateSecureToken } from "../lib/crypto";
import { getDbClient } from "../lib/database";
import { AuditService } from "./audit.service";
import { CacheService } from "./cache.service";
import { EmailService } from "./email.service";
import { TenantSettingsService } from "./tenant-settings.service";

export class UserActivationService {
	private emailService: EmailService;
	private tenantSettingsService: TenantSettingsService;
	private auditService: AuditService;
	private cacheService: CacheService;

	constructor() {
		this.emailService = new EmailService();
		this.tenantSettingsService = new TenantSettingsService();
		this.auditService = new AuditService();
		this.cacheService = new CacheService();
	}

	/**
	 * Send activation email to user
	 */
	async sendActivationEmail(
		tenantId: string,
		userId: string,
		email: string,
	): Promise<void> {
		const token = generateSecureToken();

		// Store activation token in cache for 24 hours
		await this.cacheService.set(
			`activation:${token}`,
			{ userId, tenantId, email },
			86400, // 24 hours
		);

		// Send activation email
		await this.emailService.sendActivationEmail(email, {
			activationUrl: `${process.env.APP_URL}/activate?token=${token}`,
		});

		// Log audit event
		await this.auditService.log(tenantId, {
			userId,
			action: "user.activation_sent",
			resource: "user",
			resourceId: userId,
			metadata: { email },
		});
	}

	/**
	 * Activate user account
	 */
	async activateAccount(
		token: string,
		requireMfa = false,
	): Promise<{ success: boolean; message: string; userId?: string }> {
		// Get activation data from cache
		const activationData = await this.cacheService.get<{
			userId: string;
			tenantId: string;
			email: string;
		}>(`activation:${token}`);

		if (!activationData) {
			return {
				success: false,
				message: "Invalid or expired activation token",
			};
		}

		const { userId, tenantId, email } = activationData;
		const db = await getDbClient(tenantId);

		// Get user
		const user = await db.user.findUnique({
			where: { id: userId },
			include: {
				mfaSettings: {
					where: { enabled: true },
				},
			},
		});

		if (!user) {
			return {
				success: false,
				message: "User not found",
			};
		}

		if (user.isActive) {
			return {
				success: false,
				message: "Account is already activated",
			};
		}

		// Check if MFA is required for activation
		const settings = await this.tenantSettingsService.getSettings(tenantId);
		if (settings.requireMfaForActivation && !user.mfaSettings.length) {
			return {
				success: false,
				message: "MFA setup required before activation",
			};
		}

		// Activate user
		await db.user.update({
			where: { id: userId },
			data: {
				isActive: true,
				activatedAt: new Date(),
			},
		});

		// Delete activation token
		await this.cacheService.delete(`activation:${token}`);

		// Log audit event
		await this.auditService.log(tenantId, {
			userId,
			action: "user.activated",
			resource: "user",
			resourceId: userId,
			metadata: { email },
		});

		return {
			success: true,
			message: "Account activated successfully",
			userId,
		};
	}

	/**
	 * Check if user needs activation
	 */
	async needsActivation(tenantId: string, userId: string): Promise<boolean> {
		const db = await getDbClient(tenantId);

		const user = await db.user.findUnique({
			where: { id: userId },
			select: { isActive: true },
		});

		return user ? !user.isActive : false;
	}

	/**
	 * Resend activation email
	 */
	async resendActivation(
		tenantId: string,
		email: string,
	): Promise<{ success: boolean; message: string }> {
		const db = await getDbClient(tenantId);

		const user = await db.user.findUnique({
			where: { email },
		});

		if (!user) {
			return {
				success: false,
				message: "User not found",
			};
		}

		if (user.isActive) {
			return {
				success: false,
				message: "Account is already activated",
			};
		}

		// Send new activation email
		await this.sendActivationEmail(tenantId, user.id, email);

		return {
			success: true,
			message: "Activation email sent",
		};
	}
}
