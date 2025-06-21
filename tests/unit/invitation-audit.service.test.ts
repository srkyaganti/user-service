import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { InvitationService } from '../../apps/api/src/services/invitation.service'
import { AuditService } from '../../apps/api/src/services/audit.service'
import { dbManager } from '@user-service/database'
import { EmailService } from '../../apps/api/src/services/email.service'
import { EventService } from '../../apps/api/src/services/event.service'
import { generateSecureToken } from '../../apps/api/src/lib/crypto'
import { 
  ValidationError, 
  NotFoundError, 
  ForbiddenError,
  ConflictError 
} from '@user-service/shared'
import { mockDbOperations, mockEmailService, mockEvents, mockInvitation } from '../helpers/test-utils'

// Mock dependencies
vi.mock('@user-service/database')
vi.mock('../../apps/api/src/services/email.service')
vi.mock('../../apps/api/src/services/event.service')
vi.mock('../../apps/api/src/lib/crypto')

describe('InvitationService', () => {
  let invitationService: InvitationService
  
  const mockMembership = {
    id: 'membership-123',
    userId: 'user-123',
    organizationId: 'org-123',
    role: 'ADMIN',
  }

  beforeEach(() => {
    invitationService = new InvitationService()
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any)
    vi.mocked(EmailService.getInstance).mockReturnValue(mockEmailService as any)
    vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any)
    vi.mocked(generateSecureToken).mockReturnValue('secure-token-123')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('sendInvitation', () => {
    it('should successfully send invitation', async () => {
      // Arrange
      const invitationData = {
        email: 'invitee@example.com',
        role: 'MEMBER' as const,
        message: 'Welcome to our organization!',
        expiresInDays: 7,
      }
      
      const organization = {
        id: 'org-123',
        name: 'Test Organization',
        slug: 'test-org',
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.organization.findUnique.mockResolvedValue(organization)
      mockDbOperations.invitation.findFirst.mockResolvedValue(null) // No existing invitation
      mockDbOperations.invitation.create.mockResolvedValue({
        ...mockInvitation,
        ...invitationData,
        organization,
      })

      // Act
      const result = await invitationService.sendInvitation(
        'tenant-123',
        'user-123',
        'org-123',
        invitationData
      )

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          id: mockInvitation.id,
          email: invitationData.email,
          role: invitationData.role,
          token: 'secure-token-123',
        })
      )
      
      expect(mockDbOperations.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          token: 'secure-token-123',
          email: invitationData.email,
          role: invitationData.role,
          orgId: 'org-123',
          invitedBy: 'user-123',
          message: invitationData.message,
          expiresAt: expect.any(Date),
        }),
        include: { organization: true },
      })
      
      expect(mockEmailService.sendInvitationEmail).toHaveBeenCalledWith(
        invitationData.email,
        organization.name,
        'secure-token-123',
        invitationData.message,
        expect.any(String) // Invitation URL
      )
      expect(mockEvents.publish).toHaveBeenCalled()
    })

    it('should throw ForbiddenError for insufficient permissions', async () => {
      // Arrange
      const memberMembership = {
        ...mockMembership,
        role: 'MEMBER',
      }
      
      const invitationData = {
        email: 'invitee@example.com',
        role: 'MEMBER' as const,
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(memberMembership)

      // Act & Assert
      await expect(invitationService.sendInvitation(
        'tenant-123',
        'user-123',
        'org-123',
        invitationData
      )).rejects.toThrow(ForbiddenError)
      
      expect(mockDbOperations.invitation.create).not.toHaveBeenCalled()
    })

    it('should throw ConflictError for existing pending invitation', async () => {
      // Arrange
      const invitationData = {
        email: 'existing@example.com',
        role: 'MEMBER' as const,
      }
      
      const existingInvitation = {
        ...mockInvitation,
        email: invitationData.email,
        acceptedAt: null,
        revokedAt: null,
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.organization.findUnique.mockResolvedValue({ id: 'org-123' })
      mockDbOperations.invitation.findFirst.mockResolvedValue(existingInvitation)

      // Act & Assert
      await expect(invitationService.sendInvitation(
        'tenant-123',
        'user-123',
        'org-123',
        invitationData
      )).rejects.toThrow(ConflictError)
    })

    it('should validate invitation role hierarchy', async () => {
      // Arrange
      const invitationData = {
        email: 'invitee@example.com',
        role: 'ADMIN' as const, // Trying to invite as admin
      }
      
      const memberMembership = {
        ...mockMembership,
        role: 'MEMBER', // But inviter is only a member
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(memberMembership)

      // Act & Assert
      await expect(invitationService.sendInvitation(
        'tenant-123',
        'user-123',
        'org-123',
        invitationData
      )).rejects.toThrow(ForbiddenError)
    })
  })

  describe('getInvitation', () => {
    it('should successfully get invitation by token', async () => {
      // Arrange
      const invitationWithOrg = {
        ...mockInvitation,
        organization: {
          id: 'org-123',
          name: 'Test Organization',
        },
      }
      
      mockDbOperations.invitation.findUnique.mockResolvedValue(invitationWithOrg)

      // Act
      const result = await invitationService.getInvitation('invitation-token-123')

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          id: mockInvitation.id,
          email: mockInvitation.email,
          role: mockInvitation.role,
          organization: expect.objectContaining({
            name: 'Test Organization',
          }),
        })
      )
      
      expect(mockDbOperations.invitation.findUnique).toHaveBeenCalledWith({
        where: { token: 'invitation-token-123' },
        include: { organization: true },
      })
    })

    it('should throw NotFoundError for non-existent invitation', async () => {
      // Arrange
      mockDbOperations.invitation.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(invitationService.getInvitation('invalid-token'))
        .rejects.toThrow(NotFoundError)
    })

    it('should throw ValidationError for expired invitation', async () => {
      // Arrange
      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired
      }
      
      mockDbOperations.invitation.findUnique.mockResolvedValue(expiredInvitation)

      // Act & Assert
      await expect(invitationService.getInvitation('expired-token'))
        .rejects.toThrow(ValidationError)
    })

    it('should throw ValidationError for already accepted invitation', async () => {
      // Arrange
      const acceptedInvitation = {
        ...mockInvitation,
        acceptedAt: new Date(),
      }
      
      mockDbOperations.invitation.findUnique.mockResolvedValue(acceptedInvitation)

      // Act & Assert
      await expect(invitationService.getInvitation('accepted-token'))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('listInvitations', () => {
    it('should return organization invitations', async () => {
      // Arrange
      const invitations = [
        {
          ...mockInvitation,
          id: 'inv-1',
          email: 'user1@example.com',
        },
        {
          ...mockInvitation,
          id: 'inv-2',
          email: 'user2@example.com',
        },
      ]
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.invitation.findMany.mockResolvedValue(invitations)

      // Act
      const result = await invitationService.listInvitations(
        'tenant-123',
        'user-123',
        'org-123'
      )

      // Assert
      expect(result).toEqual({
        invitations: expect.arrayContaining([
          expect.objectContaining({ email: 'user1@example.com' }),
          expect.objectContaining({ email: 'user2@example.com' }),
        ]),
      })
    })

    it('should filter invitations by status', async () => {
      // Arrange
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.invitation.findMany.mockResolvedValue([])

      // Act
      await invitationService.listInvitations(
        'tenant-123',
        'user-123',
        'org-123',
        { status: 'pending' }
      )

      // Assert
      expect(mockDbOperations.invitation.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-123',
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('resendInvitation', () => {
    it('should successfully resend invitation', async () => {
      // Arrange
      const pendingInvitation = {
        ...mockInvitation,
        acceptedAt: null,
        revokedAt: null,
        organization: {
          id: 'org-123',
          name: 'Test Organization',
        },
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.invitation.findFirst.mockResolvedValue(pendingInvitation)
      mockDbOperations.invitation.update.mockResolvedValue({
        ...pendingInvitation,
        token: 'new-secure-token-456',
      })

      // Act
      const result = await invitationService.resendInvitation(
        'tenant-123',
        'user-123',
        'invitation-123'
      )

      // Assert
      expect(result).toEqual({ success: true })
      
      expect(mockDbOperations.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invitation-123' },
        data: {
          token: 'secure-token-123',
          expiresAt: expect.any(Date),
        },
        include: { organization: true },
      })
      
      expect(mockEmailService.sendInvitationEmail).toHaveBeenCalled()
    })

    it('should throw ValidationError for already accepted invitation', async () => {
      // Arrange
      const acceptedInvitation = {
        ...mockInvitation,
        acceptedAt: new Date(),
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.invitation.findFirst.mockResolvedValue(acceptedInvitation)

      // Act & Assert
      await expect(invitationService.resendInvitation(
        'tenant-123',
        'user-123',
        'invitation-123'
      )).rejects.toThrow(ValidationError)
    })
  })

  describe('revokeInvitation', () => {
    it('should successfully revoke invitation', async () => {
      // Arrange
      const pendingInvitation = {
        ...mockInvitation,
        acceptedAt: null,
        revokedAt: null,
      }
      
      mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership)
      mockDbOperations.invitation.findFirst.mockResolvedValue(pendingInvitation)
      mockDbOperations.invitation.update.mockResolvedValue({
        ...pendingInvitation,
        revokedAt: new Date(),
      })

      // Act
      const result = await invitationService.revokeInvitation(
        'tenant-123',
        'user-123',
        'invitation-123'
      )

      // Assert
      expect(result).toEqual({ success: true })
      
      expect(mockDbOperations.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invitation-123' },
        data: { revokedAt: expect.any(Date) },
      })
      expect(mockEvents.publish).toHaveBeenCalled()
    })
  })

  describe('acceptInvitation', () => {
    it('should successfully accept invitation', async () => {
      // Arrange
      const validInvitation = {
        ...mockInvitation,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }
      
      mockDbOperations.invitation.findUnique.mockResolvedValue(validInvitation)
      mockDbOperations.invitation.update.mockResolvedValue({
        ...validInvitation,
        acceptedAt: new Date(),
      })

      // Act
      const result = await invitationService.acceptInvitation('invitation-token-123')

      // Assert
      expect(result).toEqual({
        success: true,
        organizationId: validInvitation.orgId,
        role: validInvitation.role,
      })
      
      expect(mockDbOperations.invitation.update).toHaveBeenCalledWith({
        where: { id: validInvitation.id },
        data: { acceptedAt: expect.any(Date) },
      })
      expect(mockEvents.publish).toHaveBeenCalled()
    })

    it('should throw ValidationError for expired invitation', async () => {
      // Arrange
      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }
      
      mockDbOperations.invitation.findUnique.mockResolvedValue(expiredInvitation)

      // Act & Assert
      await expect(invitationService.acceptInvitation('expired-token'))
        .rejects.toThrow(ValidationError)
    })
  })
})

describe('AuditService', () => {
  let auditService: AuditService
  
  const mockAuditLog = {
    id: 'audit-123',
    userId: 'user-123',
    action: 'user.login',
    resource: 'session',
    resourceId: 'session-123',
    details: {
      ipAddress: '192.168.1.100',
      userAgent: 'Chrome/91.0',
    },
    ipAddress: '192.168.1.100',
    userAgent: 'Chrome/91.0',
    timestamp: new Date(),
  }

  beforeEach(() => {
    auditService = new AuditService()
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('log', () => {
    it('should successfully create audit log', async () => {
      // Arrange
      const logData = {
        userId: 'user-123',
        action: 'user.update.profile',
        resource: 'user',
        resourceId: 'user-123',
        details: {
          changedFields: ['name', 'bio'],
        },
        ipAddress: '192.168.1.100',
        userAgent: 'Chrome/91.0',
      }
      
      mockDbOperations.auditLog.create.mockResolvedValue({
        ...mockAuditLog,
        ...logData,
      })

      // Act
      const result = await auditService.log('tenant-123', logData)

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          action: logData.action,
          resource: logData.resource,
        })
      )
      
      expect(mockDbOperations.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ...logData,
          timestamp: expect.any(Date),
        }),
      })
    })

    it('should handle optional fields', async () => {
      // Arrange
      const minimalLogData = {
        action: 'system.maintenance',
        resource: 'system',
      }
      
      mockDbOperations.auditLog.create.mockResolvedValue({
        ...mockAuditLog,
        ...minimalLogData,
        userId: null,
        resourceId: null,
      })

      // Act
      await auditService.log('tenant-123', minimalLogData)

      // Assert
      expect(mockDbOperations.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: minimalLogData.action,
          resource: minimalLogData.resource,
          userId: null,
          resourceId: null,
          timestamp: expect.any(Date),
        }),
      })
    })
  })

  describe('getAuditLogs', () => {
    it('should return audit logs with filters', async () => {
      // Arrange
      const auditLogs = [
        mockAuditLog,
        {
          ...mockAuditLog,
          id: 'audit-456',
          action: 'user.logout',
        },
      ]
      
      mockDbOperations.auditLog.findMany.mockResolvedValue(auditLogs)

      // Act
      const result = await auditService.getAuditLogs('tenant-123', {
        userId: 'user-123',
        action: 'user.login',
        limit: 50,
        offset: 0,
      })

      // Assert
      expect(result).toEqual({
        logs: expect.arrayContaining([
          expect.objectContaining({ action: 'user.login' }),
          expect.objectContaining({ action: 'user.logout' }),
        ]),
      })
      
      expect(mockDbOperations.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          action: { contains: 'user.login' },
        },
        take: 50,
        skip: 0,
        orderBy: { timestamp: 'desc' },
      })
    })

    it('should filter by date range', async () => {
      // Arrange
      const fromDate = new Date('2024-01-01')
      const toDate = new Date('2024-12-31')
      
      mockDbOperations.auditLog.findMany.mockResolvedValue([])

      // Act
      await auditService.getAuditLogs('tenant-123', {
        fromDate,
        toDate,
      })

      // Assert
      expect(mockDbOperations.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          timestamp: {
            gte: fromDate,
            lte: toDate,
          },
        },
        take: undefined,
        skip: undefined,
        orderBy: { timestamp: 'desc' },
      })
    })

    it('should filter by resource', async () => {
      // Arrange
      mockDbOperations.auditLog.findMany.mockResolvedValue([])

      // Act
      await auditService.getAuditLogs('tenant-123', {
        resource: 'organization',
        resourceId: 'org-123',
      })

      // Assert
      expect(mockDbOperations.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          resource: 'organization',
          resourceId: 'org-123',
        },
        take: undefined,
        skip: undefined,
        orderBy: { timestamp: 'desc' },
      })
    })
  })

  describe('getAuditStatistics', () => {
    it('should return audit statistics', async () => {
      // Arrange
      const statsData = [
        { action: 'user.login', _count: { action: 25 } },
        { action: 'user.logout', _count: { action: 20 } },
        { action: 'user.update.profile', _count: { action: 10 } },
      ]
      
      mockDbOperations.auditLog.groupBy.mockResolvedValue(statsData)
      mockDbOperations.auditLog.count.mockResolvedValue(55)

      // Act
      const result = await auditService.getAuditStatistics('tenant-123', {
        days: 30,
      })

      // Assert
      expect(result).toEqual({
        totalEvents: 55,
        actionCounts: expect.arrayContaining([
          { action: 'user.login', count: 25 },
          { action: 'user.logout', count: 20 },
          { action: 'user.update.profile', count: 10 },
        ]),
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      })
    })

    it('should filter statistics by user', async () => {
      // Arrange
      mockDbOperations.auditLog.groupBy.mockResolvedValue([])
      mockDbOperations.auditLog.count.mockResolvedValue(0)

      // Act
      await auditService.getAuditStatistics('tenant-123', {
        userId: 'user-123',
        days: 7,
      })

      // Assert
      expect(mockDbOperations.auditLog.groupBy).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          timestamp: {
            gte: expect.any(Date),
          },
        },
        by: ['action'],
        _count: { action: true },
      })
    })
  })

  describe('exportAuditLogs', () => {
    it('should export audit logs as CSV', async () => {
      // Arrange
      const auditLogs = [
        {
          timestamp: new Date('2024-01-01T10:00:00Z'),
          userId: 'user-123',
          action: 'user.login',
          resource: 'session',
          resourceId: 'session-123',
          ipAddress: '192.168.1.100',
          userAgent: 'Chrome/91.0',
        },
        {
          timestamp: new Date('2024-01-01T11:00:00Z'),
          userId: 'user-123',
          action: 'user.logout',
          resource: 'session',
          resourceId: 'session-123',
          ipAddress: '192.168.1.100',
          userAgent: 'Chrome/91.0',
        },
      ]
      
      mockDbOperations.auditLog.findMany.mockResolvedValue(auditLogs)

      // Act
      const result = await auditService.exportAuditLogs('tenant-123', {
        format: 'csv',
        fromDate: new Date('2024-01-01'),
        toDate: new Date('2024-01-31'),
      })

      // Assert
      expect(result).toEqual({
        format: 'csv',
        data: expect.stringContaining('timestamp,userId,action,resource'),
        filename: expect.stringMatching(/audit-logs-\d{4}-\d{2}-\d{2}\.csv/),
      })
      
      expect(result.data).toContain('user.login')
      expect(result.data).toContain('user.logout')
    })

    it('should export audit logs as JSON', async () => {
      // Arrange
      const auditLogs = [mockAuditLog]
      
      mockDbOperations.auditLog.findMany.mockResolvedValue(auditLogs)

      // Act
      const result = await auditService.exportAuditLogs('tenant-123', {
        format: 'json',
      })

      // Assert
      expect(result).toEqual({
        format: 'json',
        data: expect.any(String),
        filename: expect.stringMatching(/audit-logs-\d{4}-\d{2}-\d{2}\.json/),
      })
      
      const parsedData = JSON.parse(result.data)
      expect(parsedData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: mockAuditLog.action,
            resource: mockAuditLog.resource,
          }),
        ])
      )
    })

    it('should throw ValidationError for unsupported format', async () => {
      // Act & Assert
      await expect(auditService.exportAuditLogs('tenant-123', {
        format: 'xml' as any,
      })).rejects.toThrow(ValidationError)
    })
  })

  describe('deleteAuditLogs', () => {
    it('should delete audit logs older than specified days', async () => {
      // Arrange
      mockDbOperations.auditLog.deleteMany.mockResolvedValue({ count: 100 })

      // Act
      const result = await auditService.deleteAuditLogs('tenant-123', {
        olderThanDays: 90,
      })

      // Assert
      expect(result).toEqual({
        success: true,
        deletedCount: 100,
      })
      
      expect(mockDbOperations.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          timestamp: {
            lt: expect.any(Date),
          },
        },
      })
    })

    it('should delete audit logs by user', async () => {
      // Arrange
      mockDbOperations.auditLog.deleteMany.mockResolvedValue({ count: 25 })

      // Act
      const result = await auditService.deleteAuditLogs('tenant-123', {
        userId: 'user-123',
      })

      // Assert
      expect(result).toEqual({
        success: true,
        deletedCount: 25,
      })
      
      expect(mockDbOperations.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
        },
      })
    })
  })
})