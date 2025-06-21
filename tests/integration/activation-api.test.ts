import type { Tenant } from "@repo/database";
import { testClient } from "hono/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../apps/api/src/index";
import { generateSecureToken } from "../../apps/api/src/lib/crypto";
import { getDbClient } from "../../apps/api/src/lib/database";
import { createTestTenant, getTestRedis } from "../setup";

describe("Account Activation API Integration", () => {
	let client: ReturnType<typeof testClient>;
	let testTenant: Tenant;
	let redis: any;

	beforeAll(async () => {
		client = testClient(app);
		redis = getTestRedis();

		// Create test tenant with activation required
		testTenant = await createTestTenant("activation-test", "B2B");
		const db = await getDbClient(testTenant.id);

		// Ensure activation is required
		await db.tenantSettings.upsert({
			where: { id: "default" },
			update: { requireActivation: true },
			create: {
				id: "default",
				requireActivation: true,
				emailPasswordEnabled: true,
				passwordMinLength: 8,
			},
		});
	});

	afterAll(async () => {
		await redis?.quit();
	});

	describe("User Registration with Activation Required", () => {
		it("should require activation for new users", async () => {
			const response = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "newuser@activation.com",
					password: "TestPassword123!",
					profile: { name: "New User" },
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data.requiresActivation).toBe(true);
			expect(data.data.message).toContain("check your email to activate");
			expect(data.data.tokens).toBeUndefined(); // No tokens until activated

			// Verify user is created but not active
			const db = await getDbClient(testTenant.id);
			const user = await db.user.findUnique({
				where: { email: "newuser@activation.com" },
			});
			expect(user?.isActive).toBe(false);
			expect(user?.activatedAt).toBeNull();
		});

		it("should not allow login before activation", async () => {
			const response = await client.api.v1.auth.login.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "newuser@activation.com",
					password: "TestPassword123!",
				},
			});

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error).toBe("Account is not activated");
		});
	});

	describe("POST /activation/activate", () => {
		let activationToken: string;
		let userId: string;

		beforeEach(async () => {
			// Create a user that needs activation
			const db = await getDbClient(testTenant.id);
			const user = await db.user.create({
				data: {
					email: "activate-me@test.com",
					passwordHash: "hash",
					isActive: false,
					profile: {},
				},
			});
			userId = user.id;

			// Create activation token in cache
			activationToken = generateSecureToken();
			await redis.set(
				`activation:${activationToken}`,
				JSON.stringify({
					userId,
					tenantId: testTenant.id,
					email: user.email,
				}),
				"EX",
				86400, // 24 hours
			);
		});

		it("should activate account with valid token", async () => {
			const response = await client.api.v1.activation.activate.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					token: activationToken,
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.message).toBe("Account activated successfully");
			expect(data.userId).toBe(userId);

			// Verify user is now active
			const db = await getDbClient(testTenant.id);
			const user = await db.user.findUnique({
				where: { id: userId },
			});
			expect(user?.isActive).toBe(true);
			expect(user?.activatedAt).toBeTruthy();

			// Verify token is deleted
			const tokenExists = await redis.get(`activation:${activationToken}`);
			expect(tokenExists).toBeNull();
		});

		it("should reject invalid activation token", async () => {
			const response = await client.api.v1.activation.activate.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					token: "invalid-token",
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();

			expect(data.success).toBe(false);
			expect(data.error).toBe("Invalid or expired activation token");
		});

		it("should reject already activated account", async () => {
			// First activation
			await client.api.v1.activation.activate.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					token: activationToken,
				},
			});

			// Create new token for same user
			await redis.set(
				`activation:${activationToken}`,
				JSON.stringify({
					userId,
					tenantId: testTenant.id,
					email: "activate-me@test.com",
				}),
				"EX",
				86400,
			);

			// Try to activate again
			const response = await client.api.v1.activation.activate.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					token: activationToken,
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toBe("Account is already activated");
		});
	});

	describe("POST /activation/resend", () => {
		beforeEach(async () => {
			// Create an inactive user
			const db = await getDbClient(testTenant.id);
			await db.user.create({
				data: {
					email: "resend-test@example.com",
					passwordHash: "hash",
					isActive: false,
					profile: {},
				},
			});
		});

		it("should resend activation email for inactive user", async () => {
			const response = await client.api.v1.activation.resend.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "resend-test@example.com",
				},
			});

			expect(response.status).toBe(200);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.message).toBe("Activation email sent");
		});

		it("should reject resend for active user", async () => {
			// Activate the user first
			const db = await getDbClient(testTenant.id);
			await db.user.update({
				where: { email: "resend-test@example.com" },
				data: { isActive: true, activatedAt: new Date() },
			});

			const response = await client.api.v1.activation.resend.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "resend-test@example.com",
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toBe("Account is already activated");
		});

		it("should reject resend for non-existent user", async () => {
			const response = await client.api.v1.activation.resend.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "nonexistent@example.com",
				},
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toBe("User not found");
		});

		it("should validate email format", async () => {
			const response = await client.api.v1.activation.resend.$post({
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
			expect(data.error).toBe("Invalid request");
		});
	});

	describe("Activation with MFA Requirement", () => {
		beforeEach(async () => {
			// Update tenant settings to require MFA for activation
			const db = await getDbClient(testTenant.id);
			await db.tenantSettings.update({
				where: { id: "default" },
				data: { requireMfaForActivation: true },
			});
		});

		afterEach(async () => {
			// Reset setting
			const db = await getDbClient(testTenant.id);
			await db.tenantSettings.update({
				where: { id: "default" },
				data: { requireMfaForActivation: false },
			});
		});

		it("should require MFA setup before activation", async () => {
			// Create user without MFA
			const db = await getDbClient(testTenant.id);
			const user = await db.user.create({
				data: {
					email: "mfa-required@test.com",
					passwordHash: "hash",
					isActive: false,
					profile: {},
				},
			});

			// Create activation token
			const token = generateSecureToken();
			await redis.set(
				`activation:${token}`,
				JSON.stringify({
					userId: user.id,
					tenantId: testTenant.id,
					email: user.email,
				}),
				"EX",
				86400,
			);

			// Try to activate
			const response = await client.api.v1.activation.activate.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: { token },
			});

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error).toBe("MFA setup required before activation");
		});
	});
});
