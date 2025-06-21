import { z } from "zod";

// Common types used across the application

// User types
export interface AuthUser {
	id: string;
	email: string;
	tenantId: string;
	organizationId?: string;
	permissions?: string[];
}

export interface JWTPayload {
	sub: string; // user ID
	email: string;
	tenantId: string;
	organizationId?: string;
	sessionId: string;
	iat: number;
	exp: number;
}

// Tenant types
export interface TenantConfig {
	id: string;
	slug: string;
	name: string;
	features: {
		mfa: boolean;
		teams: boolean;
		sso: boolean;
		streaming?: boolean;
	};
	auth: {
		allowedMethods: AuthMethod[];
		mfaRequired: boolean;
		sessionTimeout: number;
		passwordPolicy?: PasswordPolicy;
	};
	limits: {
		maxUsers: number;
		maxOrganizations: number;
		maxApiCalls?: number;
	};
	branding?: {
		logo?: string;
		primaryColor?: string;
		emailFromName?: string;
	};
}

export type AuthMethod =
	| "email"
	| "google"
	| "github"
	| "microsoft"
	| "saml"
	| "magic-link"
	| "passkey";

export interface PasswordPolicy {
	minLength: number;
	requireUppercase: boolean;
	requireLowercase: boolean;
	requireNumbers: boolean;
	requireSpecialChars: boolean;
}

// Request/Response DTOs
export const LoginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	deviceFingerprint: z.string().optional(),
	rememberMe: z.boolean().optional().default(false),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	profile: z
		.object({
			firstName: z.string().min(1).max(50),
			lastName: z.string().min(1).max(50),
			avatar: z.string().url().optional(),
		})
		.optional(),
	organizationId: z.string().optional(),
	invitationToken: z.string().optional(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const MFASetupSchema = z.object({
	type: z.enum(["totp", "sms", "email", "webauthn"]),
});
export type MFASetupDto = z.infer<typeof MFASetupSchema>;

export const MFAVerifySchema = z.object({
	code: z.string().length(6).optional(),
	credentialId: z.string().optional(),
	authenticatorData: z.any().optional(),
});
export type MFAVerifyDto = z.infer<typeof MFAVerifySchema>;

export const CreateOrganizationSchema = z.object({
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9-]+$/),
	description: z.string().max(500).optional(),
	logo: z.string().url().optional(),
});
export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;

export const InviteMemberSchema = z.object({
	email: z.string().email(),
	role: z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]),
	message: z.string().max(500).optional(),
});
export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;

// API Response types
export interface ApiResponse<T = any> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: any;
	};
	metadata?: {
		timestamp: string;
		requestId: string;
	};
}

export interface PaginatedResponse<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	hasMore: boolean;
}

// Error types
export class AppError extends Error {
	constructor(
		public code: string,
		message: string,
		public statusCode = 400,
		public details?: any,
	) {
		super(message);
		this.name = "AppError";
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: any) {
		super("VALIDATION_ERROR", message, 400, details);
	}
}

export class AuthenticationError extends AppError {
	constructor(message = "Authentication required") {
		super("AUTHENTICATION_ERROR", message, 401);
	}
}

export class AuthorizationError extends AppError {
	constructor(message = "Insufficient permissions") {
		super("AUTHORIZATION_ERROR", message, 403);
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string) {
		super("NOT_FOUND", `${resource} not found`, 404);
	}
}

export class RateLimitError extends AppError {
	constructor(retryAfter?: number) {
		super("RATE_LIMIT_EXCEEDED", "Too many requests", 429, { retryAfter });
	}
}
