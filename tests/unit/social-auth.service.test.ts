import { dbManager } from "@user-service/database";
import {
	AuthenticationError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTokens } from "../../apps/api/src/lib/jwt";
import { CacheService } from "../../apps/api/src/services/cache.service";
import {
	SocialAuthService,
	socialAuthService,
} from "../../apps/api/src/services/social-auth.service";
import { mockCache, mockDbOperations, mockUser } from "../helpers/test-utils";

// Mock dependencies
vi.mock("@user-service/database");
vi.mock("../../apps/api/src/services/cache.service");
vi.mock("../../apps/api/src/lib/jwt");

// Mock fetch for OAuth API calls
global.fetch = vi.fn();

describe("SocialAuthService", () => {
	let service: SocialAuthService;

	const mockTenant = {
		id: "tenant-123",
		slug: "test-tenant",
		name: "Test Tenant",
		config: {
			auth: {
				requireInvitation: false,
			},
		},
	};

	const mockSocialAuth = {
		id: "social-123",
		userId: "user-123",
		provider: "google",
		providerId: "google-user-123",
		email: "test@example.com",
		profile: {
			id: "google-user-123",
			email: "test@example.com",
			name: "Test User",
			picture: "https://example.com/avatar.jpg",
		},
		accessToken: "access-token-123",
		refreshToken: "refresh-token-123",
		expiresAt: new Date(Date.now() + 3600000),
	};

	beforeEach(() => {
		service = new SocialAuthService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(dbManager.getTenant).mockResolvedValue(mockTenant as any);
		vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any);

		// Setup environment variables for providers
		process.env.GOOGLE_CLIENT_ID = "google-client-id";
		process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
		process.env.GITHUB_CLIENT_ID = "github-client-id";
		process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
	});

	afterEach(() => {
		vi.resetAllMocks();
		vi.mocked(fetch).mockClear();
	});

	describe("getAuthorizationUrl", () => {
		it("should generate Google OAuth authorization URL", async () => {
			// Arrange
			const redirectUri = "http://localhost:3000/callback";

			// Act
			const result = await service.getAuthorizationUrl(
				"tenant-123",
				"google",
				redirectUri,
			);

			// Assert
			expect(result).toEqual({
				authorizationUrl: expect.stringContaining(
					"accounts.google.com/o/oauth2/v2/auth",
				),
				state: expect.any(String),
			});

			expect(result.authorizationUrl).toContain("client_id=google-client-id");
			expect(result.authorizationUrl).toContain(
				"redirect_uri=http%3A//localhost%3A3000/callback",
			);
			expect(result.authorizationUrl).toContain(
				"scope=openid%20email%20profile",
			);

			expect(mockCache.set).toHaveBeenCalledWith(
				expect.stringContaining("oauth:state:"),
				expect.objectContaining({
					provider: "google",
					tenantId: "tenant-123",
					redirectUri,
				}),
				expect.any(Number),
			);
		});

		it("should generate GitHub OAuth authorization URL", async () => {
			// Arrange
			const redirectUri = "http://localhost:3000/callback";

			// Act
			const result = await service.getAuthorizationUrl(
				"tenant-123",
				"github",
				redirectUri,
			);

			// Assert
			expect(result).toEqual({
				authorizationUrl: expect.stringContaining(
					"github.com/login/oauth/authorize",
				),
				state: expect.any(String),
			});

			expect(result.authorizationUrl).toContain("client_id=github-client-id");
			expect(result.authorizationUrl).toContain("scope=user%3Aemail");
		});

		it("should throw ValidationError for unsupported provider", async () => {
			// Act & Assert
			await expect(
				service.getAuthorizationUrl(
					"tenant-123",
					"unsupported",
					"http://localhost:3000/callback",
				),
			).rejects.toThrow(ValidationError);
		});

		it("should throw NotFoundError for invalid tenant", async () => {
			// Arrange
			vi.mocked(dbManager.getTenant).mockResolvedValue(null);

			// Act & Assert
			await expect(
				service.getAuthorizationUrl(
					"invalid-tenant",
					"google",
					"http://localhost:3000/callback",
				),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("handleCallback", () => {
		it("should successfully handle Google OAuth callback for existing user", async () => {
			// Arrange
			const callbackData = {
				code: "auth-code-123",
				state: "state-token-123",
			};

			const stateData = {
				provider: "google",
				tenantId: "tenant-123",
				redirectUri: "http://localhost:3000/callback",
			};

			const tokenResponse = {
				access_token: "access-token-123",
				refresh_token: "refresh-token-123",
				expires_in: 3600,
			};

			const userInfo = {
				id: "google-user-123",
				email: "test@example.com",
				name: "Test User",
				picture: "https://example.com/avatar.jpg",
			};

			const existingUser = {
				...mockUser,
				socialAuths: [mockSocialAuth],
			};

			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(tokenResponse),
				} as any) // Token exchange
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(userInfo),
				} as any); // User info

			mockDbOperations.socialAuth.findFirst.mockResolvedValue({
				...mockSocialAuth,
				user: existingUser,
			});

			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "jwt-access-token",
				refreshToken: "jwt-refresh-token",
			});

			mockDbOperations.session.create.mockResolvedValue({
				id: "session-123",
				token: "jwt-access-token",
			});

			// Act
			const result = await service.handleCallback(
				"tenant-123",
				"google",
				callbackData,
			);

			// Assert
			expect(result).toEqual({
				user: expect.objectContaining({ id: existingUser.id }),
				tokens: {
					accessToken: "jwt-access-token",
					refreshToken: "jwt-refresh-token",
					expiresIn: expect.any(Number),
				},
				organizations: [],
			});

			expect(mockCache.del).toHaveBeenCalledWith(
				`oauth:state:${callbackData.state}`,
			);
			expect(fetch).toHaveBeenCalledTimes(2); // Token exchange + user info
		});

		it("should successfully handle OAuth callback for new user", async () => {
			// Arrange
			const callbackData = {
				code: "auth-code-123",
				state: "state-token-123",
			};

			const stateData = {
				provider: "google",
				tenantId: "tenant-123",
				redirectUri: "http://localhost:3000/callback",
			};

			const tokenResponse = {
				access_token: "access-token-123",
				refresh_token: "refresh-token-123",
				expires_in: 3600,
			};

			const userInfo = {
				id: "google-user-123",
				email: "newuser@example.com",
				name: "New User",
				picture: "https://example.com/avatar.jpg",
			};

			const newUser = {
				id: "new-user-123",
				email: userInfo.email,
				userType: "INDIVIDUAL",
				profile: {
					name: userInfo.name,
					avatarUrl: userInfo.picture,
					emailVerified: true,
				},
				socialAuths: [
					{
						provider: "google",
						providerId: userInfo.id,
						email: userInfo.email,
					},
				],
			};

			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(tokenResponse),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(userInfo),
				} as any);

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(null); // No existing social auth
			mockDbOperations.user.create.mockResolvedValue(newUser);

			vi.mocked(generateTokens).mockResolvedValue({
				accessToken: "jwt-access-token",
				refreshToken: "jwt-refresh-token",
			});

			mockDbOperations.session.create.mockResolvedValue({
				id: "session-123",
				token: "jwt-access-token",
			});

			// Act
			const result = await service.handleCallback(
				"tenant-123",
				"google",
				callbackData,
			);

			// Assert
			expect(result).toEqual({
				user: expect.objectContaining({ id: newUser.id }),
				tokens: expect.objectContaining({
					accessToken: "jwt-access-token",
				}),
				organizations: [],
			});

			expect(mockDbOperations.user.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					email: userInfo.email,
					userType: "INDIVIDUAL",
					profile: expect.objectContaining({
						name: userInfo.name,
						avatarUrl: userInfo.picture,
						emailVerified: true,
					}),
					socialAuths: {
						create: expect.objectContaining({
							provider: "google",
							providerId: userInfo.id,
							email: userInfo.email,
						}),
					},
				}),
				include: expect.any(Object),
			});
		});

		it("should throw ValidationError for invalid state token", async () => {
			// Arrange
			const callbackData = {
				code: "auth-code-123",
				state: "invalid-state",
			};

			mockCache.get.mockResolvedValue(null);

			// Act & Assert
			await expect(
				service.handleCallback("tenant-123", "google", callbackData),
			).rejects.toThrow(ValidationError);
		});

		it("should throw AuthenticationError for failed token exchange", async () => {
			// Arrange
			const callbackData = {
				code: "invalid-code",
				state: "state-token-123",
			};

			const stateData = {
				provider: "google",
				tenantId: "tenant-123",
				redirectUri: "http://localhost:3000/callback",
			};

			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 400,
			} as any);

			// Act & Assert
			await expect(
				service.handleCallback("tenant-123", "google", callbackData),
			).rejects.toThrow(AuthenticationError);
		});

		it("should throw ValidationError when registration requires invitation", async () => {
			// Arrange
			const tenantWithInvitationRequired = {
				...mockTenant,
				config: {
					auth: {
						requireInvitation: true,
					},
				},
			};

			const callbackData = {
				code: "auth-code-123",
				state: "state-token-123",
			};

			const stateData = {
				provider: "google",
				tenantId: "tenant-123",
				redirectUri: "http://localhost:3000/callback",
			};

			const tokenResponse = {
				access_token: "access-token-123",
				expires_in: 3600,
			};

			const userInfo = {
				id: "google-user-123",
				email: "newuser@example.com",
				name: "New User",
			};

			vi.mocked(dbManager.getTenant).mockResolvedValue(
				tenantWithInvitationRequired as any,
			);
			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(tokenResponse),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(userInfo),
				} as any);

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				service.handleCallback("tenant-123", "google", callbackData),
			).rejects.toThrow(ValidationError);
		});
	});

	describe("linkAccount", () => {
		it("should successfully link social account to existing user", async () => {
			// Arrange
			const linkData = {
				provider: "github",
				code: "auth-code-123",
				state: "state-token-123",
			};

			const stateData = {
				provider: "github",
				userId: "user-123",
				tenantId: "tenant-123",
			};

			const tokenResponse = {
				access_token: "github-access-token",
				expires_in: 3600,
			};

			const userInfo = {
				id: "github-user-123",
				login: "testuser",
				email: "test@example.com",
				name: "Test User",
				avatar_url: "https://github.com/avatar.jpg",
			};

			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(tokenResponse),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(userInfo),
				} as any);

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(null); // No existing link
			mockDbOperations.socialAuth.create.mockResolvedValue({
				id: "social-auth-123",
				userId: "user-123",
				provider: "github",
				providerId: userInfo.id,
			});

			// Act
			const result = await service.linkAccount(
				"tenant-123",
				"user-123",
				linkData,
			);

			// Assert
			expect(result).toEqual({ success: true });

			expect(mockDbOperations.socialAuth.create).toHaveBeenCalledWith({
				data: {
					userId: "user-123",
					provider: "github",
					providerId: userInfo.id,
					email: userInfo.email,
					profile: userInfo,
					accessToken: tokenResponse.access_token,
					refreshToken: undefined,
					expiresAt: expect.any(Date),
				},
			});
		});

		it("should throw ValidationError if account already linked", async () => {
			// Arrange
			const linkData = {
				provider: "github",
				code: "auth-code-123",
				state: "state-token-123",
			};

			const stateData = {
				provider: "github",
				userId: "user-123",
				tenantId: "tenant-123",
			};

			const tokenResponse = {
				access_token: "github-access-token",
				expires_in: 3600,
			};

			const userInfo = {
				id: "github-user-123",
				login: "testuser",
				email: "test@example.com",
			};

			mockCache.get.mockResolvedValue(stateData);
			vi.mocked(fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(tokenResponse),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(userInfo),
				} as any);

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(mockSocialAuth); // Existing link

			// Act & Assert
			await expect(
				service.linkAccount("tenant-123", "user-123", linkData),
			).rejects.toThrow(ValidationError);
		});
	});

	describe("unlinkAccount", () => {
		it("should successfully unlink social account", async () => {
			// Arrange
			const socialAuthToDelete = {
				...mockSocialAuth,
				userId: "user-123",
			};

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(
				socialAuthToDelete,
			);
			mockDbOperations.socialAuth.delete.mockResolvedValue(socialAuthToDelete);

			// Act
			const result = await service.unlinkAccount(
				"tenant-123",
				"user-123",
				"social-123",
			);

			// Assert
			expect(result).toEqual({ success: true });

			expect(mockDbOperations.socialAuth.delete).toHaveBeenCalledWith({
				where: { id: "social-123" },
			});
		});

		it("should throw NotFoundError for non-existent social auth", async () => {
			// Arrange
			mockDbOperations.socialAuth.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				service.unlinkAccount("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw ValidationError when trying to unlink other user's account", async () => {
			// Arrange
			const otherUserSocialAuth = {
				...mockSocialAuth,
				userId: "other-user-123",
			};

			mockDbOperations.socialAuth.findFirst.mockResolvedValue(
				otherUserSocialAuth,
			);

			// Act & Assert
			await expect(
				service.unlinkAccount("tenant-123", "user-123", "social-123"),
			).rejects.toThrow(ValidationError);
		});
	});

	describe("listLinkedAccounts", () => {
		it("should return user's linked social accounts", async () => {
			// Arrange
			const linkedAccounts = [
				{
					id: "social-1",
					provider: "google",
					email: "test@gmail.com",
					profile: { name: "Test User" },
					createdAt: new Date(),
				},
				{
					id: "social-2",
					provider: "github",
					email: "test@github.com",
					profile: { login: "testuser" },
					createdAt: new Date(),
				},
			];

			mockDbOperations.socialAuth.findMany.mockResolvedValue(linkedAccounts);

			// Act
			const result = await service.listLinkedAccounts("tenant-123", "user-123");

			// Assert
			expect(result).toEqual({
				accounts: expect.arrayContaining([
					expect.objectContaining({
						provider: "google",
						email: "test@gmail.com",
					}),
					expect.objectContaining({
						provider: "github",
						email: "test@github.com",
					}),
				]),
			});

			expect(mockDbOperations.socialAuth.findMany).toHaveBeenCalledWith({
				where: { userId: "user-123" },
				select: {
					id: true,
					provider: true,
					email: true,
					profile: true,
					createdAt: true,
				},
				orderBy: { createdAt: "desc" },
			});
		});

		it("should return empty array for user with no linked accounts", async () => {
			// Arrange
			mockDbOperations.socialAuth.findMany.mockResolvedValue([]);

			// Act
			const result = await service.listLinkedAccounts("tenant-123", "user-123");

			// Assert
			expect(result).toEqual({ accounts: [] });
		});
	});
});
