import { dbManager } from "@user-service/database";
import {
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheService } from "../../apps/api/src/services/cache.service";
import { DeviceService } from "../../apps/api/src/services/device.service";
import { EventService } from "../../apps/api/src/services/event.service";
import { SessionService } from "../../apps/api/src/services/session.service";
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

describe("DeviceService", () => {
	let deviceService: DeviceService;

	const mockDevice = {
		id: "device-123",
		userId: "user-123",
		name: "My MacBook",
		type: "DESKTOP",
		fingerprint: "fp-123",
		trustLevel: "TRUSTED",
		lastSeenAt: new Date(),
		createdAt: new Date(),
		metadata: {
			userAgent: "Mozilla/5.0...",
			os: "macOS",
			browser: "Chrome",
		},
	};

	beforeEach(() => {
		deviceService = new DeviceService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any);
		vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("registerDevice", () => {
		it("should successfully register new device", async () => {
			// Arrange
			const deviceData = {
				name: "iPhone 15",
				type: "MOBILE" as const,
				fingerprint: "mobile-fp-123",
				userAgent: "iPhone Safari",
				ipAddress: "192.168.1.100",
			};

			mockDbOperations.device.findFirst.mockResolvedValue(null); // No existing device
			mockDbOperations.device.create.mockResolvedValue({
				...mockDevice,
				...deviceData,
				id: "new-device-123",
			});

			// Act
			const result = await deviceService.registerDevice(
				"tenant-123",
				"user-123",
				deviceData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: "new-device-123",
					name: deviceData.name,
					type: deviceData.type,
					trustLevel: "UNKNOWN", // New devices start as unknown
				}),
			);

			expect(mockDbOperations.device.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					userId: "user-123",
					name: deviceData.name,
					type: deviceData.type,
					fingerprint: deviceData.fingerprint,
					trustLevel: "UNKNOWN",
					metadata: expect.objectContaining({
						userAgent: deviceData.userAgent,
						ipAddress: deviceData.ipAddress,
					}),
				}),
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should update existing device if found", async () => {
			// Arrange
			const deviceData = {
				name: "Updated MacBook",
				type: "DESKTOP" as const,
				fingerprint: "existing-fp-123",
				userAgent: "Updated Chrome",
				ipAddress: "192.168.1.200",
			};

			const existingDevice = {
				...mockDevice,
				fingerprint: deviceData.fingerprint,
			};

			mockDbOperations.device.findFirst.mockResolvedValue(existingDevice);
			mockDbOperations.device.update.mockResolvedValue({
				...existingDevice,
				...deviceData,
				lastSeenAt: new Date(),
			});

			// Act
			const result = await deviceService.registerDevice(
				"tenant-123",
				"user-123",
				deviceData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: existingDevice.id,
					name: deviceData.name,
				}),
			);

			expect(mockDbOperations.device.update).toHaveBeenCalledWith({
				where: { id: existingDevice.id },
				data: expect.objectContaining({
					name: deviceData.name,
					lastSeenAt: expect.any(Date),
					metadata: expect.objectContaining({
						userAgent: deviceData.userAgent,
						ipAddress: deviceData.ipAddress,
					}),
				}),
			});
		});

		it("should validate device type", async () => {
			// Arrange
			const invalidDeviceData = {
				name: "Test Device",
				type: "INVALID_TYPE" as any,
				fingerprint: "fp-123",
				userAgent: "Test Agent",
				ipAddress: "127.0.0.1",
			};

			// Act & Assert
			await expect(
				deviceService.registerDevice(
					"tenant-123",
					"user-123",
					invalidDeviceData,
				),
			).rejects.toThrow(ValidationError);
		});
	});

	describe("getDevice", () => {
		it("should successfully get device", async () => {
			// Arrange
			mockDbOperations.device.findFirst.mockResolvedValue(mockDevice);

			// Act
			const result = await deviceService.getDevice(
				"tenant-123",
				"user-123",
				"device-123",
			);

			// Assert
			expect(result).toEqual(mockDevice);
			expect(mockDbOperations.device.findFirst).toHaveBeenCalledWith({
				where: {
					id: "device-123",
					userId: "user-123",
				},
			});
		});

		it("should throw NotFoundError for non-existent device", async () => {
			// Arrange
			mockDbOperations.device.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				deviceService.getDevice("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("listDevices", () => {
		it("should return user devices", async () => {
			// Arrange
			const devices = [
				mockDevice,
				{
					...mockDevice,
					id: "device-456",
					name: "iPhone",
					type: "MOBILE",
				},
			];

			mockDbOperations.device.findMany.mockResolvedValue(devices);

			// Act
			const result = await deviceService.listDevices("tenant-123", "user-123");

			// Assert
			expect(result).toEqual({
				devices: expect.arrayContaining([
					expect.objectContaining({ id: "device-123" }),
					expect.objectContaining({ id: "device-456" }),
				]),
			});
		});

		it("should support pagination", async () => {
			// Arrange
			mockDbOperations.device.findMany.mockResolvedValue([]);

			// Act
			await deviceService.listDevices("tenant-123", "user-123", {
				limit: 10,
				offset: 20,
			});

			// Assert
			expect(mockDbOperations.device.findMany).toHaveBeenCalledWith({
				where: { userId: "user-123" },
				take: 10,
				skip: 20,
				orderBy: { lastSeenAt: "desc" },
			});
		});
	});

	describe("trustDevice", () => {
		it("should successfully trust device", async () => {
			// Arrange
			const untrustedDevice = {
				...mockDevice,
				trustLevel: "UNKNOWN",
			};

			mockDbOperations.device.findFirst.mockResolvedValue(untrustedDevice);
			mockDbOperations.device.update.mockResolvedValue({
				...untrustedDevice,
				trustLevel: "TRUSTED",
			});

			// Act
			const result = await deviceService.trustDevice(
				"tenant-123",
				"user-123",
				"device-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.device.update).toHaveBeenCalledWith({
				where: { id: "device-123" },
				data: { trustLevel: "TRUSTED" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw NotFoundError for non-existent device", async () => {
			// Arrange
			mockDbOperations.device.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				deviceService.trustDevice("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("removeDevice", () => {
		it("should successfully remove device", async () => {
			// Arrange
			mockDbOperations.device.findFirst.mockResolvedValue(mockDevice);
			mockDbOperations.device.delete.mockResolvedValue(mockDevice);
			mockDbOperations.session.deleteMany.mockResolvedValue({ count: 2 });

			// Act
			const result = await deviceService.removeDevice(
				"tenant-123",
				"user-123",
				"device-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.session.deleteMany).toHaveBeenCalledWith({
				where: { deviceId: "device-123" },
			});
			expect(mockDbOperations.device.delete).toHaveBeenCalledWith({
				where: { id: "device-123" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});
	});

	describe("logoutDevice", () => {
		it("should successfully logout all sessions on device", async () => {
			// Arrange
			mockDbOperations.device.findFirst.mockResolvedValue(mockDevice);
			mockDbOperations.session.deleteMany.mockResolvedValue({ count: 3 });

			// Act
			const result = await deviceService.logoutDevice(
				"tenant-123",
				"user-123",
				"device-123",
			);

			// Assert
			expect(result).toEqual({
				success: true,
				sessionsTerminated: 3,
			});
			expect(mockDbOperations.session.deleteMany).toHaveBeenCalledWith({
				where: { deviceId: "device-123" },
			});
		});
	});
});

describe("SessionService", () => {
	let sessionService: SessionService;

	const mockSession = {
		id: "session-123",
		userId: "user-123",
		deviceId: "device-123",
		token: "session-token-123",
		refreshToken: "refresh-token-123",
		ipAddress: "192.168.1.100",
		userAgent: "Mozilla/5.0...",
		expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		createdAt: new Date(),
		lastActiveAt: new Date(),
		device: mockDevice,
	};

	beforeEach(() => {
		sessionService = new SessionService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any);
		vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("createSession", () => {
		it("should successfully create session", async () => {
			// Arrange
			const sessionData = {
				userId: "user-123",
				deviceId: "device-123",
				token: "new-token-123",
				refreshToken: "new-refresh-123",
				ipAddress: "192.168.1.100",
				userAgent: "Chrome Browser",
				expiresAt: new Date(Date.now() + 86400000), // 24 hours
			};

			mockDbOperations.session.create.mockResolvedValue({
				...mockSession,
				...sessionData,
				id: "new-session-123",
			});

			// Act
			const result = await sessionService.createSession(
				"tenant-123",
				sessionData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: "new-session-123",
					token: sessionData.token,
					refreshToken: sessionData.refreshToken,
				}),
			);

			expect(mockDbOperations.session.create).toHaveBeenCalledWith({
				data: sessionData,
				include: { device: true },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});
	});

	describe("getSession", () => {
		it("should successfully get session", async () => {
			// Arrange
			mockDbOperations.session.findFirst.mockResolvedValue(mockSession);

			// Act
			const result = await sessionService.getSession(
				"tenant-123",
				"user-123",
				"session-123",
			);

			// Assert
			expect(result).toEqual(mockSession);
			expect(mockDbOperations.session.findFirst).toHaveBeenCalledWith({
				where: {
					id: "session-123",
					userId: "user-123",
				},
				include: { device: true },
			});
		});

		it("should throw NotFoundError for non-existent session", async () => {
			// Arrange
			mockDbOperations.session.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				sessionService.getSession("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("listSessions", () => {
		it("should return user sessions", async () => {
			// Arrange
			const sessions = [
				mockSession,
				{
					...mockSession,
					id: "session-456",
					deviceId: "device-456",
				},
			];

			mockDbOperations.session.findMany.mockResolvedValue(sessions);

			// Act
			const result = await sessionService.listSessions(
				"tenant-123",
				"user-123",
			);

			// Assert
			expect(result).toEqual({
				sessions: expect.arrayContaining([
					expect.objectContaining({ id: "session-123" }),
					expect.objectContaining({ id: "session-456" }),
				]),
			});
		});

		it("should filter active sessions only", async () => {
			// Arrange
			const activeSessions = [mockSession];

			mockDbOperations.session.findMany.mockResolvedValue(activeSessions);

			// Act
			await sessionService.listSessions("tenant-123", "user-123", {
				active: true,
			});

			// Assert
			expect(mockDbOperations.session.findMany).toHaveBeenCalledWith({
				where: {
					userId: "user-123",
					expiresAt: { gt: expect.any(Date) },
				},
				include: { device: true },
				orderBy: { lastActiveAt: "desc" },
			});
		});

		it("should support pagination", async () => {
			// Arrange
			mockDbOperations.session.findMany.mockResolvedValue([]);

			// Act
			await sessionService.listSessions("tenant-123", "user-123", {
				limit: 10,
				offset: 20,
			});

			// Assert
			expect(mockDbOperations.session.findMany).toHaveBeenCalledWith({
				where: { userId: "user-123" },
				include: { device: true },
				take: 10,
				skip: 20,
				orderBy: { lastActiveAt: "desc" },
			});
		});
	});

	describe("updateSessionActivity", () => {
		it("should successfully update session activity", async () => {
			// Arrange
			const updateData = {
				ipAddress: "192.168.1.200",
				userAgent: "Updated Chrome",
				lastActiveAt: new Date(),
			};

			mockDbOperations.session.findUnique.mockResolvedValue(mockSession);
			mockDbOperations.session.update.mockResolvedValue({
				...mockSession,
				...updateData,
			});

			// Act
			const result = await sessionService.updateSessionActivity(
				"tenant-123",
				"session-123",
				updateData,
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.session.update).toHaveBeenCalledWith({
				where: { id: "session-123" },
				data: updateData,
			});
		});

		it("should throw NotFoundError for non-existent session", async () => {
			// Arrange
			mockDbOperations.session.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				sessionService.updateSessionActivity("tenant-123", "non-existent", {
					lastActiveAt: new Date(),
				}),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("revokeSession", () => {
		it("should successfully revoke session", async () => {
			// Arrange
			mockDbOperations.session.findFirst.mockResolvedValue(mockSession);
			mockDbOperations.session.delete.mockResolvedValue(mockSession);

			// Act
			const result = await sessionService.revokeSession(
				"tenant-123",
				"user-123",
				"session-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.session.delete).toHaveBeenCalledWith({
				where: { id: "session-123" },
			});
			expect(mockCache.del).toHaveBeenCalled();
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw NotFoundError for non-existent session", async () => {
			// Arrange
			mockDbOperations.session.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				sessionService.revokeSession("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("revokeAllSessions", () => {
		it("should successfully revoke all sessions", async () => {
			// Arrange
			const sessionsToRevoke = [mockSession];

			mockDbOperations.session.findMany.mockResolvedValue(sessionsToRevoke);
			mockDbOperations.session.deleteMany.mockResolvedValue({ count: 1 });

			// Act
			const result = await sessionService.revokeAllSessions(
				"tenant-123",
				"user-123",
			);

			// Assert
			expect(result).toEqual({
				success: true,
				revokedCount: 1,
			});

			expect(mockDbOperations.session.deleteMany).toHaveBeenCalledWith({
				where: { userId: "user-123" },
			});
			expect(mockCache.del).toHaveBeenCalled();
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should exclude current session when requested", async () => {
			// Arrange
			const currentSessionId = "current-session-123";
			const sessionsToRevoke = [{ ...mockSession, id: "other-session-456" }];

			mockDbOperations.session.findMany.mockResolvedValue(sessionsToRevoke);
			mockDbOperations.session.deleteMany.mockResolvedValue({ count: 1 });

			// Act
			const result = await sessionService.revokeAllSessions(
				"tenant-123",
				"user-123",
				{ exceptCurrent: currentSessionId },
			);

			// Assert
			expect(result).toEqual({
				success: true,
				revokedCount: 1,
			});

			expect(mockDbOperations.session.deleteMany).toHaveBeenCalledWith({
				where: {
					userId: "user-123",
					id: { not: currentSessionId },
				},
			});
		});
	});

	describe("cleanupExpiredSessions", () => {
		it("should successfully cleanup expired sessions", async () => {
			// Arrange
			mockDbOperations.session.deleteMany.mockResolvedValue({ count: 5 });

			// Act
			const result = await sessionService.cleanupExpiredSessions("tenant-123");

			// Assert
			expect(result).toEqual({
				success: true,
				cleanedCount: 5,
			});

			expect(mockDbOperations.session.deleteMany).toHaveBeenCalledWith({
				where: {
					expiresAt: { lt: expect.any(Date) },
				},
			});
		});
	});

	describe("getSessionStatistics", () => {
		it("should return session statistics", async () => {
			// Arrange
			const stats = {
				totalSessions: 10,
				activeSessions: 5,
				uniqueDevices: 3,
				recentLogins: 2,
			};

			mockDbOperations.session.count
				.mockResolvedValueOnce(stats.totalSessions) // Total
				.mockResolvedValueOnce(stats.activeSessions); // Active

			mockDbOperations.session.groupBy.mockResolvedValue([
				{ deviceId: "device-1" },
				{ deviceId: "device-2" },
				{ deviceId: "device-3" },
			]);

			mockDbOperations.session.count.mockResolvedValueOnce(stats.recentLogins); // Recent

			// Act
			const result = await sessionService.getSessionStatistics(
				"tenant-123",
				"user-123",
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					totalSessions: stats.totalSessions,
					activeSessions: stats.activeSessions,
					uniqueDevices: 3,
					recentLogins: stats.recentLogins,
				}),
			);
		});
	});
});
