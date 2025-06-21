import { dbManager } from "@user-service/database";
import { ForbiddenError } from "@user-service/shared";
import { logger } from "../lib/logger";

export interface AuditLogFilters {
	userId?: string;
	action?: string;
	resource?: string;
	resourceId?: string;
	startDate?: Date;
	endDate?: Date;
	limit?: number;
	offset?: number;
}

export interface CreateAuditLogDto {
	userId?: string;
	action: string;
	resource: string;
	resourceId?: string;
	metadata?: Record<string, any>;
	ipAddress: string;
	userAgent: string;
}

export class AuditService {
	async createLog(tenantId: string, data: CreateAuditLogDto) {
		const db = await dbManager.getClient(tenantId);

		try {
			const log = await db.auditLog.create({
				data: {
					userId: data.userId,
					action: data.action,
					resource: data.resource,
					resourceId: data.resourceId,
					metadata: data.metadata,
					ipAddress: data.ipAddress,
					userAgent: data.userAgent,
				},
			});

			return log;
		} catch (error) {
			// Don't fail operations due to audit log errors
			logger.error({ error, data }, "Failed to create audit log");
			return null;
		}
	}

	async listLogs(
		tenantId: string,
		filters: AuditLogFilters,
		requestingUserId?: string,
		isAdmin = false,
	) {
		const db = await dbManager.getClient(tenantId);

		// Non-admin users can only view their own logs
		if (!isAdmin && filters.userId !== requestingUserId) {
			throw new ForbiddenError("You can only view your own audit logs");
		}

		const limit = filters.limit || 50;
		const offset = filters.offset || 0;

		const whereClause: any = {};

		if (filters.userId) {
			whereClause.userId = filters.userId;
		}

		if (filters.action) {
			whereClause.action = { contains: filters.action };
		}

		if (filters.resource) {
			whereClause.resource = filters.resource;
		}

		if (filters.resourceId) {
			whereClause.resourceId = filters.resourceId;
		}

		if (filters.startDate || filters.endDate) {
			whereClause.timestamp = {};
			if (filters.startDate) {
				whereClause.timestamp.gte = filters.startDate;
			}
			if (filters.endDate) {
				whereClause.timestamp.lte = filters.endDate;
			}
		}

		const [logs, total] = await Promise.all([
			db.auditLog.findMany({
				where: whereClause,
				include: {
					user: {
						select: {
							id: true,
							email: true,
							profile: true,
						},
					},
				},
				orderBy: {
					timestamp: "desc",
				},
				take: limit,
				skip: offset,
			}),
			db.auditLog.count({ where: whereClause }),
		]);

		return {
			logs: logs.map((log) => ({
				id: log.id,
				user: log.user
					? {
							id: log.user.id,
							email: log.user.email,
							name: (log.user.profile as any)?.name,
						}
					: null,
				action: log.action,
				resource: log.resource,
				resourceId: log.resourceId,
				metadata: log.metadata,
				ipAddress: log.ipAddress,
				userAgent: log.userAgent,
				timestamp: log.timestamp,
				actionDetails: this.getActionDetails(log.action),
			})),
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + limit < total,
			},
		};
	}

	async getLogStats(tenantId: string, userId?: string, days = 30) {
		const db = await dbManager.getClient(tenantId);

		const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

		const whereClause: any = {
			timestamp: { gte: startDate },
		};

		if (userId) {
			whereClause.userId = userId;
		}

		// Get action counts
		const actionCounts = await db.auditLog.groupBy({
			by: ["action"],
			where: whereClause,
			_count: true,
			orderBy: {
				_count: {
					action: "desc",
				},
			},
			take: 10,
		});

		// Get resource counts
		const resourceCounts = await db.auditLog.groupBy({
			by: ["resource"],
			where: whereClause,
			_count: true,
			orderBy: {
				_count: {
					resource: "desc",
				},
			},
		});

		// Get daily activity
		const logs = await db.auditLog.findMany({
			where: whereClause,
			select: {
				timestamp: true,
			},
			orderBy: {
				timestamp: "asc",
			},
		});

		// Group by day
		const dailyActivity = this.groupByDay(logs);

		// Get most active users (admin only)
		let topUsers = [];
		if (!userId) {
			const userActivity = await db.auditLog.groupBy({
				by: ["userId"],
				where: {
					...whereClause,
					userId: { not: null },
				},
				_count: true,
				orderBy: {
					_count: {
						userId: "desc",
					},
				},
				take: 5,
			});

			// Get user details
			const userIds = userActivity.map((u) => u.userId!).filter(Boolean);
			const users = await db.user.findMany({
				where: { id: { in: userIds } },
				select: {
					id: true,
					email: true,
					profile: true,
				},
			});

			const userMap = new Map(users.map((u) => [u.id, u]));

			topUsers = userActivity.map((activity) => ({
				user: userMap.get(activity.userId!)
					? {
							id: activity.userId!,
							email: userMap.get(activity.userId!)?.email,
							name: (userMap.get(activity.userId!)?.profile as any)?.name,
						}
					: null,
				count: activity._count,
			}));
		}

		return {
			period: {
				start: startDate,
				end: new Date(),
				days,
			},
			totalLogs: logs.length,
			topActions: actionCounts.map((item) => ({
				action: item.action,
				count: item._count,
				details: this.getActionDetails(item.action),
			})),
			resourceBreakdown: resourceCounts.map((item) => ({
				resource: item.resource,
				count: item._count,
			})),
			dailyActivity,
			...(topUsers.length > 0 ? { topUsers } : {}),
		};
	}

	async exportLogs(
		tenantId: string,
		filters: AuditLogFilters,
		format: "json" | "csv" = "json",
	) {
		const db = await dbManager.getClient(tenantId);

		// For exports, we'll limit to 10,000 records
		const limit = Math.min(filters.limit || 10000, 10000);

		const whereClause: any = {};

		if (filters.userId) {
			whereClause.userId = filters.userId;
		}

		if (filters.action) {
			whereClause.action = { contains: filters.action };
		}

		if (filters.resource) {
			whereClause.resource = filters.resource;
		}

		if (filters.startDate || filters.endDate) {
			whereClause.timestamp = {};
			if (filters.startDate) {
				whereClause.timestamp.gte = filters.startDate;
			}
			if (filters.endDate) {
				whereClause.timestamp.lte = filters.endDate;
			}
		}

		const logs = await db.auditLog.findMany({
			where: whereClause,
			include: {
				user: {
					select: {
						email: true,
					},
				},
			},
			orderBy: {
				timestamp: "desc",
			},
			take: limit,
		});

		if (format === "csv") {
			return this.convertToCSV(logs);
		}

		return logs;
	}

	private getActionDetails(action: string): {
		category: string;
		description: string;
		severity: "info" | "warning" | "critical";
	} {
		const [resource, verb] = action.split(".");

		const actionMap: Record<string, any> = {
			"auth.login": {
				category: "Authentication",
				description: "User logged in",
				severity: "info",
			},
			"auth.logout": {
				category: "Authentication",
				description: "User logged out",
				severity: "info",
			},
			"auth.register": {
				category: "Authentication",
				description: "New user registered",
				severity: "info",
			},
			"auth.failed": {
				category: "Authentication",
				description: "Failed login attempt",
				severity: "warning",
			},
			"password.changed": {
				category: "Security",
				description: "Password changed",
				severity: "warning",
			},
			"mfa.enabled": {
				category: "Security",
				description: "MFA enabled",
				severity: "info",
			},
			"mfa.disabled": {
				category: "Security",
				description: "MFA disabled",
				severity: "warning",
			},
			"organization.created": {
				category: "Organization",
				description: "Organization created",
				severity: "info",
			},
			"organization.deleted": {
				category: "Organization",
				description: "Organization deleted",
				severity: "critical",
			},
			"account.deleted": {
				category: "Account",
				description: "Account deleted",
				severity: "critical",
			},
		};

		return (
			actionMap[action] || {
				category: resource || "Other",
				description: action,
				severity: "info",
			}
		);
	}

	private groupByDay(logs: { timestamp: Date }[]): Array<{
		date: string;
		count: number;
	}> {
		const grouped = logs.reduce(
			(acc, log) => {
				const date = log.timestamp.toISOString().split("T")[0];
				acc[date] = (acc[date] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		return Object.entries(grouped)
			.map(([date, count]) => ({ date, count }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	private convertToCSV(logs: any[]): string {
		const headers = [
			"Timestamp",
			"User Email",
			"Action",
			"Resource",
			"Resource ID",
			"IP Address",
			"User Agent",
		];

		const rows = logs.map((log) => [
			log.timestamp.toISOString(),
			log.user?.email || "N/A",
			log.action,
			log.resource,
			log.resourceId || "",
			log.ipAddress,
			log.userAgent,
		]);

		const csv = [
			headers.join(","),
			...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
		].join("\n");

		return csv;
	}
}

export const auditService = new AuditService();
