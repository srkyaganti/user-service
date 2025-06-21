import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient } from 'hono/testing'
import { app } from '../../apps/api/src/index'
import { createTestTenant, getTestRedis } from '../setup'
import { getDbClient } from '../../apps/api/src/lib/database'
import type { Tenant } from '@repo/database'

describe('Tenant Type E2E Flows', () => {
  let client: ReturnType<typeof testClient>
  let b2bTenant: Tenant
  let b2cTenant: Tenant
  let hybridTenant: Tenant
  let redis: any

  beforeAll(async () => {
    client = testClient(app)
    redis = getTestRedis()
    
    // Create different tenant types
    b2bTenant = await createTestTenant('b2b-test', 'B2B')
    b2cTenant = await createTestTenant('b2c-test', 'B2C')
    hybridTenant = await createTestTenant('hybrid-test', 'HYBRID')
  })

  afterAll(async () => {
    await redis?.quit()
  })

  describe('B2B Tenant Flow', () => {
    it('should have B2B default settings', async () => {
      const db = await getDbClient(b2bTenant.id)
      const settings = await db.tenantSettings.findUnique({
        where: { id: 'default' }
      })

      expect(settings).toMatchObject({
        emailPasswordEnabled: true,
        magicLinkEnabled: false,
        googleAuthEnabled: true,
        microsoftAuthEnabled: true,
        requireActivation: true,
        passwordMinLength: 10,
        sessionTimeout: 28800, // 8 hours
        mfaRequiredForAdmins: true
      })
    })

    it('should require organization for B2B registration', async () => {
      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2bTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'b2b-user@example.com',
          password: 'SecurePass123!',
          profile: { name: 'B2B User' }
        }
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Organization membership required')
    })

    it('should create B2B roles for first user', async () => {
      // Create organization first
      const db = await getDbClient(b2bTenant.id)
      const org = await db.organization.create({
        data: {
          name: 'Test B2B Org',
          slug: 'test-b2b-org'
        }
      })

      // Create invitation
      const invitation = await db.invitation.create({
        data: {
          orgId: org.id,
          email: 'b2b-admin@example.com',
          role: 'ADMIN',
          invitedBy: 'system',
          token: 'test-invitation-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      })

      // Register with invitation
      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2bTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'b2b-admin@example.com',
          password: 'SecurePass123!',
          profile: { name: 'B2B Admin' },
          invitationToken: invitation.token
        }
      })

      expect(response.status).toBe(200)
      
      // Check roles created
      const roles = await db.role.findMany({
        orderBy: { name: 'asc' }
      })
      
      expect(roles.map(r => r.name)).toContain('super_admin')
      expect(roles.map(r => r.name)).toContain('admin')
      expect(roles.map(r => r.name)).toContain('manager')
      expect(roles.map(r => r.name)).toContain('member')
      
      // Check user has admin role (first user)
      const user = await db.user.findUnique({
        where: { email: 'b2b-admin@example.com' },
        include: {
          defaultRoles: {
            include: { role: true }
          }
        }
      })
      
      expect(user?.isTenantAdmin).toBe(true)
      expect(user?.defaultRoles[0]?.role.name).toBe('admin')
    })

    it('should enforce strict password policy', async () => {
      const db = await getDbClient(b2bTenant.id)
      const org = await db.organization.findFirst()
      const invitation = await db.invitation.create({
        data: {
          orgId: org!.id,
          email: 'weak-password@example.com',
          role: 'MEMBER',
          invitedBy: 'system',
          token: 'weak-password-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      })

      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2bTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'weak-password@example.com',
          password: 'weak123', // Too short for B2B
          invitationToken: invitation.token
        }
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('at least 10 characters')
    })
  })

  describe('B2C Tenant Flow', () => {
    it('should have B2C default settings', async () => {
      const db = await getDbClient(b2cTenant.id)
      const settings = await db.tenantSettings.findUnique({
        where: { id: 'default' }
      })

      expect(settings).toMatchObject({
        emailPasswordEnabled: true,
        magicLinkEnabled: true,
        googleAuthEnabled: true,
        githubAuthEnabled: true,
        microsoftAuthEnabled: false,
        requireActivation: false,
        passwordMinLength: 8,
        passwordRequireSpecial: false,
        sessionTimeout: 86400, // 24 hours
        mfaRequiredForAdmins: false
      })
    })

    it('should allow B2C registration without organization', async () => {
      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2cTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'b2c-user@example.com',
          password: 'Simple123',
          profile: { name: 'B2C User' }
        }
      })

      expect(response.status).toBe(201)
      const data = await response.json()
      
      expect(data.success).toBe(true)
      expect(data.data.user.email).toBe('b2c-user@example.com')
      expect(data.data.tokens).toBeDefined() // Get tokens immediately (no activation)
    })

    it('should create B2C roles for first user', async () => {
      const db = await getDbClient(b2cTenant.id)
      
      // Check roles created
      const roles = await db.role.findMany({
        orderBy: { name: 'asc' }
      })
      
      expect(roles.map(r => r.name)).toContain('premium_user')
      expect(roles.map(r => r.name)).toContain('standard_user')
      expect(roles.map(r => r.name)).toContain('free_user')
      
      // Check first user has premium role
      const user = await db.user.findFirst({
        include: {
          defaultRoles: {
            include: { role: true }
          }
        }
      })
      
      expect(user?.defaultRoles[0]?.role.name).toBe('premium_user')
    })

    it('should assign free role to subsequent B2C users', async () => {
      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2cTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'b2c-free@example.com',
          password: 'Simple123',
          profile: { name: 'Free User' }
        }
      })

      expect(response.status).toBe(201)
      
      const db = await getDbClient(b2cTenant.id)
      const user = await db.user.findUnique({
        where: { email: 'b2c-free@example.com' },
        include: {
          defaultRoles: {
            include: { role: true }
          }
        }
      })
      
      expect(user?.defaultRoles[0]?.role.name).toBe('free_user')
    })

    it('should allow relaxed password policy', async () => {
      const response = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': b2cTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'simple-password@example.com',
          password: 'simple12', // No special chars required for B2C
          profile: { name: 'Simple Password User' }
        }
      })

      expect(response.status).toBe(201)
    })
  })

  describe('HYBRID Tenant Flow', () => {
    it('should have HYBRID default settings', async () => {
      const db = await getDbClient(hybridTenant.id)
      const settings = await db.tenantSettings.findUnique({
        where: { id: 'default' }
      })

      expect(settings).toMatchObject({
        emailPasswordEnabled: true,
        magicLinkEnabled: true,
        googleAuthEnabled: true,
        githubAuthEnabled: true,
        microsoftAuthEnabled: true,
        requireActivation: false,
        passwordMinLength: 8,
        passwordRequireSpecial: true,
        sessionTimeout: 43200, // 12 hours
        mfaRequiredForAdmins: true
      })
    })

    it('should create both B2B and B2C roles', async () => {
      // Register first user
      await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': hybridTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'hybrid-admin@example.com',
          password: 'Hybrid123!',
          profile: { name: 'Hybrid Admin' }
        }
      })

      const db = await getDbClient(hybridTenant.id)
      const roles = await db.role.findMany({
        orderBy: { name: 'asc' }
      })
      
      // Should have all 7 roles
      const roleNames = roles.map(r => r.name)
      
      // B2B roles
      expect(roleNames).toContain('super_admin')
      expect(roleNames).toContain('admin')
      expect(roleNames).toContain('manager')
      expect(roleNames).toContain('member')
      
      // B2C roles
      expect(roleNames).toContain('premium_user')
      expect(roleNames).toContain('standard_user')
      expect(roleNames).toContain('free_user')
      
      expect(roles).toHaveLength(7)
    })

    it('should allow registration with or without organization', async () => {
      // Without organization (B2C style)
      const b2cResponse = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': hybridTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'hybrid-b2c@example.com',
          password: 'Hybrid123!',
          profile: { name: 'Hybrid B2C User' }
        }
      })

      expect(b2cResponse.status).toBe(201)
      
      // With organization (B2B style)
      const db = await getDbClient(hybridTenant.id)
      const org = await db.organization.create({
        data: {
          name: 'Hybrid Org',
          slug: 'hybrid-org'
        }
      })
      
      const invitation = await db.invitation.create({
        data: {
          orgId: org.id,
          email: 'hybrid-b2b@example.com',
          role: 'MEMBER',
          invitedBy: 'system',
          token: 'hybrid-invitation',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      })

      const b2bResponse = await client.api.v1.auth.register.$post({
        header: {
          'X-Tenant-ID': hybridTenant.id,
          'Content-Type': 'application/json'
        },
        json: {
          email: 'hybrid-b2b@example.com',
          password: 'Hybrid123!',
          profile: { name: 'Hybrid B2B User' },
          invitationToken: invitation.token
        }
      })

      expect(b2bResponse.status).toBe(201)
      
      // Check user types
      const b2cUser = await db.user.findUnique({
        where: { email: 'hybrid-b2c@example.com' }
      })
      const b2bUser = await db.user.findUnique({
        where: { email: 'hybrid-b2b@example.com' }
      })
      
      expect(b2cUser?.userType).toBe('INDIVIDUAL')
      expect(b2bUser?.userType).toBe('ORGANIZATIONAL')
    })

    it('should assign appropriate default roles', async () => {
      const db = await getDbClient(hybridTenant.id)
      
      // First user should get admin role
      const firstUser = await db.user.findFirst({
        include: {
          defaultRoles: {
            include: { role: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      })
      
      expect(firstUser?.defaultRoles[0]?.role.name).toBe('admin')
      
      // Subsequent users should get standard_user role
      const laterUser = await db.user.findUnique({
        where: { email: 'hybrid-b2c@example.com' },
        include: {
          defaultRoles: {
            include: { role: true }
          }
        }
      })
      
      expect(laterUser?.defaultRoles[0]?.role.name).toBe('standard_user')
    })
  })

  describe('Login Method Restrictions', () => {
    it('should respect tenant-specific login methods', async () => {
      // Try magic link on B2B tenant (should fail)
      const b2bDb = await getDbClient(b2bTenant.id)
      await b2bDb.user.create({
        data: {
          email: 'magiclink-b2b@example.com',
          isActive: true,
          profile: {}
        }
      })

      // This would normally be a magic link endpoint
      // For now, just verify the setting
      const b2bSettings = await b2bDb.tenantSettings.findUnique({
        where: { id: 'default' }
      })
      expect(b2bSettings?.magicLinkEnabled).toBe(false)

      // Magic link should work on B2C tenant
      const b2cDb = await getDbClient(b2cTenant.id)
      const b2cSettings = await b2cDb.tenantSettings.findUnique({
        where: { id: 'default' }
      })
      expect(b2cSettings?.magicLinkEnabled).toBe(true)
    })
  })
})