import {
	RateLimitError,
	getClientIp,
	getEnvVarAsInt,
} from "@user-service/shared";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { RateLimiterRedis } from "rate-limiter-flexible";
import { CacheService } from "../services/cache.service";

const cache = CacheService.getInstance();

// Create rate limiter
const rateLimiter = new RateLimiterRedis({
	storeClient: cache.getClient(),
	keyPrefix: "rate:",
	points: getEnvVarAsInt("RATE_LIMIT_MAX_REQUESTS", 100),
	duration: getEnvVarAsInt("RATE_LIMIT_WINDOW_MS", 900000) / 1000, // Convert to seconds
	blockDuration: 0, // Don't block, just count
});

// Stricter limits for auth endpoints
const authRateLimiter = new RateLimiterRedis({
	storeClient: cache.getClient(),
	keyPrefix: "rate:auth:",
	points: 5, // 5 attempts
	duration: 900, // 15 minutes
	blockDuration: 900, // Block for 15 minutes
});

export async function rateLimitMiddleware(c: Context, next: Next) {
	const tenantId = c.get("tenantId");
	const ip = getClientIp(c.req.raw);
	const path = c.req.path;

	try {
		// Use stricter limits for auth endpoints
		if (path.includes("/auth/login") || path.includes("/auth/register")) {
			const key = `${tenantId}:${ip}:auth`;
			await authRateLimiter.consume(key);
		} else {
			// General rate limiting per tenant + IP
			const key = `${tenantId}:${ip}`;
			await rateLimiter.consume(key);
		}

		await next();
	} catch (error) {
		if (error instanceof Error && "msBeforeNext" in error) {
			const retryAfter = Math.round((error as any).msBeforeNext / 1000);

			c.header("Retry-After", retryAfter.toString());
			c.header("X-RateLimit-Limit", rateLimiter.points.toString());
			c.header(
				"X-RateLimit-Remaining",
				((error as any).remainingPoints || 0).toString(),
			);
			c.header(
				"X-RateLimit-Reset",
				new Date(Date.now() + (error as any).msBeforeNext).toISOString(),
			);

			throw new RateLimitError(retryAfter);
		}

		throw error;
	}
}
