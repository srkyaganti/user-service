import { dbManager } from "@user-service/database";
import {
	HEADERS,
	NotFoundError,
	type TenantConfig,
} from "@user-service/shared";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../lib/logger";
import { CacheService } from "../services/cache.service";

const cache = CacheService.getInstance();

export async function tenantMiddleware(c: Context, next: Next) {
	// Extract tenant identifier
	const tenantId = extractTenantId(c);

	if (!tenantId) {
		throw new HTTPException(400, { message: "Tenant identification required" });
	}

	try {
		// Try to get tenant from cache
		const cacheKey = `tenant:${tenantId}`;
		let tenant = await cache.get<TenantConfig>(cacheKey);

		if (!tenant) {
			// Get from database
			const centralDb = await dbManager.getCentralDb();
			const tenantRecord = await centralDb.tenant.findFirst({
				where: {
					OR: [{ id: tenantId }, { slug: tenantId }],
					status: "ACTIVE",
				},
			});

			if (!tenantRecord) {
				throw new NotFoundError("Tenant");
			}

			// Transform to TenantConfig
			tenant = {
				id: tenantRecord.id,
				slug: tenantRecord.slug,
				name: tenantRecord.name,
				...(tenantRecord.config as any),
			};

			// Cache for 5 minutes
			await cache.set(cacheKey, tenant, 300);
		}

		// Set tenant in context
		c.set("tenant", tenant);
		c.set("tenantId", tenant.id);

		// Log tenant access
		logger.debug(
			{
				tenantId: tenant.id,
				requestId: c.get("requestId"),
				path: c.req.path,
			},
			"Tenant middleware",
		);

		await next();
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new HTTPException(404, { message: "Tenant not found" });
		}
		throw error;
	}
}

function extractTenantId(c: Context): string | null {
	// 1. Check header
	const headerTenant = c.req.header(HEADERS.TENANT_ID);
	if (headerTenant) {
		return headerTenant;
	}

	// 2. Check subdomain
	const host = c.req.header("host");
	if (host) {
		const subdomain = host.split(".")[0];
		if (subdomain && subdomain !== "www" && subdomain !== "api") {
			return subdomain;
		}
	}

	// 3. Check query parameter (for development)
	if (process.env.NODE_ENV === "development") {
		const url = new URL(c.req.url);
		const queryTenant = url.searchParams.get("tenant");
		if (queryTenant) {
			return queryTenant;
		}
	}

	// 4. Default tenant in development
	if (process.env.NODE_ENV === "development") {
		return "dev";
	}

	return null;
}
