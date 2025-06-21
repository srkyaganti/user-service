import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSecureToken } from "../../apps/api/src/lib/crypto";
import { getDbClient } from "../../apps/api/src/lib/database";
import { AuditService } from "../../apps/api/src/services/audit.service";
import { CacheService } from "../../apps/api/src/services/cache.service";
import { EmailService } from "../../apps/api/src/services/email.service";
import { TenantSettingsService } from "../../apps/api/src/services/tenant-settings.service";
import { UserActivationService } from "../../apps/api/src/services/user-activation.service";

// Mock dependencies
vi.mock("../../apps/api/src/lib/database");
vi.mock("../../apps/api/src/lib/crypto");
vi.mock("../../apps/api/src/services/email.service");
vi.mock("../../apps/api/src/services/tenant-settings.service");
vi.mock("../../apps/api/src/services/audit.service");
vi.mock("../../apps/api/src/services/cache.service");

describe("UserActivationService", () => {
	let service: UserActivationService;
	let mockEmailService: any;
	let mockTenantSettingsService: any;
	let mockAuditService: any;
	let mockCacheService: any;
	let mockDb: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock services
		mockEmailService = { sendActivationEmail: vi.fn() };
		mockTenantSettingsService = { getSettings: vi.fn() };
		mockAuditService = { log: vi.fn() };
		mockCacheService = {
			get: vi.fn(),
			set: vi.fn(),
			delete: vi.fn(),
		};

		EmailService.prototype.sendActivationEmail =
			mockEmailService.sendActivationEmail;
		TenantSettingsService.prototype.getSettings =
			mockTenantSettingsService.getSettings;
		AuditService.prototype.log = mockAuditService.log;
		CacheService.prototype.get = mockCacheService.get;
		CacheService.prototype.set = mockCacheService.set;
		CacheService.prototype.delete = mockCacheService.delete;

		// Mock database
		mockDb = {
			user: {
				findUnique: vi.fn(),
				update: vi.fn(),
			},
		};
		vi.mocked(getDbClient).mockResolvedValue(mockDb);

		// Mock token generation
		vi.mocked(generateSecureToken).mockReturnValue("test-activation-token");

		service = new UserActivationService();
	});

	describe("sendActivationEmail", () => {
		it("should send activation email and store token", async () => {
			process.env.APP_URL = "http://localhost:3000";

			await service.sendActivationEmail(
				"tenant-123",
				"user-123",
				"test@example.com",
			);

			expect(generateSecureToken).toHaveBeenCalled();
			expect(mockCacheService.set).toHaveBeenCalledWith(
				"activation:test-activation-token",
				{
					userId: "user-123",
					tenantId: "tenant-123",
					email: "test@example.com",
				},
				86400, // 24 hours
			);
			expect(mockEmailService.sendActivationEmail).toHaveBeenCalledWith(
				"test@example.com",
				{
					activationUrl:
						"http://localhost:3000/activate?token=test-activation-token",
				},
			);
			expect(mockAuditService.log).toHaveBeenCalledWith("tenant-123", {
				userId: "user-123",
				action: "user.activation_sent",
				resource: "user",
				resourceId: "user-123",
				metadata: { email: "test@example.com" },
			});
		});
	});

	describe("activateAccount", () => {
		const mockActivationData = {
			userId: "user-123",
			tenantId: "tenant-123",
			email: "test@example.com",
		};

		it("should activate account with valid token", async () => {
			mockCacheService.get.mockResolvedValue(mockActivationData);
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				email: "test@example.com",
				isActive: false,
				mfaSettings: [],
			});
			mockTenantSettingsService.getSettings.mockResolvedValue({
				requireMfaForActivation: false,
			});

			const result = await service.activateAccount("test-activation-token");

			expect(result).toEqual({
				success: true,
				message: "Account activated successfully",
				userId: "user-123",
			});
			expect(mockDb.user.update).toHaveBeenCalledWith({
				where: { id: "user-123" },
				data: {
					isActive: true,
					activatedAt: expect.any(Date),
				},
			});
			expect(mockCacheService.delete).toHaveBeenCalledWith(
				"activation:test-activation-token",
			);
			expect(mockAuditService.log).toHaveBeenCalledWith("tenant-123", {
				userId: "user-123",
				action: "user.activated",
				resource: "user",
				resourceId: "user-123",
				metadata: { email: "test@example.com" },
			});
		});

		it("should reject invalid token", async () => {
			mockCacheService.get.mockResolvedValue(null);

			const result = await service.activateAccount("invalid-token");

			expect(result).toEqual({
				success: false,
				message: "Invalid or expired activation token",
			});
			expect(mockDb.user.update).not.toHaveBeenCalled();
		});

		it("should reject already activated account", async () => {
			mockCacheService.get.mockResolvedValue(mockActivationData);
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				email: "test@example.com",
				isActive: true,
			});

			const result = await service.activateAccount("test-activation-token");

			expect(result).toEqual({
				success: false,
				message: "Account is already activated",
			});
			expect(mockDb.user.update).not.toHaveBeenCalled();
		});

		it("should require MFA setup if configured", async () => {
			mockCacheService.get.mockResolvedValue(mockActivationData);
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				email: "test@example.com",
				isActive: false,
				mfaSettings: [],
			});
			mockTenantSettingsService.getSettings.mockResolvedValue({
				requireMfaForActivation: true,
			});

			const result = await service.activateAccount("test-activation-token");

			expect(result).toEqual({
				success: false,
				message: "MFA setup required before activation",
			});
			expect(mockDb.user.update).not.toHaveBeenCalled();
		});
	});

	describe("needsActivation", () => {
		it("should return true for inactive user", async () => {
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				isActive: false,
			});

			const result = await service.needsActivation("tenant-123", "user-123");

			expect(result).toBe(true);
		});

		it("should return false for active user", async () => {
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				isActive: true,
			});

			const result = await service.needsActivation("tenant-123", "user-123");

			expect(result).toBe(false);
		});

		it("should return false for non-existent user", async () => {
			mockDb.user.findUnique.mockResolvedValue(null);

			const result = await service.needsActivation("tenant-123", "user-123");

			expect(result).toBe(false);
		});
	});

	describe("resendActivation", () => {
		it("should resend activation for inactive user", async () => {
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				email: "test@example.com",
				isActive: false,
			});

			const result = await service.resendActivation(
				"tenant-123",
				"test@example.com",
			);

			expect(result).toEqual({
				success: true,
				message: "Activation email sent",
			});
			expect(mockEmailService.sendActivationEmail).toHaveBeenCalled();
		});

		it("should reject resend for active user", async () => {
			mockDb.user.findUnique.mockResolvedValue({
				id: "user-123",
				email: "test@example.com",
				isActive: true,
			});

			const result = await service.resendActivation(
				"tenant-123",
				"test@example.com",
			);

			expect(result).toEqual({
				success: false,
				message: "Account is already activated",
			});
			expect(mockEmailService.sendActivationEmail).not.toHaveBeenCalled();
		});

		it("should handle non-existent user", async () => {
			mockDb.user.findUnique.mockResolvedValue(null);

			const result = await service.resendActivation(
				"tenant-123",
				"nonexistent@example.com",
			);

			expect(result).toEqual({
				success: false,
				message: "User not found",
			});
			expect(mockEmailService.sendActivationEmail).not.toHaveBeenCalled();
		});
	});
});
