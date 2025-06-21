import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { MFAService } from '../../apps/api/src/services/mfa.service'
import { dbManager } from '@user-service/database'
import { CacheService } from '../../apps/api/src/services/cache.service'
import { ValidationError, NotFoundError } from '@user-service/shared'
import { mockDbOperations, mockCache, mockUser } from '../helpers/test-utils'
import QRCode from 'qrcode'
import { TOTP } from 'otpauth'

// Mock dependencies
vi.mock('@user-service/database')
vi.mock('../../apps/api/src/services/cache.service')
vi.mock('qrcode')
vi.mock('otpauth')
vi.mock('@simplewebauthn/server')

describe('MFAService', () => {
  let mfaService: MFAService
  
  const mockTenant = {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
  }

  const mockMFASetting = {
    id: 'mfa-123',
    userId: 'user-123',
    type: 'TOTP',
    secret: 'JBSWY3DPEHPK3PXP',
    enabled: true,
    backupCodes: ['123456', '234567', '345678'],
    createdAt: new Date(),
  }

  beforeEach(() => {
    mfaService = new MFAService()
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any)
    vi.mocked(dbManager.getTenant).mockResolvedValue(mockTenant as any)
    vi.mocked(CacheService.getInstance).mockReturnValue(mockCache as any)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('setupTOTP', () => {
    it('should successfully setup TOTP for user', async () => {
      // Arrange
      const secret = 'JBSWY3DPEHPK3PXP'
      const qrCodeUrl = 'data:image/png;base64,iVBOR...'
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(QRCode.toDataURL).mockResolvedValue(qrCodeUrl)
      
      // Mock TOTP secret generation
      const mockTOTPInstance = {
        secret: { base32: secret },
        toString: () => 'otpauth://totp/Test%20Service:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Test%20Service',
      }
      vi.mocked(TOTP).mockImplementation(() => mockTOTPInstance as any)

      // Act
      const result = await mfaService.setupTOTP('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        setupToken: expect.any(String),
        secret,
        qrCode: qrCodeUrl,
        backupCodes: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ]),
      })
      
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('totp:setup:'),
        expect.objectContaining({
          userId: 'user-123',
          secret,
          backupCodes: expect.any(Array),
        }),
        expect.any(Number)
      )
      expect(QRCode.toDataURL).toHaveBeenCalled()
    })

    it('should throw NotFoundError for non-existent user', async () => {
      // Arrange
      mockDbOperations.user.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(mfaService.setupTOTP('tenant-123', 'non-existent-user'))
        .rejects.toThrow(NotFoundError)
    })

    it('should throw ValidationError if TOTP already enabled', async () => {
      // Arrange
      const userWithTOTP = {
        ...mockUser,
        mfaSettings: [{ type: 'TOTP', enabled: true }],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithTOTP)

      // Act & Assert
      await expect(mfaService.setupTOTP('tenant-123', 'user-123'))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('verifyTOTPSetup', () => {
    it('should successfully verify TOTP setup', async () => {
      // Arrange
      const setupToken = 'setup-token-123'
      const code = '123456'
      
      const setupData = {
        userId: 'user-123',
        secret: 'JBSWY3DPEHPK3PXP',
        backupCodes: ['backup1', 'backup2'],
      }
      
      mockCache.get.mockResolvedValue(setupData)
      mockDbOperations.mfaSetting = {
        create: vi.fn().mockResolvedValue(mockMFASetting),
      }
      
      // Mock TOTP validation
      const mockTOTPInstance = {
        validate: vi.fn().mockReturnValue(0), // Valid token
      }
      vi.mocked(TOTP).mockImplementation(() => mockTOTPInstance as any)

      // Act
      const result = await mfaService.verifyTOTPSetup('tenant-123', setupToken, code)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockTOTPInstance.validate).toHaveBeenCalledWith({
        token: code,
        window: 2,
      })
      expect(mockDbOperations.mfaSetting.create).toHaveBeenCalledWith({
        data: {
          userId: setupData.userId,
          type: 'TOTP',
          secret: setupData.secret,
          enabled: true,
          backupCodes: setupData.backupCodes,
        },
      })
      expect(mockCache.del).toHaveBeenCalledWith(`totp:setup:${setupToken}`)
    })

    it('should throw ValidationError for invalid setup token', async () => {
      // Arrange
      mockCache.get.mockResolvedValue(null)

      // Act & Assert
      await expect(mfaService.verifyTOTPSetup('tenant-123', 'invalid-token', '123456'))
        .rejects.toThrow(ValidationError)
    })

    it('should throw ValidationError for invalid TOTP code', async () => {
      // Arrange
      const setupToken = 'setup-token-123'
      const code = 'invalid'
      
      const setupData = {
        userId: 'user-123',
        secret: 'JBSWY3DPEHPK3PXP',
        backupCodes: ['backup1', 'backup2'],
      }
      
      mockCache.get.mockResolvedValue(setupData)
      
      // Mock TOTP validation failure
      const mockTOTPInstance = {
        validate: vi.fn().mockReturnValue(null), // Invalid token
      }
      vi.mocked(TOTP).mockImplementation(() => mockTOTPInstance as any)

      // Act & Assert
      await expect(mfaService.verifyTOTPSetup('tenant-123', setupToken, code))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('verifyTOTP', () => {
    it('should successfully verify TOTP code', async () => {
      // Arrange
      const code = '123456'
      
      const userWithTOTP = {
        ...mockUser,
        mfaSettings: [mockMFASetting],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithTOTP)
      
      // Mock TOTP validation
      const mockTOTPInstance = {
        validate: vi.fn().mockReturnValue(0), // Valid token
      }
      vi.mocked(TOTP).mockImplementation(() => mockTOTPInstance as any)

      // Act
      const result = await mfaService.verifyTOTP('tenant-123', 'user-123', code)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockTOTPInstance.validate).toHaveBeenCalledWith({
        token: code,
        window: 2,
      })
    })

    it('should successfully verify backup code', async () => {
      // Arrange
      const backupCode = '123456'
      
      const userWithTOTP = {
        ...mockUser,
        mfaSettings: [{
          ...mockMFASetting,
          backupCodes: [backupCode, '234567'],
        }],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithTOTP)
      mockDbOperations.mfaSetting.update = vi.fn().mockResolvedValue(mockMFASetting)

      // Act
      const result = await mfaService.verifyTOTP('tenant-123', 'user-123', backupCode)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockDbOperations.mfaSetting.update).toHaveBeenCalledWith({
        where: { id: mockMFASetting.id },
        data: {
          backupCodes: ['234567'], // Backup code removed
        },
      })
    })

    it('should throw NotFoundError for user without TOTP', async () => {
      // Arrange
      const userWithoutTOTP = {
        ...mockUser,
        mfaSettings: [],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithoutTOTP)

      // Act & Assert
      await expect(mfaService.verifyTOTP('tenant-123', 'user-123', '123456'))
        .rejects.toThrow(NotFoundError)
    })

    it('should throw ValidationError for invalid TOTP code', async () => {
      // Arrange
      const code = 'invalid'
      
      const userWithTOTP = {
        ...mockUser,
        mfaSettings: [mockMFASetting],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithTOTP)
      
      // Mock TOTP validation failure
      const mockTOTPInstance = {
        validate: vi.fn().mockReturnValue(null), // Invalid token
      }
      vi.mocked(TOTP).mockImplementation(() => mockTOTPInstance as any)

      // Act & Assert
      await expect(mfaService.verifyTOTP('tenant-123', 'user-123', code))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('setupWebAuthn', () => {
    it('should successfully setup WebAuthn for user', async () => {
      // Arrange
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      
      // Mock SimpleWebAuthn
      const mockGenerateRegistrationOptions = vi.fn().mockReturnValue({
        challenge: 'challenge-123',
        rp: { name: 'Test Service' },
        user: { id: 'user-123', name: 'test@example.com' },
        pubKeyCredParams: [],
        timeout: 60000,
        attestation: 'none',
      })
      
      vi.doMock('@simplewebauthn/server', () => ({
        generateRegistrationOptions: mockGenerateRegistrationOptions,
      }))

      // Re-import to get mocked version
      const { generateRegistrationOptions } = await import('@simplewebauthn/server')

      // Act
      const result = await mfaService.setupWebAuthn('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        options: expect.objectContaining({
          challenge: 'challenge-123',
        }),
      })
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('webauthn:challenge:'),
        expect.any(String),
        expect.any(Number)
      )
    })
  })

  describe('verifyWebAuthnSetup', () => {
    it('should successfully verify WebAuthn setup', async () => {
      // Arrange
      const credential = {
        id: 'credential-123',
        rawId: 'credential-123',
        response: {
          attestationObject: 'attestation-object',
          clientDataJSON: 'client-data-json',
        },
        type: 'public-key',
      }
      
      mockCache.get.mockResolvedValue('challenge-123')
      mockDbOperations.mfaSetting = {
        create: vi.fn().mockResolvedValue({
          id: 'mfa-456',
          type: 'WEBAUTHN',
          credentialId: 'credential-123',
        }),
      }
      
      // Mock SimpleWebAuthn verification
      const mockVerifyRegistrationResponse = vi.fn().mockResolvedValue({
        verified: true,
        registrationInfo: {
          credentialID: new Uint8Array([1, 2, 3]),
          credentialPublicKey: new Uint8Array([4, 5, 6]),
          counter: 0,
        },
      })
      
      vi.doMock('@simplewebauthn/server', () => ({
        verifyRegistrationResponse: mockVerifyRegistrationResponse,
      }))

      // Re-import to get mocked version
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server')

      // Act
      const result = await mfaService.verifyWebAuthnSetup('tenant-123', 'user-123', credential)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockDbOperations.mfaSetting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          type: 'WEBAUTHN',
          enabled: true,
        }),
      })
    })

    it('should throw ValidationError for failed WebAuthn verification', async () => {
      // Arrange
      const credential = {
        id: 'credential-123',
        rawId: 'credential-123',
        response: {
          attestationObject: 'attestation-object',
          clientDataJSON: 'client-data-json',
        },
        type: 'public-key',
      }
      
      mockCache.get.mockResolvedValue('challenge-123')
      
      // Mock SimpleWebAuthn verification failure
      const mockVerifyRegistrationResponse = vi.fn().mockResolvedValue({
        verified: false,
      })
      
      vi.doMock('@simplewebauthn/server', () => ({
        verifyRegistrationResponse: mockVerifyRegistrationResponse,
      }))

      // Act & Assert
      await expect(mfaService.verifyWebAuthnSetup('tenant-123', 'user-123', credential))
        .rejects.toThrow(ValidationError)
    })
  })

  describe('listMFAMethods', () => {
    it('should return user MFA methods', async () => {
      // Arrange
      const userWithMFA = {
        ...mockUser,
        mfaSettings: [
          { type: 'TOTP', enabled: true, createdAt: new Date() },
          { type: 'WEBAUTHN', enabled: true, createdAt: new Date() },
        ],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithMFA)

      // Act
      const result = await mfaService.listMFAMethods('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        methods: expect.arrayContaining([
          expect.objectContaining({ type: 'TOTP', enabled: true }),
          expect.objectContaining({ type: 'WEBAUTHN', enabled: true }),
        ]),
      })
    })

    it('should return empty array for user without MFA', async () => {
      // Arrange
      const userWithoutMFA = {
        ...mockUser,
        mfaSettings: [],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithoutMFA)

      // Act
      const result = await mfaService.listMFAMethods('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({ methods: [] })
    })
  })

  describe('disableMFA', () => {
    it('should successfully disable MFA method', async () => {
      // Arrange
      const mfaId = 'mfa-123'
      
      mockDbOperations.mfaSetting = {
        findFirst: vi.fn().mockResolvedValue(mockMFASetting),
        delete: vi.fn().mockResolvedValue(mockMFASetting),
      }

      // Act
      const result = await mfaService.disableMFA('tenant-123', 'user-123', mfaId)

      // Assert
      expect(result).toEqual({ success: true })
      expect(mockDbOperations.mfaSetting.delete).toHaveBeenCalledWith({
        where: { id: mfaId },
      })
    })

    it('should throw NotFoundError for non-existent MFA setting', async () => {
      // Arrange
      mockDbOperations.mfaSetting = {
        findFirst: vi.fn().mockResolvedValue(null),
      }

      // Act & Assert
      await expect(mfaService.disableMFA('tenant-123', 'user-123', 'non-existent'))
        .rejects.toThrow(NotFoundError)
    })
  })

  describe('generateBackupCodes', () => {
    it('should generate new backup codes', async () => {
      // Arrange
      const userWithTOTP = {
        ...mockUser,
        mfaSettings: [mockMFASetting],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithTOTP)
      mockDbOperations.mfaSetting.update = vi.fn().mockResolvedValue({
        ...mockMFASetting,
        backupCodes: ['new1', 'new2', 'new3'],
      })

      // Act
      const result = await mfaService.generateBackupCodes('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        backupCodes: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ]),
      })
      expect(mockDbOperations.mfaSetting.update).toHaveBeenCalledWith({
        where: { id: mockMFASetting.id },
        data: {
          backupCodes: expect.any(Array),
        },
      })
    })

    it('should throw NotFoundError for user without MFA', async () => {
      // Arrange
      const userWithoutMFA = {
        ...mockUser,
        mfaSettings: [],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithoutMFA)

      // Act & Assert
      await expect(mfaService.generateBackupCodes('tenant-123', 'user-123'))
        .rejects.toThrow(NotFoundError)
    })
  })
})