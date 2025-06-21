import { dbManager } from "@user-service/database";
import { getEnvVar } from "@user-service/shared";
import { CacheService } from "../services/cache.service";
import { KeycloakService } from "../services/keycloak.service";

export async function initializeServices() {
	console.log("🔧 Initializing services...");

	try {
		// Test database connection
		const centralDb = await dbManager.getCentralDb();
		await centralDb.$queryRaw`SELECT 1`;
		console.log("✅ Database connected");

		// Test Redis connection
		const cache = CacheService.getInstance();
		await cache.ping();
		console.log("✅ Redis connected");

		// Initialize Keycloak admin client
		const keycloak = KeycloakService.getInstance();
		await keycloak.initialize();
		console.log("✅ Keycloak connected");

		// Create default tenant in development
		if (process.env.NODE_ENV === "development") {
			const devTenant = await centralDb.tenant.findUnique({
				where: { slug: "dev" },
			});

			if (!devTenant) {
				console.log("📝 Creating development tenant...");
				await dbManager.createTenant({
					name: "Development Tenant",
					slug: "dev",
					config: {
						features: {
							mfa: true,
							teams: true,
							sso: false,
						},
						auth: {
							allowedMethods: ["email", "google", "magic-link"],
							mfaRequired: false,
							sessionTimeout: 3600,
						},
						limits: {
							maxUsers: 1000,
							maxOrganizations: 10,
						},
					},
				});
				console.log("✅ Development tenant created");
			}
		}

		console.log("✅ All services initialized successfully");
	} catch (error) {
		console.error("❌ Service initialization failed:", error);
		throw error;
	}
}
