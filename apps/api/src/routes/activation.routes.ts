import { Hono } from "hono";
import { z } from "zod";
import { UserActivationService } from "../services/user-activation.service";

const activationRoutes = new Hono();
const activationService = new UserActivationService();

// Activate account
activationRoutes.post("/activate", async (c) => {
	try {
		const body = await c.req.json();
		const { token } = z
			.object({
				token: z.string().min(1),
			})
			.parse(body);

		const result = await activationService.activateAccount(token);

		if (!result.success) {
			return c.json(
				{
					success: false,
					error: result.message,
				},
				400,
			);
		}

		return c.json({
			success: true,
			message: result.message,
			userId: result.userId,
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json(
				{
					success: false,
					error: "Invalid request",
					details: error.errors,
				},
				400,
			);
		}

		return c.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to activate account",
			},
			500,
		);
	}
});

// Resend activation email
activationRoutes.post("/resend", async (c) => {
	try {
		const tenantId = c.req.header("X-Tenant-ID");
		if (!tenantId) {
			return c.json(
				{
					success: false,
					error: "Tenant ID required",
				},
				400,
			);
		}

		const body = await c.req.json();
		const { email } = z
			.object({
				email: z.string().email(),
			})
			.parse(body);

		const result = await activationService.resendActivation(tenantId, email);

		if (!result.success) {
			return c.json(
				{
					success: false,
					error: result.message,
				},
				400,
			);
		}

		return c.json({
			success: true,
			message: result.message,
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json(
				{
					success: false,
					error: "Invalid request",
					details: error.errors,
				},
				400,
			);
		}

		return c.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to resend activation",
			},
			500,
		);
	}
});

export { activationRoutes };
