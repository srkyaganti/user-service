import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { UserService } from '../../apps/api/src/services/user.service'
import { dbManager } from '@user-service/database'
import { EmailService } from '../../apps/api/src/services/email.service'
import { hashPassword, verifyPassword } from '../../apps/api/src/lib/crypto'
import { 
  ValidationError, 
  NotFoundError, 
  ForbiddenError 
} from '@user-service/shared'
import { mockDbOperations, mockEmailService, mockUser } from '../helpers/test-utils'
import fs from 'fs/promises'
import sharp from 'sharp'

// Mock dependencies
vi.mock('@user-service/database')
vi.mock('../../apps/api/src/services/email.service')
vi.mock('../../apps/api/src/lib/crypto')
vi.mock('fs/promises')
vi.mock('sharp')

describe('UserService', () => {
  let userService: UserService
  
  beforeEach(() => {
    userService = new UserService()
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any)
    vi.mocked(EmailService.getInstance).mockReturnValue(mockEmailService as any)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getProfile', () => {
    it('should successfully get user profile', async () => {
      // Arrange
      const userWithDetails = {
        ...mockUser,
        memberships: [
          {
            organization: { id: 'org-123', name: 'Test Org' },
            role: 'MEMBER',
          },
        ],
        mfaSettings: [
          { type: 'TOTP', enabled: true },
        ],
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithDetails)

      // Act
      const result = await userService.getProfile('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        profile: mockUser.profile,
        userType: mockUser.userType,
        emailVerified: mockUser.emailVerified,
        organizations: expect.arrayContaining([
          expect.objectContaining({
            id: 'org-123',
            name: 'Test Org',
            role: 'MEMBER',
          }),
        ]),
        mfaEnabled: true,
        createdAt: mockUser.createdAt,
      })
      
      expect(mockDbOperations.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        include: {
          memberships: { include: { organization: true } },
          mfaSettings: { where: { enabled: true } },
        },
      })
    })

    it('should throw NotFoundError for non-existent user', async () => {
      // Arrange
      mockDbOperations.user.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(userService.getProfile('tenant-123', 'non-existent'))
        .rejects.toThrow(NotFoundError)
    })
  })

  describe('updateProfile', () => {
    it('should successfully update user profile', async () => {
      // Arrange
      const updateData = {
        name: 'Updated Name',
        bio: 'Updated bio',
        location: 'Updated location',
        website: 'https://updated.com',
      }
      
      const updatedUser = {
        ...mockUser,
        profile: {
          ...mockUser.profile,
          ...updateData,
        },
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      mockDbOperations.user.update.mockResolvedValue(updatedUser)

      // Act
      const result = await userService.updateProfile(
        'tenant-123',
        'user-123',
        updateData
      )

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          profile: expect.objectContaining(updateData),
        })
      )
      
      expect(mockDbOperations.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          profile: expect.objectContaining(updateData),
        },
      })
    })

    it('should validate website URL format', async () => {
      // Arrange
      const invalidUpdateData = {
        website: 'invalid-url',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.updateProfile(
        'tenant-123',
        'user-123',
        invalidUpdateData
      )).rejects.toThrow(ValidationError)
      
      expect(mockDbOperations.user.update).not.toHaveBeenCalled()
    })

    it('should handle partial profile updates', async () => {
      // Arrange
      const partialUpdateData = {
        bio: 'Just updating bio',
      }
      
      const existingProfile = {
        name: 'Existing Name',
        location: 'Existing Location',
      }
      
      const userWithProfile = {
        ...mockUser,
        profile: existingProfile,
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithProfile)
      mockDbOperations.user.update.mockResolvedValue({
        ...userWithProfile,
        profile: {
          ...existingProfile,
          ...partialUpdateData,
        },
      })

      // Act
      const result = await userService.updateProfile(
        'tenant-123',
        'user-123',
        partialUpdateData
      )

      // Assert
      expect(mockDbOperations.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          profile: {
            ...existingProfile,
            ...partialUpdateData,
          },
        },
      })
    })
  })

  describe('changePassword', () => {
    it('should successfully change password', async () => {
      // Arrange
      const passwordData = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewPassword456!',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(verifyPassword).mockResolvedValue(true)
      vi.mocked(hashPassword).mockResolvedValue('new-hashed-password')
      mockDbOperations.user.update.mockResolvedValue({
        ...mockUser,
        passwordHash: 'new-hashed-password',
      })

      // Act
      const result = await userService.changePassword(
        'tenant-123',
        'user-123',
        passwordData
      )

      // Assert
      expect(result).toEqual({ success: true })
      
      expect(verifyPassword).toHaveBeenCalledWith(
        passwordData.currentPassword,
        mockUser.passwordHash
      )
      expect(hashPassword).toHaveBeenCalledWith(passwordData.newPassword)
      expect(mockDbOperations.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { passwordHash: 'new-hashed-password' },
      })
    })

    it('should throw ValidationError for incorrect current password', async () => {
      // Arrange
      const passwordData = {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPassword456!',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(verifyPassword).mockResolvedValue(false)

      // Act & Assert
      await expect(userService.changePassword(
        'tenant-123',
        'user-123',
        passwordData
      )).rejects.toThrow(ValidationError)
      
      expect(hashPassword).not.toHaveBeenCalled()
      expect(mockDbOperations.user.update).not.toHaveBeenCalled()
    })

    it('should throw ValidationError for weak new password', async () => {
      // Arrange
      const passwordData = {
        currentPassword: 'OldPassword123!',
        newPassword: '123', // Too weak
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.changePassword(
        'tenant-123',
        'user-123',
        passwordData
      )).rejects.toThrow(ValidationError)
    })
  })

  describe('uploadAvatar', () => {
    it('should successfully upload and process avatar', async () => {
      // Arrange
      const mockFile = {
        buffer: Buffer.from('fake-image-data'),
        mimetype: 'image/jpeg',
        size: 1024,
      }
      
      const processedBuffer = Buffer.from('processed-image-data')
      const avatarUrl = '/uploads/avatars/user-123.jpg'
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(sharp).mockReturnValue({
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(processedBuffer),
      } as any)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      mockDbOperations.user.update.mockResolvedValue({
        ...mockUser,
        profile: {
          ...mockUser.profile,
          avatarUrl,
        },
      })

      // Act
      const result = await userService.uploadAvatar(
        'tenant-123',
        'user-123',
        mockFile as any
      )

      // Assert
      expect(result).toEqual({
        avatarUrl,
      })
      
      expect(sharp).toHaveBeenCalledWith(mockFile.buffer)
      expect(fs.writeFile).toHaveBeenCalled()
      expect(mockDbOperations.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          profile: expect.objectContaining({
            avatarUrl,
          }),
        },
      })
    })

    it('should throw ValidationError for invalid file type', async () => {
      // Arrange
      const invalidFile = {
        buffer: Buffer.from('fake-data'),
        mimetype: 'text/plain',
        size: 1024,
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.uploadAvatar(
        'tenant-123',
        'user-123',
        invalidFile as any
      )).rejects.toThrow(ValidationError)
      
      expect(sharp).not.toHaveBeenCalled()
    })

    it('should throw ValidationError for file too large', async () => {
      // Arrange
      const largeFile = {
        buffer: Buffer.alloc(10 * 1024 * 1024), // 10MB
        mimetype: 'image/jpeg',
        size: 10 * 1024 * 1024,
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.uploadAvatar(
        'tenant-123',
        'user-123',
        largeFile as any
      )).rejects.toThrow(ValidationError)
    })
  })

  describe('deleteAvatar', () => {
    it('should successfully delete avatar', async () => {
      // Arrange
      const userWithAvatar = {
        ...mockUser,
        profile: {
          ...mockUser.profile,
          avatarUrl: '/uploads/avatars/user-123.jpg',
        },
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithAvatar)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      mockDbOperations.user.update.mockResolvedValue({
        ...userWithAvatar,
        profile: {
          ...userWithAvatar.profile,
          avatarUrl: null,
        },
      })

      // Act
      const result = await userService.deleteAvatar('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({ success: true })
      
      expect(fs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('user-123.jpg')
      )
      expect(mockDbOperations.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          profile: expect.objectContaining({
            avatarUrl: null,
          }),
        },
      })
    })

    it('should handle case when no avatar exists', async () => {
      // Arrange
      const userWithoutAvatar = {
        ...mockUser,
        profile: {
          ...mockUser.profile,
          avatarUrl: null,
        },
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(userWithoutAvatar)

      // Act
      const result = await userService.deleteAvatar('tenant-123', 'user-123')

      // Assert
      expect(result).toEqual({ success: true })
      expect(fs.unlink).not.toHaveBeenCalled()
    })
  })

  describe('searchUsers', () => {
    it('should successfully search users by query', async () => {
      // Arrange
      const searchQuery = 'john'
      const searchResults = [
        {
          id: 'user-1',
          email: 'john.doe@example.com',
          profile: { name: 'John Doe' },
        },
        {
          id: 'user-2',
          email: 'johnny@example.com',
          profile: { name: 'Johnny Smith' },
        },
      ]
      
      mockDbOperations.user.findMany.mockResolvedValue(searchResults)

      // Act
      const result = await userService.searchUsers(
        'tenant-123',
        searchQuery,
        { limit: 20, offset: 0 }
      )

      // Assert
      expect(result).toEqual({
        users: expect.arrayContaining([
          expect.objectContaining({ email: 'john.doe@example.com' }),
          expect.objectContaining({ email: 'johnny@example.com' }),
        ]),
      })
      
      expect(mockDbOperations.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { email: { contains: searchQuery, mode: 'insensitive' } },
            { profile: { path: ['name'], string_contains: searchQuery } },
          ],
        },
        select: expect.any(Object),
        take: 20,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      })
    })

    it('should handle empty search results', async () => {
      // Arrange
      mockDbOperations.user.findMany.mockResolvedValue([])

      // Act
      const result = await userService.searchUsers(
        'tenant-123',
        'nonexistent',
        { limit: 20, offset: 0 }
      )

      // Assert
      expect(result).toEqual({ users: [] })
    })

    it('should apply pagination correctly', async () => {
      // Arrange
      mockDbOperations.user.findMany.mockResolvedValue([])

      // Act
      await userService.searchUsers(
        'tenant-123',
        'test',
        { limit: 10, offset: 30 }
      )

      // Assert
      expect(mockDbOperations.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 30,
        })
      )
    })
  })

  describe('changeEmail', () => {
    it('should successfully initiate email change', async () => {
      // Arrange
      const newEmail = 'newemail@example.com'
      
      mockDbOperations.user.findUnique
        .mockResolvedValueOnce(mockUser) // Current user
        .mockResolvedValueOnce(null) // No existing user with new email
      
      // Act
      const result = await userService.changeEmail(
        'tenant-123',
        'user-123',
        newEmail
      )

      // Assert
      expect(result).toEqual({ 
        success: true,
        message: 'Verification email sent to new address',
      })
      
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        newEmail,
        expect.stringContaining('Email Change'),
        expect.any(String),
        expect.any(String)
      )
    })

    it('should throw ConflictError for email already in use', async () => {
      // Arrange
      const newEmail = 'existing@example.com'
      const existingUser = { id: 'other-user', email: newEmail }
      
      mockDbOperations.user.findUnique
        .mockResolvedValueOnce(mockUser) // Current user
        .mockResolvedValueOnce(existingUser) // Existing user with new email

      // Act & Assert
      await expect(userService.changeEmail(
        'tenant-123',
        'user-123',
        newEmail
      )).rejects.toThrow(ValidationError)
    })

    it('should throw ValidationError for same email', async () => {
      // Arrange
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.changeEmail(
        'tenant-123',
        'user-123',
        mockUser.email // Same email
      )).rejects.toThrow(ValidationError)
    })
  })

  describe('deleteAccount', () => {
    it('should successfully delete user account', async () => {
      // Arrange
      const passwordData = {
        password: 'CurrentPassword123!',
        confirmText: 'DELETE',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(verifyPassword).mockResolvedValue(true)
      mockDbOperations.user.delete.mockResolvedValue(mockUser)

      // Act
      const result = await userService.deleteAccount(
        'tenant-123',
        'user-123',
        passwordData
      )

      // Assert
      expect(result).toEqual({ success: true })
      
      expect(verifyPassword).toHaveBeenCalledWith(
        passwordData.password,
        mockUser.passwordHash
      )
      expect(mockDbOperations.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      })
    })

    it('should throw ValidationError for incorrect password', async () => {
      // Arrange
      const passwordData = {
        password: 'WrongPassword',
        confirmText: 'DELETE',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)
      vi.mocked(verifyPassword).mockResolvedValue(false)

      // Act & Assert
      await expect(userService.deleteAccount(
        'tenant-123',
        'user-123',
        passwordData
      )).rejects.toThrow(ValidationError)
      
      expect(mockDbOperations.user.delete).not.toHaveBeenCalled()
    })

    it('should throw ValidationError for incorrect confirmation text', async () => {
      // Arrange
      const passwordData = {
        password: 'CurrentPassword123!',
        confirmText: 'WRONG',
      }
      
      mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(userService.deleteAccount(
        'tenant-123',
        'user-123',
        passwordData
      )).rejects.toThrow(ValidationError)
      
      expect(mockDbOperations.user.delete).not.toHaveBeenCalled()
    })
  })
})