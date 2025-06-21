import { PrismaClient } from "../generated/client";

/**
 * Global PrismaClient instance with environment-based logging
 * Uses singleton pattern to prevent multiple connections in development
 */
const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		log:
			process.env.NODE_ENV === "development"
				? ["query", "error", "warn"]
				: ["error"],
	});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Multi-tenant database manager that handles:
 * - Tenant-specific database connections
 * - Connection pooling and caching
 * - Tenant validation and status checks
 * - Central database management
 */
export class TenantDatabaseManager {
	private connections = new Map<string, PrismaClient>();
	private centralDb = prisma; // Central database for tenant management

	/**
	 * Gets the central database client for tenant management
	 * @returns PrismaClient instance for central database
	 */
	async getCentralDb(): Promise<PrismaClient> {
		return this.centralDb;
	}

	/**
	 * Gets or creates a database client for a specific tenant
	 * @param tenantId - The tenant identifier
	 * @returns PrismaClient instance for the tenant's database
	 * @throws Error if tenant not found or inactive
	 */
	async getClient(tenantId: string): Promise<PrismaClient> {
		if (!this.connections.has(tenantId)) {
			// Get tenant configuration from central database
			const tenant = await this.centralDb.tenant.findUnique({
				where: { id: tenantId },
			});

			if (!tenant) {
				throw new Error(`Tenant ${tenantId} not found`);
			}

			if (tenant.status !== "ACTIVE") {
				throw new Error(`Tenant ${tenantId} is not active`);
			}

			// In production, each tenant has separate database
			const databaseUrl =
				process.env.NODE_ENV === "production" && tenant.dbHost
					? `postgresql://${tenant.dbUser}:${tenant.dbPassword}@${tenant.dbHost}/${tenant.dbName}`
					: process.env.DATABASE_URL;

			const client = new PrismaClient({
				datasources: {
					db: { url: databaseUrl },
				},
				log:
					process.env.NODE_ENV === "development"
						? ["query", "error", "warn"]
						: ["error"],
			});

			this.connections.set(tenantId, client);
		}

		return this.connections.get(tenantId)!;
	}

	async disconnect(tenantId: string): Promise<void> {
		const client = this.connections.get(tenantId);
		if (client) {
			await client.$disconnect();
			this.connections.delete(tenantId);
		}
	}

	async disconnectAll(): Promise<void> {
		await Promise.all(
			Array.from(this.connections.values()).map((client) =>
				client.$disconnect(),
			),
		);
		this.connections.clear();
		await this.centralDb.$disconnect();
	}

	// Tenant management methods
	async createTenant(data: {
		name: string;
		slug: string;
		config?: any;
	}) {
		const tenant = await this.centralDb.tenant.create({
			data: {
				name: data.name,
				slug: data.slug,
				config: data.config || {},
				status: "ACTIVE",
				dbName: `tenant_${data.slug.replace(/-/g, "_")}`,
				keycloakRealm: `tenant-${data.slug}`,
			},
		});

		// In production, create actual database for tenant
		if (process.env.NODE_ENV === "production") {
			// This would be handled by a separate service or script
			// that has permissions to create databases
		}

		return tenant;
	}

	async getTenant(identifier: { id?: string; slug?: string }) {
		const where = identifier.id
			? { id: identifier.id }
			: { slug: identifier.slug };

		return this.centralDb.tenant.findUnique({ where });
	}

	async updateTenantStatus(
		tenantId: string,
		status: "ACTIVE" | "SUSPENDED" | "TRIAL" | "ARCHIVED",
	) {
		const tenant = await this.centralDb.tenant.update({
			where: { id: tenantId },
			data: { status },
		});

		// If suspending, disconnect existing connections
		if (status === "SUSPENDED" || status === "ARCHIVED") {
			await this.disconnect(tenantId);
		}

		return tenant;
	}
}

// Export a singleton instance
export const dbManager = new TenantDatabaseManager();

// Export types
export * from "../generated/client";
