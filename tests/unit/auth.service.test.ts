import { dbManager } from "@user-service/database";
import {
	AuthenticationError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../apps/api/src/lib/crypto";
import { generateTokens } from "../../apps/api/src/lib/jwt";
import { AuthService } from "../../apps/api/src/services/auth.service";
import { CacheService } from "../../apps/api/src/services/cache.service";
import { EventService } from "../../apps/api/src/services/event.service";
import {
	mockCache,
	mockDbOperations,
	mockEvents,
	mockUser,
} from "../helpers/test-utils";

// Mock dependencies
vi.mock("@user-service/database");
vi.mock("../../apps/api/src/services/cache.service");
vi.mock("../../apps/api/src/services/event.service");
vi.mock("../../apps/api/src/lib/crypto");
vi.mock("../../apps/api/src/lib/jwt");

describe("AuthService", () => {
	let authService: AuthService;

	const mockTenant = {
		id: "tenant-123",
		slug: "test-tenant",
		name: "Test Tenant",
		config: {
			auth: {
				mfaRequired: false,
				requireOrganization: false,
			},
		},
	};

	const mockLoginData = {
		email: "test@example.com",
		password: "Password123!",
		ipAddress: "127.0.0.1",
		userAgent: "test-agent",
	};

	const mockRegisterData = {
		email: "new@example.com",
		password: "Password123!",
		profile: { name: "New User" },
		ipAddress: "127.0.0.1",
		userAgent: "test-agent",
	};

	beforeEach(() => {
		authService = new AuthService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(dbManager.getTenant).mockResolvedValue(mockTenant as any);
		vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any);
		vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("login", () => {
		it("should successfully login with valid credentials", async () => {
			// Arrange
			const userWithMemberships = {
				...mockUser,
				memberships: [{ organization: { id: "org-123", name: "Test Org" } }],
				mfaSettings: [],
			};

			mockDbOperations.user.findUnique.mockResolvedValue(userWithMemberships);
			vi.mocked(verifyPassword).mockResolvedValue(true);
			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "access-token",
				refreshToken: "refresh-token",
			});
			mockDbOperations.session.create.mockResolvedValue({
				id: "session-123",
				token: "access-token",
			});

			// Act
			const result = await authService.login("tenant-123", mockLoginData);

			// Assert
			expect(result).toEqual({
				user: expect.objectContaining({
					id: mockUser.id,
					email: mockUser.email,
				}),
				tokens: {
					accessToken: "access-token",
					refreshToken: "refresh-token",
					expiresIn: expect.any(Number),
				},
				organizations: expect.any(Array),
			});

			expect(mockDbOperations.user.findUnique).toHaveBeenCalledWith({
				where: { email: mockLoginData.email },
				include: {
					memberships: { include: { organization: true } },
					mfaSettings: { where: { enabled: true } },
				},
			});
			expect(verifyPassword).toHaveBeenCalledWith(
				mockLoginData.password,
				mockUser.passwordHash,
			);
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw AuthenticationError for non-existent user", async () => {
			// Arrange
			mockDbOperations.user.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				authService.login("tenant-123", mockLoginData),
			).rejects.toThrow(AuthenticationError);

			expect(mockDbOperations.user.findUnique).toHaveBeenCalled();
			expect(verifyPassword).not.toHaveBeenCalled();
		});

		it("should throw AuthenticationError for invalid password", async () => {
			// Arrange
			mockDbOperations.user.findUnique.mockResolvedValue({
				...mockUser,
				memberships: [],
				mfaSettings: [],
			});
			vi.mocked(verifyPassword).mockResolvedValue(false);

			// Act & Assert
			await expect(
				authService.login("tenant-123", mockLoginData),
			).rejects.toThrow(AuthenticationError);

			expect(verifyPassword).toHaveBeenCalledWith(
				mockLoginData.password,
				mockUser.passwordHash,
			);
			expect(mockEvents.publish).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ success: false }),
			);
		});

		it("should return MFA challenge when MFA is required", async () => {
			// Arrange
			const userWithMFA = {
				...mockUser,
				memberships: [],
				mfaSettings: [{ type: "TOTP", enabled: true }],
			};

			mockDbOperations.user.findUnique.mockResolvedValue(userWithMFA);
			vi.mocked(verifyPassword).mockResolvedValue(true);

			// Act
			const result = await authService.login("tenant-123", mockLoginData);

			// Assert
			expect(result).toEqual({
				requiresMFA: true,
				mfaToken: expect.any(String),
				mfaMethods: ["TOTP"],
			});
			expect(mockCache.set).toHaveBeenCalled();
		});

		it("should throw NotFoundError for invalid tenant", async () => {
			// Arrange
			vi.mocked(dbManager.getTenant).mockResolvedValue(null);

			// Act & Assert
			await expect(
				authService.login("invalid-tenant", mockLoginData),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw AuthenticationError when password is not set", async () => {
			// Arrange
			const userWithoutPassword = {
				...mockUser,
				passwordHash: null,
				memberships: [],
				mfaSettings: [],
			};

			mockDbOperations.user.findUnique.mockResolvedValue(userWithoutPassword);

			// Act & Assert
			await expect(
				authService.login("tenant-123", mockLoginData),
			).rejects.toThrow(AuthenticationError);
		});
	});

	describe("register", () => {
		it("should successfully register a new user", async () => {
			// Arrange
			mockDbOperations.user.findUnique.mockResolvedValue(null); // No existing user
			vi.mocked(hashPassword).mockResolvedValue("hashed-password");
			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "access-token",
				refreshToken: "refresh-token",
			});

			const newUser = {
				id: "new-user-123",
				email: mockRegisterData.email,
				passwordHash: "hashed-password",
				profile: mockRegisterData.profile,
				memberships: [],
			};

			mockDbOperations.user.create.mockResolvedValue(newUser);
			mockDbOperations.session.create.mockResolvedValue({
				id: "session-123",
				token: "access-token",
			});

			// Act
			const result = await authService.register("tenant-123", mockRegisterData);

			// Assert
			expect(result).toEqual({
				user: expect.objectContaining({
					id: newUser.id,
					email: newUser.email,
				}),
				tokens: {
					accessToken: "access-token",
					refreshToken: "refresh-token",
					expiresIn: expect.any(Number),
				},
				organizations: [],
			});

			expect(hashPassword).toHaveBeenCalledWith(mockRegisterData.password);
			expect(mockDbOperations.user.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					email: mockRegisterData.email,
					passwordHash: "hashed-password",
					profile: mockRegisterData.profile,
					userType: "INDIVIDUAL",
				}),
				include: expect.any(Object),
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ValidationError for existing user", async () => {
			// Arrange
			mockDbOperations.user.findUnique.mockResolvedValue(mockUser);

			// Act & Assert
			await expect(
				authService.register("tenant-123", mockRegisterData),
			).rejects.toThrow(ValidationError);

			expect(mockDbOperations.user.findUnique).toHaveBeenCalledWith({
				where: { email: mockRegisterData.email },
			});
			expect(mockDbOperations.user.create).not.toHaveBeenCalled();
		});

		it("should handle invitation token during registration", async () => {
			// Arrange
			const invitation = {
				id: "inv-123",
				token: "invitation-token",
				email: mockRegisterData.email,
				orgId: "org-123",
				role: "MEMBER",
				expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			};

			const registerDataWithInvitation = {
				...mockRegisterData,
				invitationToken: "invitation-token",
			};

			mockDbOperations.user.findUnique.mockResolvedValue(null);
			mockDbOperations.invitation.findUnique.mockResolvedValue(invitation);
			mockDbOperations.invitation.update.mockResolvedValue(invitation);
			vi.mocked(hashPassword).mockResolvedValue("hashed-password");
			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "access-token",
				refreshToken: "refresh-token",
			});

			const newUser = {
				id: "new-user-123",
				email: mockRegisterData.email,
				memberships: [{ organization: { id: "org-123" } }],
			};

			mockDbOperations.user.create.mockResolvedValue(newUser);
			mockDbOperations.session.create.mockResolvedValue({ id: "session-123" });

			// Act
			await authService.register("tenant-123", registerDataWithInvitation);

			// Assert
			expect(mockDbOperations.invitation.findUnique).toHaveBeenCalledWith({
				where: { token: "invitation-token" },
			});
			expect(mockDbOperations.invitation.update).toHaveBeenCalledWith({
				where: { id: invitation.id },
				data: { acceptedAt: expect.any(Date) },
			});
			expect(mockDbOperations.user.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					userType: "ORGANIZATIONAL",
					memberships: {
						create: {
							organizationId: invitation.orgId,
							role: invitation.role,
						},
					},
				}),
				include: expect.any(Object),
			});
		});

		it("should throw ValidationError for expired invitation", async () => {
			// Arrange
			const expiredInvitation = {
				id: "inv-123",
				token: "invitation-token",
				email: mockRegisterData.email,
				orgId: "org-123",
				role: "MEMBER",
				expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired
			};

			const registerDataWithInvitation = {
				...mockRegisterData,
				invitationToken: "invitation-token",
			};

			mockDbOperations.user.findUnique.mockResolvedValue(null);
			mockDbOperations.invitation.findUnique.mockResolvedValue(
				expiredInvitation,
			);

			// Act & Assert
			await expect(
				authService.register("tenant-123", registerDataWithInvitation),
			).rejects.toThrow(ValidationError);
		});

		it("should throw ValidationError when organization is required but not provided", async () => {
			// Arrange
			const tenantRequiringOrg = {
				...mockTenant,
				config: {
					auth: {
						requireOrganization: true,
					},
				},
			};

			vi.mocked(dbManager.getTenant).mockResolvedValue(
				tenantRequiringOrg as any,
			);
			mockDbOperations.user.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				authService.register("tenant-123", mockRegisterData),
			).rejects.toThrow(ValidationError);
		});
	});

	describe("logout", () => {
		it("should successfully logout user", async () => {
			// Arrange
			const sessionId = "session-123";
			const session = { id: sessionId, token: "access-token" };

			mockDbOperations.session.delete.mockResolvedValue(session);
			mockDbOperations.session.findUnique.mockResolvedValue(session);

			// Act
			const result = await authService.logout("user-123", sessionId);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.session.delete).toHaveBeenCalledWith({
				where: { id: sessionId },
			});
			expect(mockCache.del).toHaveBeenCalled();
		});
	});

	describe("verifyMFA", () => {
		it("should successfully verify TOTP code", async () => {
			// Arrange
			const mfaToken = "mfa-token-123";
			const totpCode = "123456";

			const cacheData = {
				userId: "user-123",
				tenantId: "tenant-123",
			};

			const userWithMFA = {
				...mockUser,
				mfaSettings: [
					{
						type: "TOTP",
						secret: "JBSWY3DPEHPK3PXP",
						enabled: true,
					},
				],
				memberships: [],
			};

			mockCache.get.mockResolvedValue(cacheData);
			mockDbOperations.user.findUnique.mockResolvedValue(userWithMFA);
			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "access-token",
				refreshToken: "refresh-token",
			});
			mockDbOperations.session.create.mockResolvedValue({
				id: "session-123",
				token: "access-token",
			});

			// Mock TOTP verification (would need to mock OTPAuth library)
			const mockOTPAuth = {
				TOTP: {
					validate: vi.fn().mockReturnValue(0), // Valid token
				},
			};
			vi.doMock("otpauth", () => mockOTPAuth);

			// Act
			const result = await authService.verifyMFA(mfaToken, {
				type: "TOTP",
				code: totpCode,
				ipAddress: "127.0.0.1",
				userAgent: "test-agent",
			});

			// Assert
			expect(result).toEqual({
				user: expect.objectContaining({ id: userWithMFA.id }),
				tokens: expect.objectContaining({
					accessToken: "access-token",
					refreshToken: "refresh-token",
				}),
				organizations: [],
			});
			expect(mockCache.del).toHaveBeenCalledWith(`mfa:session:${mfaToken}`);
		});

		it("should throw AuthenticationError for invalid MFA token", async () => {
			// Arrange
			mockCache.get.mockResolvedValue(null);

			// Act & Assert
			await expect(
				authService.verifyMFA("invalid-token", {
					type: "TOTP",
					code: "123456",
					ipAddress: "127.0.0.1",
					userAgent: "test-agent",
				}),
			).rejects.toThrow(AuthenticationError);
		});
	});

	describe("refreshToken", () => {
		it("should successfully refresh tokens", async () => {
			// Arrange
			const refreshToken = "refresh-token-123";
			const sessionData = {
				userId: "user-123",
				tenantId: "tenant-123",
				sessionId: "session-123",
			};

			mockCache.get.mockResolvedValue(sessionData);
			mockDbOperations.user.findUnique.mockResolvedValue(mockUser);
			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "new-access-token",
				refreshToken: "new-refresh-token",
			});
			mockDbOperations.session.update.mockResolvedValue({
				id: "session-123",
				token: "new-access-token",
			});

			// Act
			const result = await authService.refreshToken(refreshToken);

			// Assert
			expect(result).toEqual({
				accessToken: "new-access-token",
				refreshToken: "new-refresh-token",
				expiresIn: expect.any(Number),
			});
			expect(mockCache.set).toHaveBeenCalled();
		});

		it("should throw AuthenticationError for invalid refresh token", async () => {
			// Arrange
			mockCache.get.mockResolvedValue(null);

			// Act & Assert
			await expect(authService.refreshToken("invalid-token")).rejects.toThrow(
				AuthenticationError,
			);
		});
	});

	describe("helper methods", () => {
		it("should sanitize user data", async () => {
			// Act
			const sanitized = (authService as any).sanitizeUser(mockUser);

			// Assert
			expect(sanitized).not.toHaveProperty("passwordHash");
			expect(sanitized).toHaveProperty("id");
			expect(sanitized).toHaveProperty("email");
			expect(sanitized).toHaveProperty("profile");
		});

		it("should log activity", async () => {
			// Arrange
			const activityData = {
				userId: "user-123",
				action: "user.login",
				resource: "session",
				resourceId: "session-123",
				ipAddress: "127.0.0.1",
				userAgent: "test-agent",
			};

			mockDbOperations.auditLog = {
				create: vi.fn().mockResolvedValue({ id: "audit-123" }),
			};

			// Act
			await (authService as any).logActivity(mockDbOperations, activityData);

			// Assert
			expect(mockDbOperations.auditLog.create).toHaveBeenCalledWith({
				data: expect.objectContaining(activityData),
			});
		});
	});
});
