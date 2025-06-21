import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	ApiResponse,
	LoginSchema,
	RegisterSchema,
	getClientIp,
	getUserAgent,
} from "@user-service/shared";
import { authMiddleware } from "../middleware/auth";
import { authService } from "../services/auth.service";
import { magicLinkService } from "../services/magic-link.service";

const app = new OpenAPIHono();

// Login route
const loginRoute = createRoute({
	method: "post",
	path: "/login",
	tags: ["auth"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: LoginSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Successful login",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z
							.object({
								user: z.object({
									id: z.string(),
									email: z.string(),
									profile: z.any(),
									userType: z.string(),
								}),
								tokens: z.object({
									accessToken: z.string(),
									refreshToken: z.string(),
									expiresIn: z.number(),
								}),
								organizations: z.array(
									z.object({
										id: z.string(),
										name: z.string(),
										slug: z.string(),
									}),
								),
							})
							.optional(),
						requiresMFA: z.boolean().optional(),
						mfaToken: z.string().optional(),
						mfaMethods: z.array(z.string()).optional(),
					}),
				},
			},
		},
		401: {
			description: "Invalid credentials",
		},
	},
});

app.openapi(loginRoute, async (c) => {
	const tenantId = c.get("tenantId");
	const body = c.req.valid("json");

	const result = await authService.login(tenantId, {
		...body,
		ipAddress: getClientIp(c.req.raw),
		userAgent: getUserAgent(c.req.raw),
	});

	// Handle MFA required response
	if ("requiresMFA" in result && result.requiresMFA) {
		return c.json({
			success: true,
			requiresMFA: true,
			mfaToken: result.mfaToken,
			mfaMethods: result.mfaMethods,
		});
	}

	// Set refresh token as httpOnly cookie
	c.cookie("refreshToken", result.tokens.refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 30 * 24 * 60 * 60, // 30 days
		path: "/api/v1/auth",
	});

	return c.json({
		success: true,
		data: result,
	});
});

// Register route
const registerRoute = createRoute({
	method: "post",
	path: "/register",
	tags: ["auth"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: RegisterSchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "User registered successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							user: z.object({
								id: z.string(),
								email: z.string(),
								profile: z.any(),
								userType: z.string(),
							}),
							tokens: z.object({
								accessToken: z.string(),
								refreshToken: z.string(),
								expiresIn: z.number(),
							}),
							organizations: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
									slug: z.string(),
								}),
							),
						}),
					}),
				},
			},
		},
		400: {
			description: "Validation error",
		},
	},
});

app.openapi(registerRoute, async (c) => {
	const tenantId = c.get("tenantId");
	const body = c.req.valid("json");

	const result = await authService.register(tenantId, {
		...body,
		ipAddress: getClientIp(c.req.raw),
		userAgent: getUserAgent(c.req.raw),
	});

	// Set refresh token as httpOnly cookie
	c.cookie("refreshToken", result.tokens.refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 30 * 24 * 60 * 60, // 30 days
		path: "/api/v1/auth",
	});

	return c.json(
		{
			success: true,
			data: result,
		},
		201,
	);
});

// Logout route
const logoutRoute = createRoute({
	method: "post",
	path: "/logout",
	tags: ["auth"],
	middleware: authMiddleware,
	responses: {
		200: {
			description: "Logged out successfully",
		},
	},
});

app.openapi(logoutRoute, async (c) => {
	const user = c.get("user");
	const sessionId = c.get("sessionId");

	await authService.logout(user.id, sessionId);

	// Clear refresh token cookie
	c.cookie("refreshToken", "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 0,
		path: "/api/v1/auth",
	});

	return c.json({
		success: true,
		data: {
			message: "Logged out successfully",
		},
	});
});

// Refresh token route
const refreshRoute = createRoute({
	method: "post",
	path: "/refresh",
	tags: ["auth"],
	responses: {
		200: {
			description: "Token refreshed successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							accessToken: z.string(),
							refreshToken: z.string(),
							expiresIn: z.number(),
						}),
					}),
				},
			},
		},
		401: {
			description: "Invalid refresh token",
		},
	},
});

app.openapi(refreshRoute, async (c) => {
	const refreshToken = c.req.cookie("refreshToken");

	if (!refreshToken) {
		return c.json(
			{
				success: false,
				error: {
					code: "MISSING_REFRESH_TOKEN",
					message: "Refresh token not provided",
				},
			},
			401,
		);
	}

	const result = await authService.refreshToken(refreshToken);

	// Update refresh token cookie
	c.cookie("refreshToken", result.refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 30 * 24 * 60 * 60, // 30 days
		path: "/api/v1/auth",
	});

	return c.json({
		success: true,
		data: result,
	});
});

// Get current user route
const meRoute = createRoute({
	method: "get",
	path: "/me",
	tags: ["auth"],
	middleware: authMiddleware,
	responses: {
		200: {
			description: "Current user info",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							email: z.string(),
							tenantId: z.string(),
							organizationId: z.string().optional(),
						}),
					}),
				},
			},
		},
	},
});

app.openapi(meRoute, async (c) => {
	const user = c.get("user");

	return c.json({
		success: true,
		data: user,
	});
});

// Magic link request route
const magicLinkRoute = createRoute({
	method: "post",
	path: "/magic-link",
	tags: ["auth"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						email: z.string().email(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Magic link sent",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							message: z.string(),
						}),
					}),
				},
			},
		},
		400: {
			description: "Validation error",
		},
	},
});

app.openapi(magicLinkRoute, async (c) => {
	const tenantId = c.get("tenantId");
	const { email } = c.req.valid("json");

	const result = await magicLinkService.sendMagicLink(email, tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// Magic link verification route
const verifyMagicLinkRoute = createRoute({
	method: "post",
	path: "/magic-link/verify",
	tags: ["auth"],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						token: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Magic link verified",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							user: z.object({
								id: z.string(),
								email: z.string(),
								profile: z.any(),
								userType: z.string(),
							}),
							tokens: z.object({
								accessToken: z.string(),
								refreshToken: z.string(),
								expiresIn: z.number(),
							}),
							organizations: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
									slug: z.string(),
								}),
							),
						}),
					}),
				},
			},
		},
		400: {
			description: "Invalid or expired token",
		},
	},
});

app.openapi(verifyMagicLinkRoute, async (c) => {
	const tenantId = c.get("tenantId");
	const { token } = c.req.valid("json");

	const result = await magicLinkService.verifyMagicLink(
		token,
		getClientIp(c.req.raw),
		getUserAgent(c.req.raw),
		tenantId,
	);

	// Set refresh token as httpOnly cookie
	c.cookie("refreshToken", result.tokens.refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 30 * 24 * 60 * 60, // 30 days
		path: "/api/v1/auth",
	});

	return c.json({
		success: true,
		data: result,
	});
});

export { app as authRoutes };
