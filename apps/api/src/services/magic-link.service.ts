import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  NotFoundError,
  CACHE_KEYS,
  TOKEN_EXPIRY,
  generateToken,
  getClientIp,
  getUserAgent,
} from '@user-service/shared'
import { CacheService } from './cache.service'
import { EmailService } from './email.service'
import { generateTokens } from '../lib/jwt'
import { generateSecureToken } from '../lib/crypto'
import { logger } from '../lib/logger'

const cache = CacheService.getInstance()
const emailService = EmailService.getInstance()

export class MagicLinkService {
  async sendMagicLink(email: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    // Check if magic link is enabled
    const authMethods = tenant.config.auth?.allowedMethods || []
    if (!authMethods.includes('magic-link')) {
      throw new ValidationError('Magic link authentication is not enabled')
    }
    
    // Find or create user
    let user = await db.user.findUnique({
      where: { email },
    })
    
    if (!user) {
      // Check if registration is allowed
      if (tenant.config.auth?.requireInvitation) {
        throw new ValidationError('Registration requires invitation')
      }
      
      // Create user without password
      user = await db.user.create({
        data: {
          email,
          userType: 'INDIVIDUAL',
        },
      })
    }
    
    // Generate magic link token
    const token = generateSecureToken(32)
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY.VERIFICATION * 1000)
    
    // Store token in cache
    await cache.set(
      `magic-link:${token}`,
      {
        userId: user.id,
        email,
        tenantId,
        expiresAt,
      },
      TOKEN_EXPIRY.VERIFICATION
    )
    
    // Send email
    await emailService.sendMagicLinkEmail(email, {
      token,
      expiresIn: '24 hours',
      loginUrl: `${process.env.APP_URL}/auth/magic-link?token=${token}`,
    })
    
    // Log attempt
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'magic_link.requested',
        resource: 'auth',
        ipAddress: '0.0.0.0', // Would come from request context
        userAgent: 'Unknown',
      },
    })
    
    return {
      success: true,
      message: 'Magic link sent to your email',
    }
  }
  
  async verifyMagicLink(
    token: string,
    ipAddress: string,
    userAgent: string,
    tenantId: string
  ) {
    // Get token data from cache
    const tokenData = await cache.get(`magic-link:${token}`)
    
    if (!tokenData) {
      throw new ValidationError('Invalid or expired magic link')
    }
    
    if (tokenData.tenantId !== tenantId) {
      throw new ValidationError('Invalid magic link')
    }
    
    if (new Date(tokenData.expiresAt) < new Date()) {
      throw new ValidationError('Magic link has expired')
    }
    
    const db = await dbManager.getClient(tenantId)
    
    // Get user
    const user = await db.user.findUnique({
      where: { id: tokenData.userId },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    })
    
    if (!user) {
      throw new NotFoundError('User')
    }
    
    // Mark email as verified if not already
    if (!user.profile?.emailVerified) {
      await db.user.update({
        where: { id: user.id },
        data: {
          profile: {
            ...user.profile,
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        },
      })
    }
    
    // Generate tokens and create session
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
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
    
    // Delete used token
    await cache.delete(`magic-link:${token}`)
    
    // Log successful login
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'magic_link.verified',
        resource: 'auth',
        resourceId: session.id,
        ipAddress,
        userAgent,
      },
    })
    
    return {
      user: {
        id: user.id,
        email: user.email,
        profile: user.profile,
        userType: user.userType,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: TOKEN_EXPIRY.ACCESS,
      },
      organizations: user.memberships.map(m => m.organization),
    }
  }
  
}

export const magicLinkService = new MagicLinkService()