import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TenantSettingsService } from '../../apps/api/src/services/tenant-settings.service'
import { dbManager } from '@user-service/database'

// Create mock functions
const mockGetClient = vi.fn()
const mockGetTenant = vi.fn()
const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn()
}

// Mock dependencies
vi.mock('@user-service/database', () => ({
  dbManager: {
    getClient: () => mockGetClient(),
    getTenant: () => mockGetTenant()
  }
}))

vi.mock('../../apps/api/src/services/cache.service', () => ({
  CacheService: vi.fn().mockImplementation(() => mockCache)
}))

describe('TenantSettingsService', () => {
  let service: TenantSettingsService
  let mockDb: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock database
    mockDb = {
      tenantSettings: {
        findUnique: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn()
      },
      role: {
        findUnique: vi.fn(),
        upsert: vi.fn()
      },
      userRole: {
        create: vi.fn(),
        findMany: vi.fn()
      },
      user: {
        count: vi.fn()
      }
    }
    mockGetClient.mockResolvedValue(mockDb)

    service = new TenantSettingsService()
  })

  describe('getSettings', () => {
    it('should return cached settings if available', async () => {
      const cachedSettings = { id: 'default', mfaRequired: true }
      mockCache.get.mockResolvedValue(cachedSettings)

      const result = await service.getSettings('tenant-123')

      expect(mockCache.get).toHaveBeenCalledWith('tenant:tenant-123:settings')
      expect(result).toEqual(cachedSettings)
      expect(mockDb.tenantSettings.findUnique).not.toHaveBeenCalled()
    })

    it('should create default B2B settings if none exist', async () => {
      mockCache.get.mockResolvedValue(null)
      mockDb.tenantSettings.findUnique.mockResolvedValue(null)
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2B' 
      })

      const expectedSettings = {
        id: 'default',
        emailPasswordEnabled: true,
        magicLinkEnabled: false,
        googleAuthEnabled: true,
        githubAuthEnabled: false,
        microsoftAuthEnabled: true,
        mfaRequired: false,
        mfaRequiredForAdmins: true,
        totpEnabled: true,
        webauthnEnabled: true,
        requireActivation: true,
        requireMfaForActivation: false,
        passwordMinLength: 10,
        passwordRequireSpecial: true,
        passwordRequireNumber: true,
        passwordRequireUpper: true,
        sessionTimeout: 28800,
        refreshTokenExpiry: 604800
      }

      mockDb.tenantSettings.create.mockResolvedValue(expectedSettings)

      const result = await service.getSettings('tenant-123')

      expect(mockDb.tenantSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'default',
          emailPasswordEnabled: true,
          magicLinkEnabled: false,
          requireActivation: true,
          passwordMinLength: 10
        })
      })
      expect(result).toEqual(expectedSettings)
    })

    it('should create default B2C settings for B2C tenant', async () => {
      mockCache.get.mockResolvedValue(null)
      mockDb.tenantSettings.findUnique.mockResolvedValue(null)
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2C' 
      })

      mockDb.tenantSettings.create.mockResolvedValue({ id: 'default' })

      await service.getSettings('tenant-123')

      expect(mockDb.tenantSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'default',
          magicLinkEnabled: true,
          requireActivation: false,
          passwordMinLength: 8,
          passwordRequireSpecial: false
        })
      })
    })

    it('should create default HYBRID settings for HYBRID tenant', async () => {
      mockCache.get.mockResolvedValue(null)
      mockDb.tenantSettings.findUnique.mockResolvedValue(null)
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'HYBRID' 
      })

      mockDb.tenantSettings.create.mockResolvedValue({ id: 'default' })

      await service.getSettings('tenant-123')

      expect(mockDb.tenantSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'default',
          magicLinkEnabled: true,
          requireActivation: false,
          passwordMinLength: 8,
          sessionTimeout: 43200
        })
      })
    })
  })

  describe('updateSettings', () => {
    it('should update settings and invalidate cache', async () => {
      const updatedSettings = { id: 'default', mfaRequired: true }
      mockDb.tenantSettings.upsert.mockResolvedValue(updatedSettings)

      const result = await service.updateSettings('tenant-123', {
        mfaRequired: true
      })

      expect(mockDb.tenantSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        update: { mfaRequired: true },
        create: {
          id: 'default',
          mfaRequired: true
        }
      })
      expect(mockCache.delete).toHaveBeenCalledWith('tenant:tenant-123:settings')
      expect(result).toEqual(updatedSettings)
    })
  })

  describe('isLoginMethodEnabled', () => {
    it('should check if email/password login is enabled', async () => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        emailPasswordEnabled: true
      })

      const result = await service.isLoginMethodEnabled('tenant-123', 'emailPassword')

      expect(result).toBe(true)
    })

    it('should check if social login is enabled', async () => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        googleAuthEnabled: false
      })

      const result = await service.isLoginMethodEnabled('tenant-123', 'google')

      expect(result).toBe(false)
    })
  })

  describe('isMfaRequired', () => {
    it('should return true if MFA is required for all users', async () => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        mfaRequired: true
      })

      const result = await service.isMfaRequired('tenant-123', false)

      expect(result).toBe(true)
    })

    it('should return true if MFA is required for admins and user is admin', async () => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        mfaRequired: false,
        mfaRequiredForAdmins: true
      })

      const result = await service.isMfaRequired('tenant-123', true)

      expect(result).toBe(true)
    })

    it('should return false if MFA is not required', async () => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        mfaRequired: false,
        mfaRequiredForAdmins: false
      })

      const result = await service.isMfaRequired('tenant-123', false)

      expect(result).toBe(false)
    })
  })

  describe('validatePassword', () => {
    beforeEach(() => {
      mockCache.get.mockResolvedValue({
        id: 'default',
        passwordMinLength: 8,
        passwordRequireSpecial: true,
        passwordRequireNumber: true,
        passwordRequireUpper: true
      })
    })

    it('should validate password length', async () => {
      const result = await service.validatePassword('tenant-123', 'short')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Password must be at least 8 characters long')
    })

    it('should validate special character requirement', async () => {
      const result = await service.validatePassword('tenant-123', 'Password123')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Password must contain at least one special character')
    })

    it('should validate number requirement', async () => {
      const result = await service.validatePassword('tenant-123', 'Password!')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Password must contain at least one number')
    })

    it('should validate uppercase requirement', async () => {
      const result = await service.validatePassword('tenant-123', 'password123!')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Password must contain at least one uppercase letter')
    })

    it('should accept valid password', async () => {
      const result = await service.validatePassword('tenant-123', 'Password123!')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('initializeSystemRoles', () => {
    it('should create B2B roles for B2B tenant', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2B' 
      })

      await service.initializeSystemRoles('tenant-123')

      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'super_admin' },
          create: expect.objectContaining({
            name: 'super_admin',
            displayName: 'Super Administrator',
            permissions: ['*']
          })
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'admin' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'manager' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'member' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledTimes(4)
    })

    it('should create B2C roles for B2C tenant', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2C' 
      })

      await service.initializeSystemRoles('tenant-123')

      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'premium_user' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'standard_user' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'free_user' }
        })
      )
      expect(mockDb.role.upsert).toHaveBeenCalledTimes(3)
    })

    it('should create both B2B and B2C roles for HYBRID tenant', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'HYBRID' 
      })

      await service.initializeSystemRoles('tenant-123')

      // Should create all 7 roles (4 B2B + 3 B2C)
      expect(mockDb.role.upsert).toHaveBeenCalledTimes(7)
    })
  })

  describe('assignDefaultRole', () => {
    it('should assign admin role to first B2B user', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2B' 
      })
      mockDb.role.findUnique.mockResolvedValue({ id: 'role-123', name: 'admin' })

      await service.assignDefaultRole('tenant-123', 'user-123', true)

      expect(mockDb.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'admin' }
      })
      expect(mockDb.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          roleId: 'role-123'
        }
      })
    })

    it('should assign member role to non-first B2B user', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2B' 
      })
      mockDb.role.findUnique.mockResolvedValue({ id: 'role-456', name: 'member' })

      await service.assignDefaultRole('tenant-123', 'user-123', false)

      expect(mockDb.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'member' }
      })
    })

    it('should assign premium role to first B2C user', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2C' 
      })
      mockDb.role.findUnique.mockResolvedValue({ id: 'role-789', name: 'premium_user' })

      await service.assignDefaultRole('tenant-123', 'user-123', true)

      expect(mockDb.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'premium_user' }
      })
    })

    it('should assign free role to non-first B2C user', async () => {
      mockGetTenant.mockResolvedValue({ 
        id: 'tenant-123', 
        type: 'B2C' 
      })
      mockDb.role.findUnique.mockResolvedValue({ id: 'role-999', name: 'free_user' })

      await service.assignDefaultRole('tenant-123', 'user-123', false)

      expect(mockDb.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'free_user' }
      })
    })
  })

  describe('hasPermission', () => {
    it('should return true for wildcard permission', async () => {
      mockDb.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: ['*']
          }
        }
      ])

      const result = await service.hasPermission('tenant-123', 'user-123', 'users.delete')

      expect(result).toBe(true)
    })

    it('should return true for exact permission match', async () => {
      mockDb.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: ['users.view', 'users.create']
          }
        }
      ])

      const result = await service.hasPermission('tenant-123', 'user-123', 'users.view')

      expect(result).toBe(true)
    })

    it('should return true for wildcard permission match', async () => {
      mockDb.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: ['users.*']
          }
        }
      ])

      const result = await service.hasPermission('tenant-123', 'user-123', 'users.delete')

      expect(result).toBe(true)
    })

    it('should return false for missing permission', async () => {
      mockDb.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: ['users.view']
          }
        }
      ])

      const result = await service.hasPermission('tenant-123', 'user-123', 'users.delete')

      expect(result).toBe(false)
    })
  })
})