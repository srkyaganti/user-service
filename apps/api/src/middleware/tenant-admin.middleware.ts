import type { Context, Next } from "hono";
import { TenantAdminService } from "../services/tenant-admin.service";

const tenantAdminService = new TenantAdminService();

/**
 * Middleware to require tenant admin privileges
 */
export const requireTenantAdmin = async (c: Context, next: Next) => {
	const userId = c.get("userId");
	const tenantId = c.get("tenantId");

	if (!userId || !tenantId) {
		return c.json(
			{
				success: false,
				error: "Unauthorized",
			},
			401,
		);
	}

	try {
		const isAdmin = await tenantAdminService.isTenantAdmin(tenantId, userId);

		if (!isAdmin) {
			return c.json(
				{
					success: false,
					error: "Admin privileges required",
				},
				403,
			);
		}

		await next();
	} catch (error) {
		return c.json(
			{
				success: false,
				error: "Failed to verify admin privileges",
			},
			500,
		);
	}
};
