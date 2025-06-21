import { dbManager } from '@user-service/database'
import { 
  LoginDto, 
  RegisterDto, 
  AuthenticationError, 
  ValidationError,
  NotFoundError,
  CACHE_KEYS,
  EVENTS,
  TOKEN_EXPIRY,
  generateToken,
  getClientIp,
  getUserAgent,
} from '@user-service/shared'
import { CacheService } from './cache.service'
import { EventService } from './event.service'
import { TenantSettingsService } from './tenant-settings.service'
import { UserActivationService } from './user-activation.service'
import { generateTokens, verifyRefreshToken } from '../lib/jwt'
import { hashPassword, verifyPassword, generateSecureToken } from '../lib/crypto'
import { logger } from '../lib/logger'
import type { User, Organization } from '@user-service/database'

const cache = CacheService.getInstance()
const events = EventService.getInstance()
const tenantSettings = new TenantSettingsService()
const activationService = new UserActivationService()

export class AuthService {
  async login(tenantId: string, data: LoginDto & { ipAddress: string; userAgent: string }) {
    const db = await dbManager.getClient(tenantId)
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    // Check if email/password login is enabled
    const isEmailPasswordEnabled = await tenantSettings.isLoginMethodEnabled(tenantId, 'emailPassword')
    if (!isEmailPasswordEnabled) {
      throw new AuthenticationError('Email/password login is disabled for this tenant')
    }
    
    // Find user
    const user = await db.user.findUnique({
      where: { email: data.email },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
        mfaSettings: {
          where: { enabled: true },
        },
      },
    })
    
    if (!user) {
      throw new AuthenticationError('Invalid credentials')
    }
    
    // Check if user account is active
    if (!user.isActive) {
      throw new AuthenticationError('Account is not activated')
    }
    
    // Verify password
    if (!user.passwordHash) {
      throw new AuthenticationError('Password not set')
    }
    
    const isValidPassword = await verifyPassword(data.password, user.passwordHash)
    
    if (!isValidPassword) {
      // Log failed attempt
      await events.publish(EVENTS.USER_LOGGED_IN, {
        userId: user.id,
        success: false,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      })
      
      throw new AuthenticationError('Invalid credentials')
    }
    
    // Check if MFA is required based on tenant settings
    const isMfaRequired = await tenantSettings.isMfaRequired(tenantId, user.isTenantAdmin)
    const requiresMFA = user.mfaSettings.length > 0 || isMfaRequired
    
    if (requiresMFA) {
      // Generate MFA session token
      const mfaToken = generateSecureToken()
      await cache.set(
        `mfa:session:${mfaToken}`,
        { userId: user.id, tenantId },
        TOKEN_EXPIRY.VERIFICATION
      )
      
      return {
        requiresMFA: true,
        mfaToken,
        mfaMethods: user.mfaSettings.map(s => s.type),
      }
    }
    
    // Generate tokens and create session
    const tokens = await generateTokens({
      userId: user.id,
      email: user.email,
      tenantId,
      organizationId: user.memberships[0]?.organization.id,
    })
    
    // Handle device tracking
    let deviceId: string | undefined
    if (data.deviceFingerprint) {
      const device = await db.device.upsert({
        where: { fingerprint: data.deviceFingerprint },
        update: {
          lastIp: data.ipAddress,
          lastUsedAt: new Date(),
        },
        create: {
          userId: user.id,
          fingerprint: data.deviceFingerprint,
          name: 'Unknown Device',
          type: 'UNKNOWN',
          lastIp: data.ipAddress,
        },
      })
      deviceId = device.id
    }
    
