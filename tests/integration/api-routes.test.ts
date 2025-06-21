import { dbManager } from "@user-service/database";
import { testClient } from "hono/testing";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import { app } from "../../apps/api/src/index";
import { hashPassword } from "../../apps/api/src/lib/crypto";
import { generateTokens } from "../../apps/api/src/lib/jwt";
import {
	createTestOrganization,
	createTestTenant,
	createTestUser,
} from "../setup";

describe("API Routes Integration", () => {
	let client: ReturnType<typeof testClient>;
	let testTenant: any;
	let testUser: any;
	let testOrg: any;
	let authHeaders: Record<string, string>;

	beforeAll(async () => {
		// Create test client
		client = testClient(app);

		// Create test tenant
		testTenant = await createTestTenant("integration-test");

		// Create test user with password
		const passwordHash = await hashPassword("TestPassword123!");
		testUser = await createTestUser(testTenant.id, {
			email: "integration@test.com",
			passwordHash,
			emailVerified: true,
		});

		// Create test organization
		testOrg = await createTestOrganization(testTenant.id, {
			name: "Test Organization",
			slug: "test-org",
		});

		// Add user to organization
		const db = await dbManager.getClient(testTenant.id);
		await db.membership.create({
			data: {
				userId: testUser.id,
				organizationId: testOrg.id,
				role: "OWNER",
			},
		});

		// Generate auth tokens
		const tokens = await generateTokens({
			userId: testUser.id,
			email: testUser.email,
			tenantId: testTenant.id,
			organizationId: testOrg.id,
		});

		authHeaders = {
			Authorization: `Bearer ${tokens.accessToken}`,
			"X-Tenant-ID": testTenant.id,
			"Content-Type": "application/json",
		};
	});

	afterAll(async () => {
		// Cleanup test data
		try {
			const db = await dbManager.getClient(testTenant.id);
			await db.membership.deleteMany({});
			await db.organization.deleteMany({});
			await db.user.deleteMany({});

			const centralDb = await dbManager.getCentralDb();
			await centralDb.tenant.delete({
				where: { id: testTenant.id },
			});
		} catch (error) {
			console.warn("Cleanup failed:", error);
		}
	});

	describe("Authentication Routes", () => {
		describe("POST /api/v1/auth/register", () => {
			it("should successfully register a new user", async () => {
				const response = await client.api.v1.auth.register.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: "newuser@test.com",
						password: "NewPassword123!",
						profile: {
							name: "New User",
						},
					},
				});

				expect(response.status).toBe(201);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.user.email).toBe("newuser@test.com");
				expect(data.data.tokens.accessToken).toBeDefined();
				expect(data.data.tokens.refreshToken).toBeDefined();
			});

			it("should return 400 for duplicate email", async () => {
				const response = await client.api.v1.auth.register.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: testUser.email, // Existing email
						password: "Password123!",
						profile: {
							name: "Duplicate User",
						},
					},
				});

				expect(response.status).toBe(400);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("VALIDATION_ERROR");
			});

			it("should return 400 for weak password", async () => {
				const response = await client.api.v1.auth.register.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: "weakpassword@test.com",
						password: "123", // Too weak
						profile: {
							name: "Weak Password User",
						},
					},
				});

				expect(response.status).toBe(400);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("VALIDATION_ERROR");
			});
		});

		describe("POST /api/v1/auth/login", () => {
			it("should successfully login with valid credentials", async () => {
				const response = await client.api.v1.auth.login.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: testUser.email,
						password: "TestPassword123!",
					},
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.user.email).toBe(testUser.email);
				expect(data.data.tokens.accessToken).toBeDefined();
			});

			it("should return 401 for invalid credentials", async () => {
				const response = await client.api.v1.auth.login.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: testUser.email,
						password: "WrongPassword",
					},
				});

				expect(response.status).toBe(401);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("AUTHENTICATION_ERROR");
			});

			it("should return 401 for non-existent user", async () => {
				const response = await client.api.v1.auth.login.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: "nonexistent@test.com",
						password: "Password123!",
					},
				});

				expect(response.status).toBe(401);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("AUTHENTICATION_ERROR");
			});
		});

		describe("POST /api/v1/auth/logout", () => {
			it("should successfully logout", async () => {
				const response = await client.api.v1.auth.logout.$post({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
			});

			it("should return 401 without authentication", async () => {
				const response = await client.api.v1.auth.logout.$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
				});

				expect(response.status).toBe(401);
			});
		});
	});

	describe("User Routes", () => {
		describe("GET /api/v1/users/profile", () => {
			it("should return user profile", async () => {
				const response = await client.api.v1.users.profile.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.email).toBe(testUser.email);
				expect(data.data.organizations).toHaveLength(1);
				expect(data.data.organizations[0].id).toBe(testOrg.id);
			});

			it("should return 401 without authentication", async () => {
				const response = await client.api.v1.users.profile.$get({
					header: {
						"X-Tenant-ID": testTenant.id,
					},
				});

				expect(response.status).toBe(401);
			});
		});

		describe("PATCH /api/v1/users/profile", () => {
			it("should update user profile", async () => {
				const response = await client.api.v1.users.profile.$patch({
					header: authHeaders,
					json: {
						name: "Updated Name",
						bio: "Updated bio",
						location: "Updated location",
					},
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.profile.name).toBe("Updated Name");
				expect(data.data.profile.bio).toBe("Updated bio");
			});

			it("should validate profile data", async () => {
				const response = await client.api.v1.users.profile.$patch({
					header: authHeaders,
					json: {
						website: "invalid-url", // Invalid URL
					},
				});

				expect(response.status).toBe(400);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("VALIDATION_ERROR");
			});
		});

		describe("POST /api/v1/users/change-password", () => {
			it("should change user password", async () => {
				const response = await client.api.v1.users["change-password"].$post({
					header: authHeaders,
					json: {
						currentPassword: "TestPassword123!",
						newPassword: "NewTestPassword456!",
					},
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
			});

			it("should return 400 for incorrect current password", async () => {
				const response = await client.api.v1.users["change-password"].$post({
					header: authHeaders,
					json: {
						currentPassword: "WrongPassword",
						newPassword: "NewPassword123!",
					},
				});

				expect(response.status).toBe(400);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("VALIDATION_ERROR");
			});
		});
	});

	describe("Organization Routes", () => {
		describe("GET /api/v1/organizations", () => {
			it("should return user organizations", async () => {
				const response = await client.api.v1.organizations.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.organizations).toHaveLength(1);
				expect(data.data.organizations[0].id).toBe(testOrg.id);
			});
		});

		describe("POST /api/v1/organizations", () => {
			it("should create new organization", async () => {
				const response = await client.api.v1.organizations.$post({
					header: authHeaders,
					json: {
						name: "New Organization",
						slug: "new-org",
						description: "A new test organization",
					},
				});

				expect(response.status).toBe(201);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.name).toBe("New Organization");
				expect(data.data.slug).toBe("new-org");
			});

			it("should return 409 for duplicate slug", async () => {
				const response = await client.api.v1.organizations.$post({
					header: authHeaders,
					json: {
						name: "Duplicate Org",
						slug: testOrg.slug, // Existing slug
						description: "Duplicate organization",
					},
				});

				expect(response.status).toBe(409);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("CONFLICT");
			});
		});

		describe("GET /api/v1/organizations/:orgId", () => {
			it("should return organization details", async () => {
				const response = await client.api.v1.organizations[":orgId"].$get({
					param: { orgId: testOrg.id },
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.id).toBe(testOrg.id);
				expect(data.data.members).toHaveLength(1);
				expect(data.data.members[0].user.id).toBe(testUser.id);
			});

			it("should return 404 for non-existent organization", async () => {
				const response = await client.api.v1.organizations[":orgId"].$get({
					param: { orgId: "non-existent-org" },
					header: authHeaders,
				});

				expect(response.status).toBe(404);
			});
		});

		describe("PATCH /api/v1/organizations/:orgId", () => {
			it("should update organization", async () => {
				const response = await client.api.v1.organizations[":orgId"].$patch({
					param: { orgId: testOrg.id },
					header: authHeaders,
					json: {
						name: "Updated Organization Name",
						description: "Updated description",
					},
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.name).toBe("Updated Organization Name");
			});
		});
	});

	describe("Team Routes", () => {
		describe("POST /api/v1/organizations/:orgId/teams", () => {
			it("should create new team", async () => {
				const response = await client.api.v1.organizations[
					":orgId"
				].teams.$post({
					param: { orgId: testOrg.id },
					header: authHeaders,
					json: {
						name: "Engineering Team",
						description: "Software engineering team",
						permissions: ["repos.read", "repos.write"],
					},
				});

				expect(response.status).toBe(201);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.name).toBe("Engineering Team");
				expect(data.data.permissions).toContain("repos.read");
			});
		});

		describe("GET /api/v1/organizations/:orgId/teams", () => {
			it("should return organization teams", async () => {
				const response = await client.api.v1.organizations[":orgId"].teams.$get(
					{
						param: { orgId: testOrg.id },
						header: authHeaders,
					},
				);

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(Array.isArray(data.data.teams)).toBe(true);
			});
		});
	});

	describe("MFA Routes", () => {
		describe("POST /api/v1/auth/mfa/totp/setup", () => {
			it("should setup TOTP for user", async () => {
				const response = await client.api.v1.auth.mfa.totp.setup.$post({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.setupToken).toBeDefined();
				expect(data.data.secret).toBeDefined();
				expect(data.data.qrCode).toBeDefined();
				expect(data.data.backupCodes).toHaveLength(8);
			});
		});

		describe("GET /api/v1/auth/mfa", () => {
			it("should return user MFA methods", async () => {
				const response = await client.api.v1.auth.mfa.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(Array.isArray(data.data.methods)).toBe(true);
			});
		});
	});

	describe("Magic Link Routes", () => {
		describe("POST /api/v1/auth/magic-link", () => {
			it("should send magic link", async () => {
				const response = await client.api.v1.auth["magic-link"].$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: testUser.email,
					},
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.message).toContain("Magic link sent");
			});

			it("should return 400 for invalid email", async () => {
				const response = await client.api.v1.auth["magic-link"].$post({
					header: {
						"X-Tenant-ID": testTenant.id,
						"Content-Type": "application/json",
					},
					json: {
						email: "invalid-email",
					},
				});

				expect(response.status).toBe(400);
				const data = await response.json();
				expect(data.success).toBe(false);
				expect(data.error.code).toBe("VALIDATION_ERROR");
			});
		});
	});

	describe("Device Routes", () => {
		describe("GET /api/v1/devices", () => {
			it("should return user devices", async () => {
				const response = await client.api.v1.devices.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(Array.isArray(data.data.devices)).toBe(true);
			});
		});

		describe("POST /api/v1/devices", () => {
			it("should register new device", async () => {
				const response = await client.api.v1.devices.$post({
					header: authHeaders,
					json: {
						name: "Test Device",
						type: "DESKTOP",
						fingerprint: "test-fingerprint-123",
					},
				});

				expect(response.status).toBe(201);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.name).toBe("Test Device");
				expect(data.data.type).toBe("DESKTOP");
			});
		});
	});

	describe("Session Routes", () => {
		describe("GET /api/v1/sessions", () => {
			it("should return user sessions", async () => {
				const response = await client.api.v1.sessions.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(Array.isArray(data.data.sessions)).toBe(true);
			});

			it("should filter active sessions", async () => {
				const response = await client.api.v1.sessions.$get({
					header: authHeaders,
					query: { active: "true" },
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
			});
		});
	});

	describe("Audit Routes", () => {
		describe("GET /api/v1/audit", () => {
			it("should return audit logs", async () => {
				const response = await client.api.v1.audit.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(Array.isArray(data.data.logs)).toBe(true);
			});

			it("should filter audit logs by action", async () => {
				const response = await client.api.v1.audit.$get({
					header: authHeaders,
					query: { action: "user.login" },
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
			});
		});

		describe("GET /api/v1/audit/stats", () => {
			it("should return audit statistics", async () => {
				const response = await client.api.v1.audit.stats.$get({
					header: authHeaders,
				});

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.success).toBe(true);
				expect(data.data.totalEvents).toBeDefined();
				expect(Array.isArray(data.data.actionCounts)).toBe(true);
			});
		});
	});

	describe("Health Routes", () => {
		describe("GET /health", () => {
			it("should return basic health status", async () => {
				const response = await client.health.$get();

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.status).toBe("ok");
				expect(data.service).toBe("user-service");
				expect(data.timestamp).toBeDefined();
			});
		});

		describe("GET /health/live", () => {
			it("should return detailed health status", async () => {
				const response = await client.health.live.$get();

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.status).toMatch(/healthy|degraded/);
				expect(data.checks).toBeDefined();
				expect(data.checks.database).toBeDefined();
				expect(data.checks.redis).toBeDefined();
			});
		});

		describe("GET /health/ready", () => {
			it("should return readiness status", async () => {
				const response = await client.health.ready.$get();

				expect(response.status).toBe(200);
				const data = await response.json();
				expect(data.status).toBe("ready");
			});
		});
	});

	describe("Error Handling", () => {
		it("should return 404 for non-existent routes", async () => {
			const response = await client["non-existent-route"].$get();
			expect(response.status).toBe(404);
		});

		it("should return 400 for missing tenant header", async () => {
			const response = await client.api.v1.auth.login.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					email: "test@example.com",
					password: "password",
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 429 for rate limiting", async () => {
			// Simulate rate limiting by making many requests quickly
			const requests = Array(20)
				.fill(null)
				.map(() =>
					client.api.v1.auth.login.$post({
						header: {
							"X-Tenant-ID": testTenant.id,
							"Content-Type": "application/json",
						},
						json: {
							email: "nonexistent@test.com",
							password: "password",
						},
					}),
				);

			const responses = await Promise.all(requests);
			const rateLimitedResponse = responses.find((r) => r.status === 429);

			if (rateLimitedResponse) {
				const data = await rateLimitedResponse.json();
				expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
			}
		});
	});

	describe("CORS and Security Headers", () => {
		it("should include security headers in responses", async () => {
			const response = await client.health.$get();

			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(response.headers.get("X-Frame-Options")).toBe("DENY");
			expect(response.headers.get("X-XSS-Protection")).toBe("1; mode=block");
		});

		it("should handle CORS preflight requests", async () => {
			const response = await fetch("/api/v1/auth/login", {
				method: "OPTIONS",
				headers: {
					Origin: "http://localhost:3000",
					"Access-Control-Request-Method": "POST",
					"Access-Control-Request-Headers": "Content-Type",
				},
			});

			expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
			expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
				"POST",
			);
		});
	});
});
