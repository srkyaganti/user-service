import { getEnvVar } from "@user-service/shared";
import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";

export const logger = pino({
	level: getEnvVar("LOG_LEVEL", "info"),
	transport: isDevelopment
		? {
				target: "pino-pretty",
				options: {
					colorize: true,
					ignore: "pid,hostname",
					translateTime: "HH:MM:ss Z",
				},
			}
		: undefined,
	base: {
		env: process.env.NODE_ENV,
		version: process.env.npm_package_version,
	},
	redact: {
		paths: ["password", "token", "authorization", "*.password", "*.token"],
		censor: "[REDACTED]",
	},
	serializers: {
		err: pino.stdSerializers.err,
		req: (req) => ({
			method: req.method,
			url: req.url,
			headers: {
				"user-agent": req.headers["user-agent"],
				"x-request-id": req.headers["x-request-id"],
			},
		}),
		res: (res) => ({
			statusCode: res.statusCode,
		}),
	},
});
