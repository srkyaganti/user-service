import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { MagicLinkService, magicLinkService } from '../../apps/api/src/services/magic-link.service'
import { dbManager } from '@user-service/database'
import { CacheService } from '../../apps/api/src/services/cache.service'
import { EmailService } from '../../apps/api/src/services/email.service'
import { generateTokens } from '../../apps/api/src/lib/jwt'
import { generateSecureToken } from '../../apps/api/src/lib/crypto'
import { 
  ValidationError, 
  NotFoundError,
  AuthenticationError 
} from '@user-service/shared'
import { mockDbOperations, mockCache, mockEmailService, mockUser } from '../helpers/test-utils'

// Mock dependencies
vi.mock('@user-service/database')
vi.mock('../../apps/api/src/services/cache.service')
vi.mock('../../apps/api/src/services/email.service')
vi.mock('../../apps/api/src/lib/jwt')
vi.mock('../../apps/api/src/lib/crypto')

describe('MagicLinkService', () => {
  let service: MagicLinkService
  
  const mockTenant = {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
    config: {
      auth: {
        requireInvitation: false,
        allowedMethods: ['magic-link'],
      },
    },
  }

  beforeEach(() => {
    service = new MagicLinkService()
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any)
    vi.mocked(dbManager.getTenant).mockResolvedValue(mockTenant as any)
    vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any)
    vi.mocked(EmailService.getInstance).mockReturnValue(mockEmailService as any)
    vi.mocked(generateSecureToken).mockReturnValue('secure-token-123')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('sendMagicLink', () => {
    it('should successfully send magic link for existing user', async () => {
      // Arrange
      const email = 'test@example.com'
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act
      const result = await service.sendMagicLink('tenant-123', email)

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Magic link sent to your email',
      })
      
      expect(mockCache.set).toHaveBeenCalledWith(
        'magic-link:secure-token-123',
        expect.objectContaining({
          userId: mockUser.id,
          email,
          tenantId: 'tenant-123',
        }),
        expect.any(Number)
      )
      
      expect(mockEmailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        email,
        expect.stringContaining('secure-token-123'),
        mockTenant.name
      )
    })

    it('should create new user and send magic link when registration is allowed', async () => {
      // Arrange
      const email = 'newuser@example.com'
      const newUser = {
        id: 'new-user-123',
        email,
        userType: 'INDIVIDUAL',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(null) // No existing user
      mockDbOperations.user.create.mockResolvedValue(newUser)

      // Act
      const result = await service.sendMagicLink('tenant-123', email)

      // Assert
      expect(result).toEqual({
        success: true,
        message: 'Magic link sent to your email',
      })
      
      expect(mockDbOperations.user.create).toHaveBeenCalledWith({
        data: {
          email,
          userType: 'INDIVIDUAL',
        },
      })
      
      expect(mockCache.set).toHaveBeenCalledWith(
        'magic-link:secure-token-123',
        expect.objectContaining({
          userId: newUser.id,
          email,
          tenantId: 'tenant-123',
        }),
        expect.any(Number)
      )
    })

    it('should throw ValidationError when registration requires invitation', async () => {
      // Arrange
      const email = 'newuser@example.com'
      const tenantWithInvitationRequired = {
        ...mockTenant,
        config: {
          auth: {
            requireInvitation: true,
          },
        },
      }
      
      vi.mocked(dbManager.getTenant).mockResolvedValue(tenantWithInvitationRequired as any)
      mockDbOperations.user.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(service.sendMagicLink('tenant-123', email))
        .rejects.toThrow(ValidationError)
      
      expect(mockDbOperations.user.create).not.toHaveBeenCalled()
      expect(mockEmailService.sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('should throw NotFoundError for invalid tenant', async () => {
      // Arrange
      vi.mocked(dbManager.getTenant).mockResolvedValue(null)

      // Act & Assert
      await expect(service.sendMagicLink('invalid-tenant', 'test@example.com'))
        .rejects.toThrow(NotFoundError)
    })

    it('should validate email format', async () => {
      // Act & Assert
      await expect(service.sendMagicLink('tenant-123', 'invalid-email'))
        .rejects.toThrow(ValidationError)
    })

    it('should handle rate limiting', async () => {
      // Arrange
      const email = 'test@example.com'
      
      mockCache.get.mockResolvedValue({ attempts: 5 }) // Too many attempts
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(service.sendMagicLink('tenant-123', email))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('verifyMagicLink', () => {
    it('should successfully verify magic link and login user', async () => {
      // Arrange
      const token = 'secure-token-123'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() + 900000), // 15 minutes from now
      }
      
      const userWithMemberships = {
        ...mockUser,
        memberships: [
          {
            organization: { id: 'org-123', name: 'Test Org' },
            role: 'MEMBER',
          },
        ],
      }
      
      mockCache.get.mockResolvedValue(tokenData)
      mockDbOperations.user.findUnique.mockResolvedValue(userWithMemberships)
      vi.mocked(generateTokens).mockResolvedValue({
        accessToken: 'jwt-access-token',
        refreshToken: 'jwt-refresh-token',
      })
      mockDbOperations.session.create.mockResolvedValue({
        id: 'session-123',
        token: 'jwt-access-token',
      })

      // Act
      const result = await service.verifyMagicLink('tenant-123', token, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      })

      // Assert
      expect(result).toEqual({
        user: expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
        }),
        tokens: {
          accessToken: 'jwt-access-token',
          refreshToken: 'jwt-refresh-token',
          expiresIn: expect.any(Number),
        },
        organizations: expect.arrayContaining([
          expect.objectContaining({
            id: 'org-123',
            name: 'Test Org',
            role: 'MEMBER',
          }),
        ]),
      })
      
      expect(mockCache.del).toHaveBeenCalledWith(`magic-link:${token}`)
      expect(mockDbOperations.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: tokenData.userId,
          token: 'jwt-access-token',
          refreshToken: 'jwt-refresh-token',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        }),
      })
    })

    it('should throw AuthenticationError for invalid token', async () => {
      // Arrange
      mockCache.get.mockResolvedValue(null)

      // Act & Assert
      await expect(service.verifyMagicLink('tenant-123', 'invalid-token', {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      })).rejects.toThrow(AuthenticationError)
    })

    it('should throw AuthenticationError for expired token', async () => {
      // Arrange
      const token = 'expired-token-123'
      const expiredTokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() - 900000), // 15 minutes ago
      }
      
      mockCache.get.mockResolvedValue(expiredTokenData)

      // Act & Assert
      await expect(service.verifyMagicLink('tenant-123', token, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      })).rejects.toThrow(AuthenticationError)
      
      expect(mockCache.del).toHaveBeenCalledWith(`magic-link:${token}`)
    })

    it('should throw NotFoundError for non-existent user', async () => {
      // Arrange
      const token = 'valid-token-123'
      const tokenData = {
        userId: 'non-existent-user',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() + 900000),
      }
      
      mockCache.get.mockResolvedValue(tokenData)
      mockDbOperations.user.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(service.verifyMagicLink('tenant-123', token, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      })).rejects.toThrow(NotFoundError)
    })

    it('should handle tenant mismatch', async () => {
      // Arrange
      const token = 'valid-token-123'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'other-tenant-123', // Different tenant
        expiresAt: new Date(Date.now() + 900000),
      }
      
      mockCache.get.mockResolvedValue(tokenData)

      // Act & Assert
      await expect(service.verifyMagicLink('tenant-123', token, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      })).rejects.toThrow(AuthenticationError)
    })
  })

  describe('getMagicLinkStatus', () => {
    it('should return valid status for valid token', async () => {
      // Arrange
      const token = 'valid-token-123'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() + 900000),
      }
      
      mockCache.get.mockResolvedValue(tokenData)

      // Act
      const result = await service.getMagicLinkStatus('tenant-123', token)

      // Assert
      expect(result).toEqual({
        valid: true,
        email: tokenData.email,
        expiresAt: tokenData.expiresAt,
      })
    })

    it('should return invalid status for non-existent token', async () => {
      // Arrange
      mockCache.get.mockResolvedValue(null)

      // Act
      const result = await service.getMagicLinkStatus('tenant-123', 'invalid-token')

      // Assert
      expect(result).toEqual({
        valid: false,
        reason: 'Token not found or expired',
      })
    })

    it('should return invalid status for expired token', async () => {
      // Arrange
      const token = 'expired-token-123'
      const expiredTokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() - 900000),
      }
      
      mockCache.get.mockResolvedValue(expiredTokenData)

      // Act
      const result = await service.getMagicLinkStatus('tenant-123', token)

      // Assert
      expect(result).toEqual({
        valid: false,
        reason: 'Token expired',
      })
    })

    it('should return invalid status for tenant mismatch', async () => {
      // Arrange
      const token = 'valid-token-123'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'other-tenant-123',
        expiresAt: new Date(Date.now() + 900000),
      }
      
      mockCache.get.mockResolvedValue(tokenData)

      // Act
      const result = await service.getMagicLinkStatus('tenant-123', token)

      // Assert
      expect(result).toEqual({
        valid: false,
        reason: 'Invalid tenant',
      })
    })
  })

  describe('revokeMagicLink', () => {
    it('should successfully revoke magic link', async () => {
      // Arrange
      const token = 'token-to-revoke'
      const tokenData = {
        userId: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        expiresAt: new Date(Date.now() + 900000),
      }
      
      mockCache.get.mockResolvedValue(tokenData)

      // Act
      const result = await service.revokeMagicLink('tenant-123', token)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockCache.del).toHaveBeenCalledWith(`magic-link:${token}`)
    })

    it('should return success even for non-existent token', async () => {
      // Arrange
      mockCache.get.mockResolvedValue(null)

      // Act
      const result = await service.revokeMagicLink('tenant-123', 'non-existent-token')

      // Assert
      expect(result).toEqual({ success: true })
    })
  })

  describe('listActiveMagicLinks', () => {
    it('should return active magic links for user', async () => {
      // Arrange
      const activeTokens = [
        {
          token: 'token-1',
          email: 'test@example.com',
          createdAt: new Date(Date.now() - 300000), // 5 minutes ago
          expiresAt: new Date(Date.now() + 600000), // 10 minutes from now
        },
        {
          token: 'token-2',
          email: 'test@example.com',
          createdAt: new Date(Date.now() - 60000), // 1 minute ago
          expiresAt: new Date(Date.now() + 840000), // 14 minutes from now
        },
      ]
      
      // Mock cache pattern search (simplified)
      mockCache.get.mockImplementation((key: string) => {
        if (key.includes('token-1')) {
          return Promise.resolve({
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-123',
            expiresAt: activeTokens[0].expiresAt,
            createdAt: activeTokens[0].createdAt,
          })
        }
        if (key.includes('token-2')) {
          return Promise.resolve({
            userId: 'user-123',
            email: 'test@example.com',
            tenantId: 'tenant-123',
            expiresAt: activeTokens[1].expiresAt,
            createdAt: activeTokens[1].createdAt,
          })
        }
        return Promise.resolve(null)
      })

      // Mock Redis pattern scan (in real implementation)
      const mockPatternScan = vi.fn().mockResolvedValue(['magic-link:token-1', 'magic-link:token-2'])
      mockCache.scan = mockPatternScan

      // Act
      const result = await service.listActiveMagicLinks('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        links: expect.arrayContaining([
          expect.objectContaining({
            token: expect.stringContaining('token-'),
            email: 'test@example.com',
            expiresAt: expect.any(Date),
          }),
        ]),
      })
    })

    it('should return empty array when no active magic links exist', async () => {
      // Arrange
      const mockPatternScan = vi.fn().mockResolvedValue([])
      mockCache.scan = mockPatternScan

      // Act
      const result = await service.listActiveMagicLinks('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({ links: [] })
    })
  })

  describe('revokeAllMagicLinks', () => {
    it('should successfully revoke all magic links for user', async () => {
      // Arrange
      const activeTokenKeys = ['magic-link:token-1', 'magic-link:token-2']
      
      const mockPatternScan = vi.fn().mockResolvedValue(activeTokenKeys)
      mockCache.scan = mockPatternScan
      
      mockCache.get.mockImplementation((key: string) => {
        return Promise.resolve({
          userId: 'user-123',
          email: 'test@example.com',
          tenantId: 'tenant-123',
          expiresAt: new Date(Date.now() + 900000),
        })
      })

      // Act
      const result = await service.revokeAllMagicLinks('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        success: true,
        revokedCount: 2,
      })
      
      expect(mockCache.del).toHaveBeenCalledTimes(2)
      expect(mockCache.del).toHaveBeenCalledWith('magic-link:token-1')
      expect(mockCache.del).toHaveBeenCalledWith('magic-link:token-2')
    })

    it('should return zero count when no magic links exist', async () => {
      // Arrange
      const mockPatternScan = vi.fn().mockResolvedValue([])
      mockCache.scan = mockPatternScan

      // Act
      const result = await service.revokeAllMagicLinks('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        success: true,
        revokedCount: 0,
      })
    })
  })
})