import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";

// String utilities
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.trim();
}

// ID generation
export function generateId(prefix?: string): string {
	const id = nanoid();
	return prefix ? `${prefix}_${id}` : id;
}

export function generateToken(length = 32): string {
	return randomBytes(length).toString("hex");
}

// Hashing
export function hashString(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

// Time utilities
export function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

export function addSeconds(date: Date, seconds: number): Date {
	return new Date(date.getTime() + seconds * 1000);
}

export function isExpired(date: Date): boolean {
	return date < new Date();
}

// Object utilities
export function pick<T extends object, K extends keyof T>(
	obj: T,
	keys: K[],
): Pick<T, K> {
	const result = {} as Pick<T, K>;
	keys.forEach((key) => {
		if (key in obj) {
			result[key] = obj[key];
		}
	});
	return result;
}

export function omit<T extends object, K extends keyof T>(
	obj: T,
	keys: K[],
): Omit<T, K> {
	const result = { ...obj };
	keys.forEach((key) => {
		delete result[key];
	});
	return result as Omit<T, K>;
}

// Validation utilities
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

export function isStrongPassword(password: string): boolean {
	// At least 8 characters, one uppercase, one lowercase, one number, one special character
	const strongPasswordRegex =
		/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
	return strongPasswordRegex.test(password);
}

// Array utilities
export function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

export function unique<T>(array: T[]): T[] {
	return Array.from(new Set(array));
}

// Error handling
export function tryParseJSON<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

// Environment utilities
export function getEnvVar(key: string, defaultValue?: string): string {
	const value = process.env[key];
	if (value === undefined && defaultValue === undefined) {
		throw new Error(`Environment variable ${key} is not defined`);
	}
	return value || defaultValue!;
}

export function getEnvVarAsInt(key: string, defaultValue?: number): number {
	const value = getEnvVar(key, defaultValue?.toString());
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		throw new Error(`Environment variable ${key} is not a valid integer`);
	}
	return parsed;
}

export function getEnvVarAsBool(key: string, defaultValue?: boolean): boolean {
	const value = getEnvVar(key, defaultValue?.toString());
	return value === "true" || value === "1";
}

// Request utilities
export function getClientIp(request: Request): string {
	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		return forwardedFor.split(",")[0].trim();
	}

	const realIp = request.headers.get("x-real-ip");
	if (realIp) {
		return realIp;
	}

	// For local development
	return "127.0.0.1";
}

export function getUserAgent(request: Request): string {
	return request.headers.get("user-agent") || "Unknown";
}

// Retry utility
export async function retry<T>(
	fn: () => Promise<T>,
	options: {
		attempts?: number;
		delay?: number;
		backoff?: number;
	} = {},
): Promise<T> {
	const { attempts = 3, delay = 1000, backoff = 2 } = options;

	let lastError: Error;

	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			if (i < attempts - 1) {
				const waitTime = delay * backoff ** i;
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}
		}
	}

	throw lastError!;
}
