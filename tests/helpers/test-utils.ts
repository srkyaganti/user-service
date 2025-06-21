import { Hono } from 'hono'
import { testClient } from 'hono/testing'
import type { User, Organization, Invitation } from '@user-service/database'

// Mock user data
export const mockUser: Partial<User> = {
  id: 'user-123',
  email: 'test@example.com',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test-hash',
  profile: { name: 'Test User' },
  userType: 'INDIVIDUAL',
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

export const mockOrganization: Partial<Organization> = {
  id: 'org-123',
  name: 'Test Organization',
  slug: 'test-org',
  description: 'Test organization',
  createdAt: new Date(),
  updatedAt: new Date(),
}

export const mockInvitation: Partial<Invitation> = {
  id: 'inv-123',
  token: 'invitation-token-123',
  email: 'invite@example.com',
  role: 'MEMBER',
  orgId: 'org-123',
  invitedBy: 'user-123',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
}

// HTTP client helper
export const createTestClient = (app: Hono) => {
  return testClient(app)
}

// Auth helper
export const createAuthHeaders = (token: string, tenantId = 'test-tenant') => ({
  'Authorization': `Bearer ${token}`,
  'X-Tenant-ID': tenantId,
  'Content-Type': 'application/json',
})

// Generate test JWT token
export const generateTestToken = (payload: any = {}) => {
  // Simple test token - in real tests we'd use the actual JWT service
  return Buffer.from(JSON.stringify({
    userId: 'user-123',
    email: 'test@example.com',
    tenantId: 'test-tenant',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  })).toString('base64')
}

// Wait helper for async operations
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Random string generator
export const randomString = (length = 10) => {
  return Math.random().toString(36).substring(2, length + 2)
}

// Email pattern matcher
export const isValidEmail = (email: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Mock implementations
export const mockDbOperations = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  session: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  invitation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}

// Cache mock
export const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ping: vi.fn().mockResolvedValue('PONG'),
  exists: vi.fn(),
  expire: vi.fn(),
  flushdb: vi.fn(),
}

// Email service mock
export const mockEmailService = {
  sendEmail: vi.fn().mockResolvedValue(true),
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendInvitationEmail: vi.fn().mockResolvedValue(true),
  sendMagicLinkEmail: vi.fn().mockResolvedValue(true),
  sendMFASetupEmail: vi.fn().mockResolvedValue(true),
}

// Events mock
export const mockEvents = {
  publish: vi.fn().mockResolvedValue(true),
}