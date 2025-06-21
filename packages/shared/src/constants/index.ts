// Application constants

export const APP_NAME = "User Service";
export const APP_VERSION = "1.0.0";

// Authentication
export const TOKEN_TYPES = {
	ACCESS: "access",
	REFRESH: "refresh",
	VERIFICATION: "verification",
	PASSWORD_RESET: "password_reset",
	INVITATION: "invitation",
} as const;

export const TOKEN_EXPIRY = {
	ACCESS: 15 * 60, // 15 minutes
	REFRESH: 30 * 24 * 60 * 60, // 30 days
	VERIFICATION: 24 * 60 * 60, // 24 hours
	PASSWORD_RESET: 60 * 60, // 1 hour
	INVITATION: 7 * 24 * 60 * 60, // 7 days
} as const;

// Cache keys
export const CACHE_KEYS = {
	SESSION: (token: string) => `session:${token}`,
	USER: (userId: string) => `user:${userId}`,
	TENANT: (tenantId: string) => `tenant:${tenantId}`,
	ORGANIZATION: (orgId: string) => `org:${orgId}`,
	PERMISSIONS: (userId: string, orgId: string) =>
		`permissions:${userId}:${orgId}`,
	MFA_SETUP: (userId: string) => `mfa:setup:${userId}`,
	RATE_LIMIT: (key: string) => `rate:${key}`,
} as const;

// Events
export const EVENTS = {
	// User events
	USER_CREATED: "user.created",
	USER_UPDATED: "user.updated",
	USER_DELETED: "user.deleted",
	USER_LOGGED_IN: "user.logged_in",
	USER_LOGGED_OUT: "user.logged_out",
	USER_PASSWORD_CHANGED: "user.password_changed",

	// Organization events
	ORG_CREATED: "org.created",
	ORG_UPDATED: "org.updated",
	ORG_DELETED: "org.deleted",

	// Member events
	MEMBER_INVITED: "member.invited",
	MEMBER_JOINED: "member.joined",
	MEMBER_REMOVED: "member.removed",
	MEMBER_ROLE_CHANGED: "member.role_changed",

	// MFA events
	MFA_ENABLED: "mfa.enabled",
	MFA_DISABLED: "mfa.disabled",
	MFA_VERIFIED: "mfa.verified",

	// Session events
	SESSION_CREATED: "session.created",
	SESSION_EXPIRED: "session.expired",
	SESSION_REVOKED: "session.revoked",
} as const;

// Permissions
export const PERMISSIONS = {
	// User permissions
	USER_READ: "user:read",
	USER_WRITE: "user:write",
	USER_DELETE: "user:delete",

	// Organization permissions
	ORG_READ: "org:read",
	ORG_WRITE: "org:write",
	ORG_DELETE: "org:delete",

	// Member permissions
	MEMBER_INVITE: "member:invite",
	MEMBER_REMOVE: "member:remove",
	MEMBER_MANAGE: "member:manage",

	// Team permissions
	TEAM_CREATE: "team:create",
	TEAM_READ: "team:read",
	TEAM_WRITE: "team:write",
	TEAM_DELETE: "team:delete",

	// Admin permissions
	ADMIN_ALL: "admin:*",
} as const;

// Role permissions mapping
export const ROLE_PERMISSIONS = {
	OWNER: Object.values(PERMISSIONS),
	ADMIN: [
		PERMISSIONS.USER_READ,
		PERMISSIONS.USER_WRITE,
		PERMISSIONS.ORG_READ,
		PERMISSIONS.ORG_WRITE,
		PERMISSIONS.MEMBER_INVITE,
		PERMISSIONS.MEMBER_REMOVE,
		PERMISSIONS.MEMBER_MANAGE,
		PERMISSIONS.TEAM_CREATE,
		PERMISSIONS.TEAM_READ,
		PERMISSIONS.TEAM_WRITE,
		PERMISSIONS.TEAM_DELETE,
	],
	MEMBER: [PERMISSIONS.USER_READ, PERMISSIONS.ORG_READ, PERMISSIONS.TEAM_READ],
	GUEST: [PERMISSIONS.USER_READ, PERMISSIONS.ORG_READ],
} as const;

// HTTP Headers
export const HEADERS = {
	TENANT_ID: "x-tenant-id",
	REQUEST_ID: "x-request-id",
	API_KEY: "x-api-key",
	CSRF_TOKEN: "x-csrf-token",
} as const;

// Regex patterns
export const PATTERNS = {
	EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
	SLUG: /^[a-z0-9-]+$/,
	STRONG_PASSWORD:
		/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
} as const;
