import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { adminMiddleware } from "../middleware/admin";
import { authMiddleware } from "../middleware/auth";
import { adminService } from "../services/admin.service";

const app = new OpenAPIHono();

// Apply admin middleware to all routes
app.use("*", authMiddleware);
app.use("*", adminMiddleware);

// Create tenant
const createTenantRoute = createRoute({
	method: "post",
	path: "/tenants",
	tags: ["admin"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(100),
						slug: z.string().min(2).max(50).optional(),
						type: z
							.enum(["B2B", "B2C", "HYBRID"])
							.optional()
							.describe("Tenant business model type"),
						config: z
							.object({
								auth: z
									.object({
										allowedMethods: z.array(z.string()).optional(),
										requireInvitation: z.boolean().optional(),
										requireEmailVerification: z.boolean().optional(),
									})
									.optional(),
								features: z
									.object({
										organizations: z.boolean().optional(),
										teams: z.boolean().optional(),
										mfa: z.boolean().optional(),
										deviceTracking: z.boolean().optional(),
										auditLogs: z.boolean().optional(),
									})
									.optional(),
								limits: z
									.object({
										maxUsers: z.number().optional(),
										maxOrganizations: z.number().optional(),
										maxTeamsPerOrg: z.number().optional(),
									})
									.optional(),
							})
							.optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Tenant created",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							name: z.string(),
							slug: z.string(),
							type: z.enum(["B2B", "B2C", "HYBRID"]),
							status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "ARCHIVED"]),
							config: z.any(),
							createdAt: z.string(),
						}),
					}),
				},
			},
		},
		409: {
			description: "Tenant slug already exists",
		},
	},
});

app.openapi(createTenantRoute, async (c) => {
	const body = c.req.valid("json");

	const tenant = await adminService.createTenant(body);

	return c.json(
		{
			success: true,
			data: tenant,
		},
		201,
	);
});

// List tenants
const listTenantsRoute = createRoute({
	method: "get",
	path: "/tenants",
	tags: ["admin"],
	request: {
		query: z.object({
			status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "ARCHIVED"]).optional(),
			search: z.string().optional(),
			limit: z.coerce.number().min(1).max(100).optional(),
			offset: z.coerce.number().min(0).optional(),
		}),
	},
	responses: {
		200: {
			description: "List of tenants",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								slug: z.string(),
								status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "ARCHIVED"]),
								config: z.any(),
								createdAt: z.string(),
								updatedAt: z.string(),
								stats: z
									.object({
										userCount: z.number(),
										organizationCount: z.number(),
										sessionCount: z.number(),
										storageUsed: z.number(),
										lastActivity: z.string().optional(),
									})
									.nullable(),
							}),
						),
					}),
				},
			},
		},
	},
});

app.openapi(listTenantsRoute, async (c) => {
	const query = c.req.valid("query");

	const tenants = await adminService.listTenants(query);

	return c.json({
		success: true,
		data: tenants,
	});
});

// Get tenant details
const getTenantRoute = createRoute({
	method: "get",
	path: "/tenants/:tenantId",
	tags: ["admin"],
	request: {
		params: z.object({
			tenantId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Tenant details",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							name: z.string(),
							slug: z.string(),
							status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "ARCHIVED"]),
							config: z.any(),
							createdAt: z.string(),
							updatedAt: z.string(),
							stats: z.object({
								userCount: z.number(),
								organizationCount: z.number(),
								sessionCount: z.number(),
								storageUsed: z.number(),
								lastActivity: z.string().optional(),
							}),
						}),
					}),
				},
			},
		},
		404: {
			description: "Tenant not found",
		},
	},
});

app.openapi(getTenantRoute, async (c) => {
	const { tenantId } = c.req.valid("param");

	const tenant = await adminService.getTenant(tenantId);

	return c.json({
		success: true,
		data: tenant,
	});
});

// Update tenant
const updateTenantRoute = createRoute({
	method: "patch",
	path: "/tenants/:tenantId",
	tags: ["admin"],
	request: {
		params: z.object({
			tenantId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(100).optional(),
						status: z
							.enum(["ACTIVE", "SUSPENDED", "TRIAL", "ARCHIVED"])
							.optional(),
						config: z.record(z.any()).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Tenant updated",
		},
		404: {
			description: "Tenant not found",
		},
	},
});

app.openapi(updateTenantRoute, async (c) => {
	const { tenantId } = c.req.valid("param");
	const body = c.req.valid("json");

	const tenant = await adminService.updateTenant(tenantId, body);

	return c.json({
		success: true,
		data: tenant,
	});
});

// Suspend tenant
const suspendTenantRoute = createRoute({
	method: "post",
	path: "/tenants/:tenantId/suspend",
	tags: ["admin"],
	request: {
		params: z.object({
			tenantId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reason: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Tenant suspended",
		},
		400: {
			description: "Tenant already suspended",
		},
		404: {
			description: "Tenant not found",
		},
	},
});

app.openapi(suspendTenantRoute, async (c) => {
	const { tenantId } = c.req.valid("param");
	const { reason } = c.req.valid("json");

	const result = await adminService.suspendTenant(tenantId, reason);

	return c.json({
		success: true,
		data: result,
	});
});

// Reactivate tenant
const reactivateTenantRoute = createRoute({
	method: "post",
	path: "/tenants/:tenantId/reactivate",
	tags: ["admin"],
	request: {
		params: z.object({
			tenantId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Tenant reactivated",
		},
		400: {
			description: "Tenant not suspended",
		},
		404: {
			description: "Tenant not found",
		},
	},
});

app.openapi(reactivateTenantRoute, async (c) => {
	const { tenantId } = c.req.valid("param");

	const result = await adminService.reactivateTenant(tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// Delete tenant
const deleteTenantRoute = createRoute({
	method: "delete",
	path: "/tenants/:tenantId",
	tags: ["admin"],
	request: {
		params: z.object({
			tenantId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Tenant archived",
		},
		404: {
			description: "Tenant not found",
		},
	},
});

app.openapi(deleteTenantRoute, async (c) => {
	const { tenantId } = c.req.valid("param");

	const result = await adminService.deleteTenant(tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// Get system statistics
const getSystemStatsRoute = createRoute({
	method: "get",
	path: "/stats",
	tags: ["admin"],
	responses: {
		200: {
			description: "System statistics",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							tenants: z.object({
								total: z.number(),
								active: z.number(),
								suspended: z.number(),
							}),
							recentSignups: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
									slug: z.string(),
									createdAt: z.string(),
								}),
							),
						}),
					}),
				},
			},
		},
	},
});

app.openapi(getSystemStatsRoute, async (c) => {
	const stats = await adminService.getSystemStats();

	return c.json({
		success: true,
		data: stats,
	});
});

export { app as adminRoutes };
