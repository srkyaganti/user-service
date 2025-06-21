import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getClientIp, getUserAgent } from "@user-service/shared";
import { authMiddleware } from "../middleware/auth";
import { deviceService } from "../services/device.service";

const app = new OpenAPIHono();

// List user's devices
const listDevicesRoute = createRoute({
	method: "get",
	path: "/",
	tags: ["devices"],
	middleware: authMiddleware,
	responses: {
		200: {
			description: "List of devices",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								type: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]),
								fingerprint: z.string(),
								trustLevel: z.enum(["TRUSTED", "VERIFIED", "UNKNOWN"]),
								platform: z.string().nullable(),
								browser: z.string().nullable(),
								os: z.string().nullable(),
								lastIp: z.string().nullable(),
								lastLocation: z.any().nullable(),
								isCurrentDevice: z.boolean(),
								activeSessions: z.number(),
								createdAt: z.string(),
								lastUsedAt: z.string(),
							}),
						),
					}),
				},
			},
		},
	},
});

app.openapi(listDevicesRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");

	const devices = await deviceService.listDevices(user.id, tenantId);

	return c.json({
		success: true,
		data: devices,
	});
});

// Get device details
const getDeviceRoute = createRoute({
	method: "get",
	path: "/:deviceId",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			deviceId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Device details",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							name: z.string(),
							type: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]),
							fingerprint: z.string(),
							trustLevel: z.enum(["TRUSTED", "VERIFIED", "UNKNOWN"]),
							platform: z.string().nullable(),
							browser: z.string().nullable(),
							os: z.string().nullable(),
							lastIp: z.string().nullable(),
							lastLocation: z.any().nullable(),
							createdAt: z.string(),
							lastUsedAt: z.string(),
							sessions: z.array(
								z.object({
									id: z.string(),
									ipAddress: z.string(),
									userAgent: z.string(),
									createdAt: z.string(),
									lastActivity: z.string(),
									expiresAt: z.string(),
								}),
							),
						}),
					}),
				},
			},
		},
		403: {
			description: "Cannot view other users devices",
		},
		404: {
			description: "Device not found",
		},
	},
});

app.openapi(getDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { deviceId } = c.req.valid("param");

	const device = await deviceService.getDevice(deviceId, user.id, tenantId);

	return c.json({
		success: true,
		data: device,
	});
});

// Register device
const registerDeviceRoute = createRoute({
	method: "post",
	path: "/",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(1).max(50),
						type: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Device registered",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							name: z.string(),
							type: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]),
							fingerprint: z.string(),
							trustLevel: z.enum(["TRUSTED", "VERIFIED", "UNKNOWN"]),
							createdAt: z.string(),
						}),
					}),
				},
			},
		},
	},
});

app.openapi(registerDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const body = c.req.valid("json");

	const userAgent = getUserAgent(c.req.raw);
	const deviceInfo = await deviceService.detectDeviceInfo(userAgent);

	const device = await deviceService.registerDevice(user.id, tenantId, {
		name: body.name,
		type: body.type || deviceInfo.type,
		platform: deviceInfo.platform,
		browser: deviceInfo.browser,
		os: deviceInfo.os,
		ipAddress: getClientIp(c.req.raw),
		userAgent,
	});

	return c.json(
		{
			success: true,
			data: device,
		},
		201,
	);
});

// Update device
const updateDeviceRoute = createRoute({
	method: "patch",
	path: "/:deviceId",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			deviceId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(1).max(50).optional(),
						trustLevel: z.enum(["TRUSTED", "VERIFIED", "UNKNOWN"]).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Device updated",
		},
		403: {
			description: "Cannot update other users devices",
		},
		404: {
			description: "Device not found",
		},
	},
});

app.openapi(updateDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { deviceId } = c.req.valid("param");
	const body = c.req.valid("json");

	const device = await deviceService.updateDevice(
		deviceId,
		user.id,
		tenantId,
		body,
	);

	return c.json({
		success: true,
		data: device,
	});
});

// Trust device
const trustDeviceRoute = createRoute({
	method: "post",
	path: "/:deviceId/trust",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			deviceId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Device trusted",
		},
		403: {
			description: "Cannot trust other users devices",
		},
		404: {
			description: "Device not found",
		},
	},
});

app.openapi(trustDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { deviceId } = c.req.valid("param");

	const device = await deviceService.trustDevice(deviceId, user.id, tenantId);

	return c.json({
		success: true,
		data: device,
	});
});

// Logout device
const logoutDeviceRoute = createRoute({
	method: "post",
	path: "/:deviceId/logout",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			deviceId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Device logged out",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							success: z.literal(true),
							sessionsInvalidated: z.number(),
						}),
					}),
				},
			},
		},
		403: {
			description: "Cannot logout other users devices",
		},
		404: {
			description: "Device not found",
		},
	},
});

app.openapi(logoutDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { deviceId } = c.req.valid("param");

	const result = await deviceService.logoutDevice(deviceId, user.id, tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// Remove device
const removeDeviceRoute = createRoute({
	method: "delete",
	path: "/:deviceId",
	tags: ["devices"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			deviceId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Device removed",
		},
		400: {
			description: "Cannot remove device with active sessions",
		},
		403: {
			description: "Cannot remove other users devices",
		},
		404: {
			description: "Device not found",
		},
	},
});

app.openapi(removeDeviceRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { deviceId } = c.req.valid("param");

	const result = await deviceService.removeDevice(deviceId, user.id, tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// Get device stats
const getDeviceStatsRoute = createRoute({
	method: "get",
	path: "/stats",
	tags: ["devices"],
	middleware: authMiddleware,
	responses: {
		200: {
			description: "Device statistics",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							totalDevices: z.number(),
							trustedDevices: z.number(),
							activeSessions: z.number(),
							deviceTypes: z.record(z.string(), z.number()),
						}),
					}),
				},
			},
		},
	},
});

app.openapi(getDeviceStatsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");

	const stats = await deviceService.getDeviceStats(user.id, tenantId);

	return c.json({
		success: true,
		data: stats,
	});
});

export { app as deviceRoutes };
