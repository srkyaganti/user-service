import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authMiddleware } from "../middleware/auth";
import { auditService } from "../services/audit.service";

const app = new OpenAPIHono();

// List audit logs
const listAuditLogsRoute = createRoute({
	method: "get",
	path: "/",
	tags: ["audit"],
	middleware: authMiddleware,
	request: {
		query: z.object({
			userId: z.string().optional(),
			action: z.string().optional(),
			resource: z.string().optional(),
			resourceId: z.string().optional(),
			startDate: z.coerce.date().optional(),
			endDate: z.coerce.date().optional(),
			limit: z.coerce.number().min(1).max(100).optional(),
			offset: z.coerce.number().min(0).optional(),
		}),
	},
	responses: {
		200: {
			description: "List of audit logs",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							logs: z.array(
								z.object({
									id: z.string(),
									user: z
										.object({
											id: z.string(),
											email: z.string(),
											name: z.string().optional(),
										})
										.nullable(),
									action: z.string(),
									resource: z.string(),
									resourceId: z.string().nullable(),
									metadata: z.any().nullable(),
									ipAddress: z.string(),
									userAgent: z.string(),
									timestamp: z.string(),
									actionDetails: z.object({
										category: z.string(),
										description: z.string(),
										severity: z.enum(["info", "warning", "critical"]),
									}),
								}),
							),
							pagination: z.object({
								total: z.number(),
								limit: z.number(),
								offset: z.number(),
								hasMore: z.boolean(),
							}),
						}),
					}),
				},
			},
		},
		403: {
			description: "Cannot view other users audit logs",
		},
	},
});

app.openapi(listAuditLogsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const query = c.req.valid("query");

	// Non-admin users can only view their own logs
	const filters = {
		...query,
		userId: query.userId || user.id,
	};

	const result = await auditService.listLogs(
		tenantId,
		filters,
		user.id,
		false, // isAdmin - would be determined by user role
	);

	return c.json({
		success: true,
		data: result,
	});
});

// Get audit log statistics
const getAuditStatsRoute = createRoute({
	method: "get",
	path: "/stats",
	tags: ["audit"],
	middleware: authMiddleware,
	request: {
		query: z.object({
			userId: z.string().optional(),
			days: z.coerce.number().min(1).max(365).optional(),
		}),
	},
	responses: {
		200: {
			description: "Audit log statistics",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							period: z.object({
								start: z.string(),
								end: z.string(),
								days: z.number(),
							}),
							totalLogs: z.number(),
							topActions: z.array(
								z.object({
									action: z.string(),
									count: z.number(),
									details: z.object({
										category: z.string(),
										description: z.string(),
										severity: z.enum(["info", "warning", "critical"]),
									}),
								}),
							),
							resourceBreakdown: z.array(
								z.object({
									resource: z.string(),
									count: z.number(),
								}),
							),
							dailyActivity: z.array(
								z.object({
									date: z.string(),
									count: z.number(),
								}),
							),
							topUsers: z
								.array(
									z.object({
										user: z
											.object({
												id: z.string(),
												email: z.string(),
												name: z.string().optional(),
											})
											.nullable(),
										count: z.number(),
									}),
								)
								.optional(),
						}),
					}),
				},
			},
		},
	},
});

app.openapi(getAuditStatsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const query = c.req.valid("query");

	// Non-admin users can only view their own stats
	const userId = query.userId || user.id;

	const stats = await auditService.getLogStats(tenantId, userId, query.days);

	return c.json({
		success: true,
		data: stats,
	});
});

// Export audit logs
const exportAuditLogsRoute = createRoute({
	method: "get",
	path: "/export",
	tags: ["audit"],
	middleware: authMiddleware,
	request: {
		query: z.object({
			userId: z.string().optional(),
			action: z.string().optional(),
			resource: z.string().optional(),
			resourceId: z.string().optional(),
			startDate: z.coerce.date().optional(),
			endDate: z.coerce.date().optional(),
			format: z.enum(["json", "csv"]).optional(),
			limit: z.coerce.number().min(1).max(10000).optional(),
		}),
	},
	responses: {
		200: {
			description: "Exported audit logs",
			content: {
				"application/json": {
					schema: z.any(),
				},
				"text/csv": {
					schema: z.string(),
				},
			},
		},
	},
});

app.openapi(exportAuditLogsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const query = c.req.valid("query");

	// Non-admin users can only export their own logs
	const filters = {
		...query,
		userId: query.userId || user.id,
	};

	const data = await auditService.exportLogs(tenantId, filters, query.format);

	if (query.format === "csv") {
		c.header("Content-Type", "text/csv");
		c.header("Content-Disposition", 'attachment; filename="audit-logs.csv"');
		return c.text(data as string);
	}

	return c.json(data);
});

// Organization audit logs (for admins)
const listOrgAuditLogsRoute = createRoute({
	method: "get",
	path: "/organizations/:orgId",
	tags: ["audit"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			action: z.string().optional(),
			resource: z.string().optional(),
			startDate: z.coerce.date().optional(),
			endDate: z.coerce.date().optional(),
			limit: z.coerce.number().min(1).max(100).optional(),
			offset: z.coerce.number().min(0).optional(),
		}),
	},
	responses: {
		200: {
			description: "Organization audit logs",
		},
		403: {
			description: "Insufficient permissions",
		},
	},
});

app.openapi(listOrgAuditLogsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");

	// TODO: Check if user is org admin
	// For now, we'll filter logs by organization resource

	const filters = {
		...query,
		resource: "organization",
		resourceId: orgId,
	};

	const result = await auditService.listLogs(
		tenantId,
		filters,
		user.id,
		true, // isAdmin
	);

	return c.json({
		success: true,
		data: result,
	});
});

export { app as auditRoutes };
