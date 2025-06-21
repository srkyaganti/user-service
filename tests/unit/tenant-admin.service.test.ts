import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TenantAdminService } from '../../apps/api/src/services/tenant-admin.service'
import { TenantSettingsService } from '../../apps/api/src/services/tenant-settings.service'
import { AuditService } from '../../apps/api/src/services/audit.service'
import { getDbClient } from '../../apps/api/src/lib/database'
import { prisma } from '../../apps/api/src/lib/prisma'

// Mock dependencies
vi.mock('../../apps/api/src/lib/database')
vi.mock('../../apps/api/src/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}))
vi.mock('../../apps/api/src/services/tenant-settings.service')
vi.mock('../../apps/api/src/services/audit.service')

describe('TenantAdminService', () => {
  let service: TenantAdminService
  let mockDb: any
  let mockTenantSettingsService: any
  let mockAuditService: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock database
    mockDb = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn()
      },
      role: {
        findUnique: vi.fn()
      },
      userRole: {
        upsert: vi.fn(),
        deleteMany: vi.fn()
      },
      organization: {
        count: vi.fn()
      },
      session: {
        count: vi.fn()
      }
    }
    vi.mocked(getDbClient).mockResolvedValue(mockDb)

    // Mock services
    mockTenantSettingsService = {
      updateSettings: vi.fn()
    }
    mockAuditService = {
      log: vi.fn()
    }

    TenantSettingsService.prototype.updateSettings = mockTenantSettingsService.updateSettings
    AuditService.prototype.log = mockAuditService.log

    service = new TenantAdminService()
  })

  describe('isTenantAdmin', () => {
    it('should return true if user is tenant admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-123',
        isTenantAdmin: true
      })

      const result = await service.isTenantAdmin('tenant-123', 'user-123')

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: { isTenantAdmin: true }
      })
      expect(result).toBe(true)
    })

    it('should return false if user is not tenant admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-123',
        isTenantAdmin: false
      })

      const result = await service.isTenantAdmin('tenant-123', 'user-123')

      expect(result).toBe(false)
    })

    it('should return false if user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const result = await service.isTenantAdmin('tenant-123', 'user-123')

      expect(result).toBe(false)
    })
  })

  describe('grantAdminPrivileges', () => {
    const mockUser = {
      id: 'user-123',
      email: 'user@example.com',
      isTenantAdmin: true
    }

    beforeEach(() => {
      mockDb.user.update.mockResolvedValue(mockUser)
      mockDb.role.findUnique.mockResolvedValue({
        id: 'role-admin',
        name: 'super_admin'
      })
    })

    it('should grant admin privileges to user', async () => {
      const result = await service.grantAdminPrivileges(
        'tenant-123',
        'user-123',
        'granter-123'
      )

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { isTenantAdmin: true }
      })
      expect(mockDb.userRole.upsert).toHaveBeenCalledWith({
        where: {
          userId_roleId: {
            userId: 'user-123',
            roleId: 'role-admin'
          }
        },
        create: {
          userId: 'user-123',
          roleId: 'role-admin'
        },
        update: {}
      })
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'granter-123',
        action: 'tenant_admin.grant',
        resource: 'user',
        resourceId: 'user-123',
        metadata: {
          targetUserId: 'user-123'
        }
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe('revokeAdminPrivileges', () => {
    const mockUser = {
      id: 'user-123',
      email: 'user@example.com',
      isTenantAdmin: false
    }

    beforeEach(() => {
      mockDb.user.update.mockResolvedValue(mockUser)
      mockDb.role.findUnique.mockResolvedValue({
        id: 'role-admin',
        name: 'super_admin'
      })
    })

    it('should revoke admin privileges from user', async () => {
      const result = await service.revokeAdminPrivileges(
        'tenant-123',
        'user-123',
        'revoker-123'
      )

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { isTenantAdmin: false }
      })
      expect(mockDb.userRole.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          roleId: 'role-admin'
        }
      })
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'revoker-123',
        action: 'tenant_admin.revoke',
        resource: 'user',
        resourceId: 'user-123',
        metadata: {
          targetUserId: 'user-123'
        }
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe('listAdmins', () => {
    it('should return list of tenant admins', async () => {
      const mockAdmins = [
        { id: 'admin-1', email: 'admin1@example.com', isTenantAdmin: true },
        { id: 'admin-2', email: 'admin2@example.com', isTenantAdmin: true }
      ]
      mockDb.user.findMany.mockResolvedValue(mockAdmins)

      const result = await service.listAdmins('tenant-123')

      expect(mockDb.user.findMany).toHaveBeenCalledWith({
        where: {
          isTenantAdmin: true,
          deletedAt: null
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      expect(result).toEqual(mockAdmins)
    })
  })

  describe('updateTenantSettings', () => {
    it('should update settings if user is admin', async () => {
      // Mock isTenantAdmin to return true
      mockDb.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        isTenantAdmin: true
      })

      const settings = { mfaRequired: true }
      const updatedSettings = { id: 'default', ...settings }
      mockTenantSettingsService.updateSettings.mockResolvedValue(updatedSettings)

      const result = await service.updateTenantSettings(
        'tenant-123',
        'admin-123',
        settings
      )

      expect(mockTenantSettingsService.updateSettings).toHaveBeenCalledWith(
        'tenant-123',
        settings
      )
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'admin-123',
        action: 'tenant_settings.update',
        resource: 'tenant_settings',
        resourceId: 'default',
        metadata: {
          changes: settings
        }
      })
      expect(result).toEqual(updatedSettings)
    })

    it('should throw error if user is not admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-123',
        isTenantAdmin: false
      })

      await expect(
        service.updateTenantSettings('tenant-123', 'user-123', {})
      ).rejects.toThrow('Unauthorized: Admin privileges required')
    })
  })

  describe('updateTenantInfo', () => {
    it('should update tenant info if user is admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        isTenantAdmin: true
      })

      const tenantData = {
        name: 'Updated Tenant',
        settings: { someConfig: true }
      }
      const updatedTenant = {
        id: 'tenant-123',
        ...tenantData
      }
      vi.mocked(prisma.tenant.update).mockResolvedValue(updatedTenant as any)

      const result = await service.updateTenantInfo(
        'tenant-123',
        'admin-123',
        tenantData
      )

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-123' },
        data: tenantData
      })
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'admin-123',
        action: 'tenant.update',
        resource: 'tenant',
        resourceId: 'tenant-123',
        metadata: {
          changes: tenantData
        }
      })
      expect(result).toEqual(updatedTenant)
    })
  })

  describe('getTenantStats', () => {
    it('should return tenant statistics if user is admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        isTenantAdmin: true
      })
      mockDb.user.count.mockResolvedValue(100)
      mockDb.organization.count.mockResolvedValue(10)
      mockDb.session.count.mockResolvedValue(50)
      mockDb.user.count
        .mockResolvedValueOnce(100) // total users
        .mockResolvedValueOnce(25) // mfa enabled users

      const result = await service.getTenantStats('tenant-123', 'admin-123')

      expect(result).toEqual({
        users: {
          total: 100,
          mfaEnabled: 25
        },
        organizations: {
          total: 10
        },
        sessions: {
          active: 50
        }
      })
    })

    it('should throw error if user is not admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-123',
        isTenantAdmin: false
      })

      await expect(
        service.getTenantStats('tenant-123', 'user-123')
      ).rejects.toThrow('Unauthorized: Admin privileges required')
    })
  })

  describe('enforceMfaForAllUsers', () => {
    it('should enforce MFA for all users if admin', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        isTenantAdmin: true
      })
      mockTenantSettingsService.updateSettings.mockResolvedValue({
        id: 'default',
        mfaRequired: true
      })

      await service.enforceMfaForAllUsers('tenant-123', 'admin-123', false)

      expect(mockTenantSettingsService.updateSettings).toHaveBeenCalledWith(
        'tenant-123',
        { mfaRequired: true }
      )
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'admin-123',
        action: 'mfa.enforce',
        resource: 'tenant_settings',
        resourceId: 'default',
        metadata: {
          enforceForAdminsOnly: false
        }
      })
    })

    it('should enforce MFA for admins only', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'admin-123',
        isTenantAdmin: true
      })
      mockTenantSettingsService.updateSettings.mockResolvedValue({
        id: 'default',
        mfaRequiredForAdmins: true
      })

      await service.enforceMfaForAllUsers('tenant-123', 'admin-123', true)

      expect(mockTenantSettingsService.updateSettings).toHaveBeenCalledWith(
        'tenant-123',
        { mfaRequiredForAdmins: true }
      )
      expect(mockAuditService.log).toHaveBeenCalledWith('tenant-123', {
        userId: 'admin-123',
        action: 'mfa.enforce',
        resource: 'tenant_settings',
        resourceId: 'default',
        metadata: {
          enforceForAdminsOnly: true
        }
      })
    })
  })
})