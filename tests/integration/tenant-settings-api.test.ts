import type { Tenant, User } from "@repo/database";
import { testClient } from "hono/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../apps/api/src/index";
import { createTestTenant, createTestUser, getTestRedis } from "../setup";

describe("Tenant Settings API Integration", () => {
	let client: ReturnType<typeof testClient>;
	let testTenant: Tenant;
	let adminUser: User;
	let regularUser: User;
	let adminToken: string;
	let userToken: string;
	let redis: any;

	beforeAll(async () => {
		client = testClient(app);
		redis = getTestRedis();

		// Create test tenant with B2B type
		testTenant = await createTestTenant("settings-test", "B2B");

		// Create admin user (first user, automatically admin)
		adminUser = await createTestUser(testTenant.id, {
			email: "admin@tenant.com",
			profile: { name: "Admin User" },
			isTenantAdmin: true,
		});

		// Create regular user
		regularUser = await createTestUser(testTenant.id, {
			email: "user@tenant.com",
			profile: { name: "Regular User" },
			isTenantAdmin: false,
		});
	});

	beforeEach(async () => {
		// Login as admin
		const adminLogin = await client.api.v1.auth.login.$post({
			header: {
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			},
			json: {
				email: "admin@tenant.com",
				password: "TestPassword123!",
			},
		});
		const adminData = await adminLogin.json();
		adminToken = adminData.data.tokens.accessToken;

		// Login as regular user
		const userLogin = await client.api.v1.auth.login.$post({
			header: {
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			},
			json: {
				email: "user@tenant.com",
				password: "TestPassword123!",
			},
		});
		const userData = await userLogin.json();
		userToken = userData.data.tokens.accessToken;
	});

	afterAll(async () => {
		// Cleanup
		await redis?.quit();
	});

	describe("GET /tenant/settings", () => {
		it("should get tenant settings for authenticated user", async () => {
			const response = await client.api.v1.tenant.settings.$get({
				header: {
					Authorization: `Bearer ${userToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toMatchObject({
				id: "default",
				emailPasswordEnabled: true,
				magicLinkEnabled: false,
				googleAuthEnabled: true,
				microsoftAuthEnabled: true,
				mfaRequiredForAdmins: true,
				requireActivation: true,
				passwordMinLength: 10,
			});
		});

		it("should return 401 without authentication", async () => {
			const response = await client.api.v1.tenant.settings.$get({
				header: {
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(401);
		});
	});

	describe("PUT /tenant/settings", () => {
		it("should update settings as admin", async () => {
			const response = await client.api.v1.tenant.settings.$put({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					mfaRequired: true,
					passwordMinLength: 12,
					magicLinkEnabled: true,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toMatchObject({
				mfaRequired: true,
				passwordMinLength: 12,
				magicLinkEnabled: true,
			});
		});

		it("should return 403 for non-admin user", async () => {
			const response = await client.api.v1.tenant.settings.$put({
				header: {
					Authorization: `Bearer ${userToken}`,
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					mfaRequired: true,
				},
			});

			expect(response.status).toBe(403);
			const data = await response.json();
			expect(data.error).toBe("Admin privileges required");
		});

		it("should validate input data", async () => {
			const response = await client.api.v1.tenant.settings.$put({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					passwordMinLength: 50, // Too high
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toBe("Invalid input");
		});
	});

	describe("GET /tenant/stats", () => {
		it("should get tenant statistics as admin", async () => {
			const response = await client.api.v1.tenant.stats.$get({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toMatchObject({
				users: {
					total: expect.any(Number),
					mfaEnabled: expect.any(Number),
				},
				organizations: {
					total: expect.any(Number),
				},
				sessions: {
					active: expect.any(Number),
				},
			});
		});

		it("should return 403 for non-admin user", async () => {
			const response = await client.api.v1.tenant.stats.$get({
				header: {
					Authorization: `Bearer ${userToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(403);
		});
	});

	describe("GET /tenant/admins", () => {
		it("should list tenant admins", async () => {
			const response = await client.api.v1.tenant.admins.$get({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toHaveLength(1);
			expect(data.data[0]).toMatchObject({
				id: adminUser.id,
				email: "admin@tenant.com",
			});
		});
	});

	describe("POST /tenant/admins/:userId", () => {
		it("should grant admin privileges", async () => {
			const response = await client.api.v1.tenant.admins[":userId"].$post({
				param: { userId: regularUser.id },
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toMatchObject({
				id: regularUser.id,
				email: "user@tenant.com",
				isTenantAdmin: true,
			});

			// Verify user is now in admin list
			const adminsResponse = await client.api.v1.tenant.admins.$get({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});
			const adminsData = await adminsResponse.json();
			expect(adminsData.data).toHaveLength(2);
		});
	});

	describe("DELETE /tenant/admins/:userId", () => {
		it("should revoke admin privileges", async () => {
			// First grant admin privileges
			await client.api.v1.tenant.admins[":userId"].$post({
				param: { userId: regularUser.id },
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			// Then revoke them
			const response = await client.api.v1.tenant.admins[":userId"].$delete({
				param: { userId: regularUser.id },
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toMatchObject({
				id: regularUser.id,
				email: "user@tenant.com",
				isTenantAdmin: false,
			});
		});
	});

	describe("POST /tenant/mfa/enforce", () => {
		it("should enforce MFA for all users", async () => {
			const response = await client.api.v1.tenant.mfa.enforce.$post({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					adminsOnly: false,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.message).toBe("MFA enforcement updated successfully");

			// Verify settings were updated
			const settingsResponse = await client.api.v1.tenant.settings.$get({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});
			const settingsData = await settingsResponse.json();
			expect(settingsData.data.mfaRequired).toBe(true);
		});

		it("should enforce MFA for admins only", async () => {
			const response = await client.api.v1.tenant.mfa.enforce.$post({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					adminsOnly: true,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);

			// Verify settings were updated
			const settingsResponse = await client.api.v1.tenant.settings.$get({
				header: {
					Authorization: `Bearer ${adminToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});
			const settingsData = await settingsResponse.json();
			expect(settingsData.data.mfaRequiredForAdmins).toBe(true);
		});
	});
});
