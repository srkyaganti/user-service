import { dbManager } from "@user-service/database";
import { Hono } from "hono";
import { CacheService } from "../services/cache.service";

const app = new Hono();
const cache = CacheService.getInstance();

// Basic health check
app.get("/", async (c) => {
	return c.json({
		status: "ok",
		service: "user-service",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

// Detailed health check
app.get("/live", async (c) => {
	const checks = {
		database: "unknown",
		redis: "unknown",
	};

	// Check database
	try {
		const db = await dbManager.getCentralDb();
		await db.$queryRaw`SELECT 1`;
		checks.database = "healthy";
	} catch (error) {
		checks.database = "unhealthy";
	}

	// Check Redis
	try {
		await cache.ping();
		checks.redis = "healthy";
	} catch (error) {
		checks.redis = "unhealthy";
	}

	const allHealthy = Object.values(checks).every(
		(status) => status === "healthy",
	);

	return c.json(
		{
			status: allHealthy ? "healthy" : "degraded",
			checks,
			timestamp: new Date().toISOString(),
		},
		allHealthy ? 200 : 503,
	);
});

// Readiness check
app.get("/ready", async (c) => {
	try {
		// Quick checks to ensure service is ready
		const db = await dbManager.getCentralDb();
		await db.$queryRaw`SELECT 1`;
		await cache.ping();

		return c.json({
			status: "ready",
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		return c.json(
			{
				status: "not_ready",
				timestamp: new Date().toISOString(),
			},
			503,
		);
	}
});

export { app as healthRoutes };
