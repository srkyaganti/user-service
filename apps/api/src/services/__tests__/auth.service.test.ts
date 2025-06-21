import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { AuthService } from '../auth.service'
import { AuthenticationError, ValidationError } from '@user-service/shared'

// Mock dependencies
const mockDb = {
  user: {
    findUnique: mock(() => null),
    create: mock(() => ({ id: 'user-123', email: 'test@example.com' })),
  },
  session: {
    create: mock(() => ({ id: 'session-123', token: 'token-123' })),
  },
  invitation: {
    findUnique: mock(() => null),
  },
}

const mockKeycloak = {
  verifyUserCredentials: mock(() => true),
  createUser: mock(() => ({ id: 'keycloak-123' })),
  sendVerificationEmail: mock(() => Promise.resolve()),
}

const mockDbManager = {
  getClient: mock(() => mockDb),
  getTenant: mock(() => ({ 
    id: 'tenant-123',
    keycloakRealm: 'tenant-123-realm',
    config: { auth: { requireOrganization: false } },
  })),
}

// Patch imports
mock.module('@user-service/database', () => ({
  dbManager: mockDbManager,
}))

mock.module('../keycloak.service', () => ({
  KeycloakService: {
    getInstance: () => mockKeycloak,
  },
}))

describe('AuthService', () => {
  let authService: AuthService
  
  beforeEach(() => {
    authService = new AuthService()
    // Reset mocks
    mockDb.user.findUnique.mockClear()
    mockDb.user.create.mockClear()
    mockKeycloak.verifyUserCredentials.mockClear()
  })
  
  describe('login', () => {
    it('should authenticate valid user', async () => {
      // Arrange
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      }
      
      mockDb.user.findUnique.mockReturnValueOnce({
        id: 'user-123',
        email: 'test@example.com',
        memberships: [],
        mfaSettings: [],
      })
      
      // Act
      const result = await authService.login('tenant-123', loginData)
      
      // Assert
      expect(result).toHaveProperty('user')
      expect(result).toHaveProperty('tokens')
      expect(result.user.email).toBe('test@example.com')
      expect(mockKeycloak.verifyUserCredentials).toHaveBeenCalledWith(
        'tenant-123-realm',
        'test@example.com',
        'password123'
      )
    })
    
    it('should reject invalid credentials', async () => {
      // Arrange
      mockDb.user.findUnique.mockReturnValueOnce(null)
      
      // Act & Assert
      expect(async () => {
        await authService.login('tenant-123', {
          email: 'invalid@example.com',
          password: 'wrong',
          ipAddress: '127.0.0.1',
          userAgent: 'Test Agent',
        })
      }).toThrow(AuthenticationError)
    })
    
    it('should require MFA when enabled', async () => {
      // Arrange
      mockDb.user.findUnique.mockReturnValueOnce({
        id: 'user-123',
        email: 'test@example.com',
        memberships: [],
        mfaSettings: [{ type: 'TOTP', enabled: true }],
      })
      
      // Act
      const result = await authService.login('tenant-123', {
        email: 'test@example.com',
        password: 'password123',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      })
      
      // Assert
      expect(result).toHaveProperty('requiresMFA', true)
      expect(result).toHaveProperty('mfaToken')
      expect(result).toHaveProperty('mfaMethods', ['TOTP'])
    })
  })
  
  describe('register', () => {
    it('should create new user', async () => {
      // Arrange
      const registerData = {
        email: 'new@example.com',
        password: 'SecurePass123!',
        profile: {
          firstName: 'Test',
          lastName: 'User',
        },
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      }
      
      mockDb.user.findUnique.mockReturnValueOnce(null)
      
      // Act
      const result = await authService.register('tenant-123', registerData)
      
      // Assert
      expect(result).toHaveProperty('user')
      expect(result).toHaveProperty('tokens')
      expect(result.user.email).toBe('new@example.com')
      expect(mockKeycloak.createUser).toHaveBeenCalled()
      expect(mockKeycloak.sendVerificationEmail).toHaveBeenCalled()
    })
    
    it('should reject duplicate email', async () => {
      // Arrange
      mockDb.user.findUnique.mockReturnValueOnce({
        id: 'existing-user',
        email: 'existing@example.com',
      })
      
      // Act & Assert
      expect(async () => {
        await authService.register('tenant-123', {
          email: 'existing@example.com',
          password: 'password123',
          ipAddress: '127.0.0.1',
          userAgent: 'Test Agent',
        })
      }).toThrow(ValidationError)
    })
  })
})