import { dbManager } from "@user-service/database";
import {
	CACHE_KEYS,
	ForbiddenError,
	NotFoundError,
} from "@user-service/shared";
import { logger } from "../lib/logger";
import { CacheService } from "./cache.service";

const cache = CacheService.getInstance();

export interface SessionFilters {
	deviceId?: string;
	active?: boolean;
	limit?: number;
	offset?: number;
}

export class SessionService {
	async listSessions(
		userId: string,
		tenantId: string,
		filters?: SessionFilters,
	) {
		const db = await dbManager.getClient(tenantId);

		const limit = filters?.limit || 20;
		const offset = filters?.offset || 0;

		const whereClause: any = { userId };

		if (filters?.deviceId) {
			whereClause.deviceId = filters.deviceId;
		}

		if (filters?.active === true) {
			whereClause.expiresAt = { gt: new Date() };
		} else if (filters?.active === false) {
			whereClause.expiresAt = { lte: new Date() };
		}

		const [sessions, total] = await Promise.all([
			db.session.findMany({
				where: whereClause,
				include: {
					device: {
						select: {
							id: true,
							name: true,
							type: true,
							platform: true,
							browser: true,
						},
					},
				},
				orderBy: {
					lastActivity: "desc",
				},
				take: limit,
				skip: offset,
			}),
			db.session.count({ where: whereClause }),
		]);

		// Get current session ID from context (would be passed from middleware)
		const currentSessionId = null; // TODO: Get from context

		return {
			sessions: sessions.map((session) => ({
				id: session.id,
				device: session.device,
				ipAddress: session.ipAddress,
				userAgent: session.userAgent,
				createdAt: session.createdAt,
				lastActivity: session.lastActivity,
				expiresAt: session.expiresAt,
				isActive: session.expiresAt > new Date(),
				isCurrent: session.id === currentSessionId,
			})),
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + limit < total,
			},
		};
	}

	async getSession(sessionId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const session = await db.session.findUnique({
			where: { id: sessionId },
			include: {
				device: true,
			},
		});

		if (!session) {
			throw new NotFoundError("Session");
		}

		if (session.userId !== userId) {
			throw new ForbiddenError("You can only view your own sessions");
		}

		// Get session activity from audit logs
		const activities = await db.auditLog.findMany({
			where: {
				userId,
				timestamp: {
					gte: session.createdAt,
				},
			},
			select: {
				action: true,
				resource: true,
				timestamp: true,
				ipAddress: true,
			},
			orderBy: {
				timestamp: "desc",
			},
			take: 10,
		});

		return {
			...session,
			isActive: session.expiresAt > new Date(),
			recentActivity: activities,
		};
	}

	async revokeSession(sessionId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const session = await db.session.findUnique({
			where: { id: sessionId },
		});

		if (!session) {
			throw new NotFoundError("Session");
		}

		if (session.userId !== userId) {
			throw new ForbiddenError("You can only revoke your own sessions");
		}

		// Update session to expire immediately
		await db.session.update({
			where: { id: sessionId },
			data: {
				expiresAt: new Date(),
			},
		});

		// Clear session from cache
		await cache.delete(CACHE_KEYS.SESSION(session.token));

		// Log revocation
		await db.auditLog.create({
			data: {
				userId,
				action: "session.revoked",
				resource: "session",
				resourceId: sessionId,
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	async revokeAllSessions(
		userId: string,
		tenantId: string,
		exceptCurrentSession?: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get all active sessions
		const sessions = await db.session.findMany({
			where: {
				userId,
				expiresAt: { gt: new Date() },
				...(exceptCurrentSession ? { NOT: { id: exceptCurrentSession } } : {}),
			},
			select: {
				id: true,
				token: true,
			},
		});

		if (sessions.length === 0) {
			return {
				success: true,
				sessionsRevoked: 0,
			};
		}

		// Expire all sessions
		const result = await db.session.updateMany({
			where: {
				id: { in: sessions.map((s) => s.id) },
			},
			data: {
				expiresAt: new Date(),
			},
		});

		// Clear all sessions from cache
		await Promise.all(
			sessions.map((session) =>
				cache.delete(CACHE_KEYS.SESSION(session.token)),
			),
		);

		// Log bulk revocation
		await db.auditLog.create({
			data: {
				userId,
				action: "session.revoked_all",
				resource: "session",
				metadata: {
					count: result.count,
					exceptCurrent: !!exceptCurrentSession,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return {
			success: true,
			sessionsRevoked: result.count,
		};
	}

	async extendSession(sessionId: string, userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const session = await db.session.findUnique({
			where: { id: sessionId },
		});

		if (!session) {
			throw new NotFoundError("Session");
		}

		if (session.userId !== userId) {
			throw new ForbiddenError("You can only extend your own sessions");
		}

		if (session.expiresAt <= new Date()) {
			throw new ForbiddenError("Cannot extend expired session");
		}

		// Extend session by 30 days
		const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

		const extendedSession = await db.session.update({
			where: { id: sessionId },
			data: {
				expiresAt: newExpiresAt,
				lastActivity: new Date(),
			},
		});

		// Update cache
		await cache.set(
			CACHE_KEYS.SESSION(session.token),
			{
				userId: session.userId,
				tenantId,
				sessionId: session.id,
			},
			30 * 24 * 60 * 60, // 30 days in seconds
		);

		return extendedSession;
	}

	async getSessionStats(userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const [totalSessions, activeSessions, devicesWithSessions, recentActivity] =
			await Promise.all([
				db.session.count({
					where: { userId },
				}),
				db.session.count({
					where: {
						userId,
						expiresAt: { gt: new Date() },
					},
				}),
				db.session.groupBy({
					by: ["deviceId"],
					where: {
						userId,
						expiresAt: { gt: new Date() },
					},
					_count: true,
				}),
				db.session.findMany({
					where: {
						userId,
						lastActivity: {
							gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
						},
					},
					select: {
						id: true,
						lastActivity: true,
						device: {
							select: {
								name: true,
								type: true,
							},
						},
					},
					orderBy: {
						lastActivity: "desc",
					},
					take: 5,
				}),
			]);

		return {
			totalSessions,
			activeSessions,
			devicesWithActiveSessions: devicesWithSessions.length,
			recentActivity: recentActivity.map((activity) => ({
				sessionId: activity.id,
				lastActivity: activity.lastActivity,
				deviceName: activity.device?.name,
				deviceType: activity.device?.type,
			})),
		};
	}

	async updateSessionActivity(sessionId: string, ipAddress?: string) {
		const db = await dbManager.getClient(""); // Get from session context

		try {
			await db.session.update({
				where: { id: sessionId },
				data: {
					lastActivity: new Date(),
					...(ipAddress ? { ipAddress } : {}),
				},
			});
		} catch (error) {
			// Don't fail requests due to activity update errors
			logger.error({ error, sessionId }, "Failed to update session activity");
		}
	}

	async cleanupExpiredSessions(tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Delete sessions expired more than 30 days ago
		const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

		const result = await db.session.deleteMany({
			where: {
				expiresAt: { lt: cutoffDate },
			},
		});

		logger.info(
			{ tenantId, deletedCount: result.count },
			"Cleaned up expired sessions",
		);

		return result.count;
	}
}

export const sessionService = new SessionService();