    // Create session
    const session = await db.session.create({
      data: {
        userId: user.id,
        deviceId,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    })
    
    // Cache session
    await cache.set(
      CACHE_KEYS.SESSION(tokens.accessToken),
      {
        userId: user.id,
        tenantId,
        sessionId: session.id,
      },
      TOKEN_EXPIRY.ACCESS
    )
    
    // Publish event
    await events.publish(EVENTS.USER_LOGGED_IN, {
      userId: user.id,
      sessionId: session.id,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    })
    
    // Log activity
    await this.logActivity(db, {
      userId: user.id,
      action: 'user.login',
      resource: 'session',
      resourceId: session.id,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    })
    
    return {
      user: this.sanitizeUser(user),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: TOKEN_EXPIRY.ACCESS,
      },
      organizations: user.memberships.map(m => m.organization),
    }
  }
  
  async register(tenantId: string, data: RegisterDto & { ipAddress: string; userAgent: string }) {
    const db = await dbManager.getClient(tenantId)
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email: data.email },
    })
    
    if (existingUser) {
      throw new ValidationError('User with this email already exists')
    }
    
    // Process invitation if provided
    let organizationId = data.organizationId
    let role: 'MEMBER' | 'ADMIN' | 'OWNER' | 'GUEST' = 'MEMBER'
    
    if (data.invitationToken) {
      const invitation = await db.invitation.findUnique({
        where: { token: data.invitationToken },
      })
      
      if (!invitation || invitation.expiresAt < new Date()) {
        throw new ValidationError('Invalid or expired invitation')
      }
      
      if (invitation.email !== data.email) {
        throw new ValidationError('Invitation email does not match')
      }
      
      organizationId = invitation.orgId
      role = invitation.role
      
      // Mark invitation as accepted
      await db.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      })
    }
    
    // Validate organization requirement
    if (tenant.config.auth?.requireOrganization && !organizationId) {
      throw new ValidationError('Organization membership required')
    }
    
    // Validate password against tenant policy
    const passwordValidation = await tenantSettings.validatePassword(tenantId, data.password)
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.errors.join(', '))
    }
    
    // Hash password
    const passwordHash = await hashPassword(data.password)
    
    // Check if this is the first user (will be admin)
    const userCount = await db.user.count()
    const isFirstUser = userCount === 0
    
    // Check if activation is required
    const requiresActivation = await tenantSettings.isActivationRequired(tenantId)
    
    // Create user in database
    const user = await db.user.create({
      data: {
        email: data.email,
        passwordHash,
        profile: data.profile || {},
        userType: organizationId ? 'ORGANIZATIONAL' : 'INDIVIDUAL',
        isTenantAdmin: isFirstUser,
        isActive: !requiresActivation,
        activatedAt: !requiresActivation ? new Date() : null,
        memberships: organizationId ? {
          create: {
            organizationId,
            role,
          },
        } : undefined,
      },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    })
    
    // Initialize system roles if this is the first user
    if (isFirstUser) {
      await tenantSettings.initializeSystemRoles(tenantId)
    }
    
    // Assign default role
    await tenantSettings.assignDefaultRole(tenantId, user.id, isFirstUser)
    
    // Send activation email if required
    if (requiresActivation) {
      await activationService.sendActivationEmail(tenantId, user.id, user.email)
      
      // Publish event
      await events.publish(EVENTS.USER_CREATED, {
        userId: user.id,
        email: user.email,
        organizationId,
        requiresActivation: true,
      })
      
      return {
        user: this.sanitizeUser(user),
        requiresActivation: true,
        message: 'Account created. Please check your email to activate your account.',
        organizations: user.memberships.map(m => m.organization),
      }
    }
    
    // Generate tokens only if activation is not required
    const tokens = await generateTokens({
      userId: user.id,
      email: user.email,
      tenantId,
      organizationId: user.memberships[0]?.organization.id,
    })
    
    // Create session
    const session = await db.session.create({
      data: {
        userId: user.id,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    
    // Publish event
    await events.publish(EVENTS.USER_CREATED, {
      userId: user.id,
      email: user.email,
      organizationId,
    })
    
    // Log activity
    await this.logActivity(db, {
      userId: user.id,
      action: 'user.register',
      resource: 'user',
      resourceId: user.id,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    })
    
    return {
      user: this.sanitizeUser(user),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: TOKEN_EXPIRY.ACCESS,
      },
      organizations: user.memberships.map(m => m.organization),
    }
  }
  
  async logout(userId: string, sessionId: string) {
    const db = await dbManager.getClient('') // Get from session context
    
    // Delete session
    await db.session.delete({
      where: { id: sessionId },
    })
    
    // Clear cache
    const session = await db.session.findUnique({
      where: { id: sessionId },
    })
    
    if (session) {
      await cache.delete(CACHE_KEYS.SESSION(session.token))
    }
    
    // Publish event
    await events.publish(EVENTS.USER_LOGGED_OUT, {
      userId,
      sessionId,
    })
  }
  
  async refreshToken(refreshToken: string) {
    try {
      const { sub: userId, sessionId } = await verifyRefreshToken(refreshToken)
      
      // Get session from database
      const db = await dbManager.getClient('') // Get from token context
      const session = await db.session.findUnique({
        where: { refreshToken },
        include: {
          user: {
            include: {
              memberships: {
                include: {
                  organization: true,
                },
              },
            },
          },
        },
      })
      
      if (!session || session.expiresAt < new Date()) {
        throw new AuthenticationError('Invalid or expired session')
      }
      
      // Generate new tokens
      const tokens = await generateTokens({
        userId: session.user.id,
        email: session.user.email,
        tenantId: '', // Get from context
        organizationId: session.user.memberships[0]?.organization.id,
      })
      
      // Update session
      await db.session.update({
        where: { id: session.id },
        data: {
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          lastActivity: new Date(),
        },
      })
      
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: TOKEN_EXPIRY.ACCESS,
      }
    } catch (error) {
      throw new AuthenticationError('Invalid refresh token')
    }
  }
  
  private sanitizeUser(user: User & { memberships?: any[] }) {
    return {
      id: user.id,
      email: user.email,
      profile: user.profile,
      userType: user.userType,
      createdAt: user.createdAt,
    }
  }
  
  private async logActivity(db: any, data: {
    userId: string
    action: string
    resource: string
    resourceId?: string
    ipAddress: string
    userAgent: string
  }) {
    await db.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    })
  }
}

export const authService = new AuthService()