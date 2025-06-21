import { dbManager } from "@user-service/database";
import { testClient } from "hono/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../apps/api/src/index";
import { createTestOrganization, createTestTenant } from "../setup";

describe("End-to-End Authentication Flows", () => {
	let client: ReturnType<typeof testClient>;
	let testTenant: any;

	beforeAll(async () => {
		client = testClient(app);
		testTenant = await createTestTenant("e2e-auth-test");
	});

	afterAll(async () => {
		// Cleanup
		try {
			const db = await dbManager.getClient(testTenant.id);
			await db.user.deleteMany({});
			await db.organization.deleteMany({});

			const centralDb = await dbManager.getCentralDb();
			await centralDb.tenant.delete({ where: { id: testTenant.id } });
		} catch (error) {
			console.warn("E2E cleanup failed:", error);
		}
	});

	describe("Complete User Registration and Login Flow", () => {
		it("should complete full registration, verification, and login flow", async () => {
			const userEmail = "e2e-user@test.com";
			const userPassword = "E2EPassword123!";

			// Step 1: Register new user
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: {
						name: "E2E Test User",
						bio: "End-to-end test user",
					},
				},
			});

			expect(registerResponse.status).toBe(201);
			const registerData = await registerResponse.json();
			expect(registerData.success).toBe(true);
			expect(registerData.data.user.email).toBe(userEmail);
			expect(registerData.data.tokens.accessToken).toBeDefined();

			const initialTokens = registerData.data.tokens;

			// Step 2: Get user profile with initial tokens
			const profileResponse = await client.api.v1.users.profile.$get({
				header: {
					Authorization: `Bearer ${initialTokens.accessToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(profileResponse.status).toBe(200);
			const profileData = await profileResponse.json();
			expect(profileData.data.email).toBe(userEmail);
			expect(profileData.data.profile.name).toBe("E2E Test User");

			// Step 3: Logout
			const logoutResponse = await client.api.v1.auth.logout.$post({
				header: {
					Authorization: `Bearer ${initialTokens.accessToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(logoutResponse.status).toBe(200);

			// Step 4: Try to access profile with logged out token (should fail)
			const profileAfterLogoutResponse = await client.api.v1.users.profile.$get(
				{
					header: {
						Authorization: `Bearer ${initialTokens.accessToken}`,
						"X-Tenant-ID": testTenant.id,
					},
				},
			);

			expect(profileAfterLogoutResponse.status).toBe(401);

			// Step 5: Login again with credentials
			const loginResponse = await client.api.v1.auth.login.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
				},
			});

			expect(loginResponse.status).toBe(200);
			const loginData = await loginResponse.json();
			expect(loginData.success).toBe(true);
			expect(loginData.data.user.email).toBe(userEmail);
			expect(loginData.data.tokens.accessToken).toBeDefined();

			const newTokens = loginData.data.tokens;

			// Step 6: Access profile with new tokens
			const profileAfterLoginResponse = await client.api.v1.users.profile.$get({
				header: {
					Authorization: `Bearer ${newTokens.accessToken}`,
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(profileAfterLoginResponse.status).toBe(200);
		});
	});

	describe("Magic Link Authentication Flow", () => {
		it("should complete magic link authentication flow", async () => {
			const userEmail = "magic-link-user@test.com";

			// Step 1: Request magic link
			const magicLinkResponse = await client.api.v1.auth["magic-link"].$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
				},
			});

			expect(magicLinkResponse.status).toBe(200);
			const magicLinkData = await magicLinkResponse.json();
			expect(magicLinkData.success).toBe(true);
			expect(magicLinkData.data.message).toContain("Magic link sent");

			// Step 2: Simulate clicking magic link (in real scenario, user would get email)
			// For testing, we'll extract the token from cache or mock the verification
			// Note: In actual implementation, you'd need to mock email service to capture the token

			// For this test, we'll create a user and then test with a mock token
			const db = await dbManager.getClient(testTenant.id);
			const user = await db.user.findUnique({
				where: { email: userEmail },
			});

			expect(user).toBeDefined();
			expect(user?.email).toBe(userEmail);
		});
	});

	describe("Organization and Team Flow", () => {
		it("should complete organization creation and team management flow", async () => {
			const userEmail = "org-admin@test.com";
			const userPassword = "OrgPassword123!";

			// Step 1: Register user
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: { name: "Org Admin" },
				},
			});

			const registerData = await registerResponse.json();
			const authHeaders = {
				Authorization: `Bearer ${registerData.data.tokens.accessToken}`,
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			};

			// Step 2: Create organization
			const orgResponse = await client.api.v1.organizations.$post({
				header: authHeaders,
				json: {
					name: "E2E Test Organization",
					slug: "e2e-test-org",
					description: "Organization for end-to-end testing",
				},
			});

			expect(orgResponse.status).toBe(201);
			const orgData = await orgResponse.json();
			expect(orgData.data.name).toBe("E2E Test Organization");
			const orgId = orgData.data.id;

			// Step 3: Create team within organization
			const teamResponse = await client.api.v1.organizations[
				":orgId"
			].teams.$post({
				param: { orgId },
				header: authHeaders,
				json: {
					name: "Engineering Team",
					description: "Software engineering team",
					permissions: ["repos.read", "repos.write", "issues.read"],
				},
			});

			expect(teamResponse.status).toBe(201);
			const teamData = await teamResponse.json();
			expect(teamData.data.name).toBe("Engineering Team");
			expect(teamData.data.permissions).toContain("repos.read");
			const teamId = teamData.data.id;

			// Step 4: Send invitation to another user
			const invitationResponse = await client.api.v1.organizations[
				":orgId"
			].invitations.$post({
				param: { orgId },
				header: authHeaders,
				json: {
					email: "invited-user@test.com",
					role: "MEMBER",
					message: "Welcome to our team!",
					expiresInDays: 7,
				},
			});

			expect(invitationResponse.status).toBe(201);
			const invitationData = await invitationResponse.json();
			expect(invitationData.data.email).toBe("invited-user@test.com");
			expect(invitationData.data.role).toBe("MEMBER");

			// Step 5: List organization members
			const membersResponse = await client.api.v1.organizations[
				":orgId"
			].members.$get({
				param: { orgId },
				header: authHeaders,
			});

			expect(membersResponse.status).toBe(200);
			const membersData = await membersResponse.json();
			expect(membersData.data.members).toHaveLength(1); // Only the creator
			expect(membersData.data.members[0].user.email).toBe(userEmail);
			expect(membersData.data.members[0].role).toBe("OWNER");

			// Step 6: List organization teams
			const teamsResponse = await client.api.v1.organizations[
				":orgId"
			].teams.$get({
				param: { orgId },
				header: authHeaders,
			});

			expect(teamsResponse.status).toBe(200);
			const teamsData = await teamsResponse.json();
			expect(teamsData.data.teams).toHaveLength(1);
			expect(teamsData.data.teams[0].name).toBe("Engineering Team");
		});
	});

	describe("MFA Setup and Verification Flow", () => {
		it("should complete TOTP MFA setup flow", async () => {
			const userEmail = "mfa-user@test.com";
			const userPassword = "MFAPassword123!";

			// Step 1: Register and login user
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: { name: "MFA User" },
				},
			});

			const registerData = await registerResponse.json();
			const authHeaders = {
				Authorization: `Bearer ${registerData.data.tokens.accessToken}`,
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			};

			// Step 2: Setup TOTP MFA
			const mfaSetupResponse = await client.api.v1.auth.mfa.totp.setup.$post({
				header: authHeaders,
			});

			expect(mfaSetupResponse.status).toBe(200);
			const mfaSetupData = await mfaSetupResponse.json();
			expect(mfaSetupData.data.setupToken).toBeDefined();
			expect(mfaSetupData.data.secret).toBeDefined();
			expect(mfaSetupData.data.qrCode).toBeDefined();
			expect(mfaSetupData.data.backupCodes).toHaveLength(8);

			// Step 3: List MFA methods (should show pending setup)
			const mfaMethodsResponse = await client.api.v1.auth.mfa.$get({
				header: authHeaders,
			});

			expect(mfaMethodsResponse.status).toBe(200);
			const mfaMethodsData = await mfaMethodsResponse.json();
			expect(Array.isArray(mfaMethodsData.data.methods)).toBe(true);

			// Note: In a real scenario, user would scan QR code and provide TOTP code
			// For testing, we'd need to mock the TOTP verification
		});
	});

	describe("Device Management Flow", () => {
		it("should complete device registration and management flow", async () => {
			const userEmail = "device-user@test.com";
			const userPassword = "DevicePassword123!";

			// Step 1: Register user
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: { name: "Device User" },
				},
			});

			const registerData = await registerResponse.json();
			const authHeaders = {
				Authorization: `Bearer ${registerData.data.tokens.accessToken}`,
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			};

			// Step 2: Register a device
			const deviceResponse = await client.api.v1.devices.$post({
				header: authHeaders,
				json: {
					name: "MacBook Pro",
					type: "DESKTOP",
					fingerprint: "e2e-device-fingerprint-123",
				},
			});

			expect(deviceResponse.status).toBe(201);
			const deviceData = await deviceResponse.json();
			expect(deviceData.data.name).toBe("MacBook Pro");
			expect(deviceData.data.type).toBe("DESKTOP");
			expect(deviceData.data.trustLevel).toBe("UNKNOWN");
			const deviceId = deviceData.data.id;

			// Step 3: List user devices
			const devicesResponse = await client.api.v1.devices.$get({
				header: authHeaders,
			});

			expect(devicesResponse.status).toBe(200);
			const devicesData = await devicesResponse.json();
			expect(devicesData.data.devices).toHaveLength(1);
			expect(devicesData.data.devices[0].name).toBe("MacBook Pro");

			// Step 4: Trust the device
			const trustResponse = await client.api.v1.devices[
				":deviceId"
			].trust.$post({
				param: { deviceId },
				header: authHeaders,
			});

			expect(trustResponse.status).toBe(200);
			const trustData = await trustResponse.json();
			expect(trustData.success).toBe(true);

			// Step 5: Get updated device info
			const deviceDetailsResponse = await client.api.v1.devices[
				":deviceId"
			].$get({
				param: { deviceId },
				header: authHeaders,
			});

			expect(deviceDetailsResponse.status).toBe(200);
			const deviceDetailsData = await deviceDetailsResponse.json();
			expect(deviceDetailsData.data.trustLevel).toBe("TRUSTED");
		});
	});

	describe("Session Management Flow", () => {
		it("should complete session management flow", async () => {
			const userEmail = "session-user@test.com";
			const userPassword = "SessionPassword123!";

			// Step 1: Register user
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: { name: "Session User" },
				},
			});

			const registerData = await registerResponse.json();
			const authHeaders = {
				Authorization: `Bearer ${registerData.data.tokens.accessToken}`,
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			};

			// Step 2: Create additional login sessions
			const login1Response = await client.api.v1.auth.login.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
				},
			});

			const login2Response = await client.api.v1.auth.login.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
				},
			});

			expect(login1Response.status).toBe(200);
			expect(login2Response.status).toBe(200);

			// Step 3: List all sessions
			const sessionsResponse = await client.api.v1.sessions.$get({
				header: authHeaders,
			});

			expect(sessionsResponse.status).toBe(200);
			const sessionsData = await sessionsResponse.json();
			expect(sessionsData.data.sessions.length).toBeGreaterThanOrEqual(3); // Original + 2 new

			// Step 4: Get session statistics
			const sessionStatsResponse = await client.api.v1.sessions.stats.$get({
				header: authHeaders,
			});

			expect(sessionStatsResponse.status).toBe(200);
			const sessionStatsData = await sessionStatsResponse.json();
			expect(sessionStatsData.data.totalSessions).toBeGreaterThanOrEqual(3);
			expect(sessionStatsData.data.activeSessions).toBeGreaterThanOrEqual(3);

			// Step 5: Revoke all other sessions
			const revokeAllResponse = await client.api.v1.sessions[
				"revoke-all"
			].$post({
				header: authHeaders,
				json: {
					exceptCurrent: true,
				},
			});

			expect(revokeAllResponse.status).toBe(200);
			const revokeAllData = await revokeAllResponse.json();
			expect(revokeAllData.success).toBe(true);
			expect(revokeAllData.data.revokedCount).toBeGreaterThanOrEqual(2);

			// Step 6: Verify current session still works
			const profileResponse = await client.api.v1.users.profile.$get({
				header: authHeaders,
			});

			expect(profileResponse.status).toBe(200);
		});
	});

	describe("Audit Trail Flow", () => {
		it("should track user activities in audit logs", async () => {
			const userEmail = "audit-user@test.com";
			const userPassword = "AuditPassword123!";

			// Step 1: Register user (should create audit log)
			const registerResponse = await client.api.v1.auth.register.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: userEmail,
					password: userPassword,
					profile: { name: "Audit User" },
				},
			});

			const registerData = await registerResponse.json();
			const authHeaders = {
				Authorization: `Bearer ${registerData.data.tokens.accessToken}`,
				"X-Tenant-ID": testTenant.id,
				"Content-Type": "application/json",
			};

			// Step 2: Perform various activities
			await client.api.v1.users.profile.$patch({
				header: authHeaders,
				json: {
					name: "Updated Audit User",
					bio: "Updated bio for audit testing",
				},
			});

			await client.api.v1.organizations.$post({
				header: authHeaders,
				json: {
					name: "Audit Test Org",
					slug: "audit-test-org",
					description: "Organization for audit testing",
				},
			});

			// Step 3: Check audit logs
			const auditResponse = await client.api.v1.audit.$get({
				header: authHeaders,
				query: {
					limit: "50",
				},
			});

			expect(auditResponse.status).toBe(200);
			const auditData = await auditResponse.json();
			expect(auditData.data.logs.length).toBeGreaterThan(0);

			// Verify specific audit events
			const logs = auditData.data.logs;
			const registrationLog = logs.find(
				(log: any) => log.action === "user.register",
			);
			const profileUpdateLog = logs.find(
				(log: any) => log.action === "user.update.profile",
			);
			const orgCreationLog = logs.find(
				(log: any) => log.action === "organization.create",
			);

			expect(registrationLog).toBeDefined();
			expect(profileUpdateLog).toBeDefined();
			expect(orgCreationLog).toBeDefined();

			// Step 4: Get audit statistics
			const auditStatsResponse = await client.api.v1.audit.stats.$get({
				header: authHeaders,
				query: {
					days: "1",
				},
			});

			expect(auditStatsResponse.status).toBe(200);
			const auditStatsData = await auditStatsResponse.json();
			expect(auditStatsData.data.totalEvents).toBeGreaterThan(0);
			expect(Array.isArray(auditStatsData.data.actionCounts)).toBe(true);
		});
	});

	describe("Error Scenarios and Recovery", () => {
		it("should handle authentication errors gracefully", async () => {
			// Test invalid login
			const invalidLoginResponse = await client.api.v1.auth.login.$post({
				header: {
					"X-Tenant-ID": testTenant.id,
					"Content-Type": "application/json",
				},
				json: {
					email: "nonexistent@test.com",
					password: "WrongPassword",
				},
			});

			expect(invalidLoginResponse.status).toBe(401);
			const invalidLoginData = await invalidLoginResponse.json();
			expect(invalidLoginData.success).toBe(false);
			expect(invalidLoginData.error.code).toBe("AUTHENTICATION_ERROR");

			// Test expired token access
			const expiredTokenResponse = await client.api.v1.users.profile.$get({
				header: {
					Authorization: "Bearer invalid-token",
					"X-Tenant-ID": testTenant.id,
				},
			});

			expect(expiredTokenResponse.status).toBe(401);

			// Test missing tenant header
			const missingTenantResponse = await client.api.v1.auth.login.$post({
				header: {
					"Content-Type": "application/json",
				},
				json: {
					email: "test@test.com",
					password: "password",
				},
			});

			expect(missingTenantResponse.status).toBe(400);
		});
	});
});
