import { dbManager } from "@user-service/database";
import {
	type AuthUser,
	AuthenticationError,
	AuthorizationError,
	CACHE_KEYS,
} from "@user-service/shared";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyToken } from "../lib/jwt";
import { CacheService } from "../services/cache.service";

const cache = CacheService.getInstance();

export async function authMiddleware(c: Context, next: Next) {
	// Get authorization header
	const authorization = c.req.header("Authorization");

	if (!authorization || !authorization.startsWith("Bearer ")) {
		throw new AuthenticationError("Missing or invalid authorization header");
	}

	const token = authorization.substring(7);

	try {
		// Verify JWT token
		const payload = await verifyToken(token);

		// Check if session exists in cache
		const sessionKey = CACHE_KEYS.SESSION(token);
		const session = await cache.get(sessionKey);

		if (!session) {
			// Check database if not in cache
			const db = await dbManager.getClient(payload.tenantId);
			const dbSession = await db.session.findUnique({
				where: { token },
				include: {
					user: {
						include: {
							memberships: {
								include: {
									organization: true,
								},
							},
						},
					},
				},
			});

			if (!dbSession || dbSession.expiresAt < new Date()) {
				throw new AuthenticationError("Session expired or invalid");
			}

			// Update last activity
			await db.session.update({
				where: { id: dbSession.id },
				data: { lastActivity: new Date() },
			});

			// Cache session
			await cache.set(
				sessionKey,
				{
					userId: dbSession.userId,
					tenantId: payload.tenantId,
					sessionId: dbSession.id,
				},
				300,
			); // 5 minutes
		}

		// Set user in context
		const authUser: AuthUser = {
			id: payload.sub,
			email: payload.email,
			tenantId: payload.tenantId,
			organizationId: payload.organizationId,
		};

		c.set("user", authUser);
		c.set("userId", payload.sub);
		c.set("tenantId", payload.tenantId);
		c.set("sessionId", payload.sessionId);

		await next();
	} catch (error) {
		if (error instanceof AuthenticationError) {
			throw error;
		}

		throw new AuthenticationError("Invalid token");
	}
}

// Middleware to check specific permissions
export function requirePermission(permission: string) {
	return async (c: Context, next: Next) => {
		const user = c.get("user") as AuthUser;

		if (!user) {
			throw new AuthenticationError();
		}

		// Check if user has permission
		const hasPermission = await checkUserPermission(user, permission);

		if (!hasPermission) {
			throw new AuthorizationError(
				`Missing required permission: ${permission}`,
			);
		}

		await next();
	};
}

// Middleware to require organization context
export async function requireOrganization(c: Context, next: Next) {
	const user = c.get("user") as AuthUser;

	if (!user?.organizationId) {
		throw new AuthorizationError("Organization context required");
	}

	await next();
}

// Helper to check permissions
async function checkUserPermission(
	user: AuthUser,
	permission: string,
): Promise<boolean> {
	if (!user.organizationId) {
		return false;
	}

	// Get user's permissions from cache or database
	const cacheKey = CACHE_KEYS.PERMISSIONS(user.id, user.organizationId);
	let permissions = await cache.get<string[]>(cacheKey);

	if (!permissions) {
		const db = await dbManager.getClient(user.tenantId);
		const membership = await db.organizationMember.findUnique({
			where: {
				userId_orgId: {
					userId: user.id,
					orgId: user.organizationId,
				},
			},
		});

		if (!membership) {
			return false;
		}

		// Get role permissions
		const { ROLE_PERMISSIONS } = await import("@user-service/shared");
		permissions = ROLE_PERMISSIONS[membership.role] || [];

		// Add custom permissions
		permissions = [...permissions, ...membership.permissions];

		// Cache for 5 minutes
		await cache.set(cacheKey, permissions, 300);
	}

	// Check if user has the required permission
	return permissions.includes(permission) || permissions.includes("admin:*");
}
