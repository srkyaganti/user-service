import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getClientIp, getUserAgent } from "@user-service/shared";
import { authMiddleware } from "../middleware/auth";
import { socialAuthService } from "../services/social-auth.service";

const app = new OpenAPIHono();

// Get authorization URL
const getAuthUrlRoute = createRoute({
	method: "get",
	path: "/:provider/authorize",
	tags: ["social-auth"],
	request: {
		params: z.object({
			provider: z.enum(["google", "github", "microsoft"]),
		}),
		query: z.object({
			redirectUri: z.string().url(),
		}),
	},
	responses: {
		200: {
			description: "Authorization URL generated",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							url: z.string(),
							state: z.string(),
						}),
					}),
				},
			},
		},
		400: {
			description: "Provider not configured",
		},
	},
});

app.openapi(getAuthUrlRoute, async (c) => {
	const tenantId = c.get("tenantId");
	const { provider } = c.req.valid("param");
	const { redirectUri } = c.req.valid("query");

	const result = await socialAuthService.getAuthorizationUrl(
		provider,
		tenantId,
		redirectUri,
	);

	return c.json({
		success: true,
		data: result,
	});
});

// Handle OAuth callback
const callbackRoute = createRoute({
	method: "post",
	path: "/:provider/callback",
	tags: ["social-auth"],
	request: {
		params: z.object({
			provider: z.enum(["google", "github", "microsoft"]),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						code: z.string(),
						state: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Social login successful",
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
			description: "Invalid callback",
		},
	},
});

app.openapi(callbackRoute, async (c) => {
	const { provider } = c.req.valid("param");
	const { code, state } = c.req.valid("json");

	const result = await socialAuthService.handleCallback(
		provider,
		code,
		state,
		getClientIp(c.req.raw),
		getUserAgent(c.req.raw),
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

// Unlink social provider
const unlinkRoute = createRoute({
	method: "delete",
	path: "/:provider",
	tags: ["social-auth"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			provider: z.enum(["google", "github", "microsoft"]),
		}),
	},
	responses: {
		200: {
			description: "Provider unlinked",
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
			description: "Cannot unlink only auth method",
		},
	},
});

app.openapi(unlinkRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { provider } = c.req.valid("param");

	await socialAuthService.unlinkProvider(user.id, provider, tenantId);

	return c.json({
		success: true,
		data: {
			message: `${provider} account unlinked successfully`,
		},
	});
});

// Get linked providers
const getLinkedRoute = createRoute({
	method: "get",
	path: "/",
	tags: ["social-auth"],
	middleware: authMiddleware,
	responses: {
		200: {
			description: "Linked providers",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.array(
							z.object({
								provider: z.string(),
								email: z.string(),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
		},
	},
});

app.openapi(getLinkedRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");

	const providers = await socialAuthService.getLinkedProviders(
		user.id,
		tenantId,
	);

	return c.json({
		success: true,
		data: providers,
	});
});

export { app as socialAuthRoutes };
