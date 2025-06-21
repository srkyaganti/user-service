import { HEADERS } from "@user-service/shared";
import type { Context, Next } from "hono";
import { nanoid } from "nanoid";

export async function requestIdMiddleware(c: Context, next: Next) {
	// Get or generate request ID
	const requestId = c.req.header(HEADERS.REQUEST_ID) || nanoid();

	// Set in context
	c.set("requestId", requestId);

	// Add to response headers
	c.header(HEADERS.REQUEST_ID, requestId);

	await next();
}
