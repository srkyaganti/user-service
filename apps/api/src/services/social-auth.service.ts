import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  NotFoundError,
  CACHE_KEYS,
  TOKEN_EXPIRY,
  getEnvVar,
} from '@user-service/shared'
import { CacheService } from './cache.service'
import { generateTokens } from '../lib/jwt'
import { generateSecureToken } from '../lib/crypto'
import { logger } from '../lib/logger'
import jwt from 'jsonwebtoken'

const cache = CacheService.getInstance()

export interface SocialProvider {
  name: string
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  redirectUri?: string
}

export class SocialAuthService {
  private providers: Map<string, SocialProvider> = new Map()
  
  constructor() {
    this.initializeProviders()
  }
  
  private initializeProviders() {
    // Google OAuth
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      this.providers.set('google', {
        name: 'google',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scope: 'openid email profile',
      })
    }
    
    // GitHub OAuth
    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      this.providers.set('github', {
        name: 'github',
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scope: 'read:user user:email',
      })
    }
    
    // Microsoft OAuth
    if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
      this.providers.set('microsoft', {
        name: 'microsoft',
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
        scope: 'openid email profile',
      })
    }
  }
  
  async getAuthorizationUrl(
    provider: string,
    tenantId: string,
    redirectUri: string
  ): Promise<{ url: string; state: string }> {
    const providerConfig = this.providers.get(provider)
    
    if (!providerConfig) {
      throw new ValidationError(`Provider ${provider} is not configured`)
    }
    
    // Check if social login is enabled for tenant
    const tenant = await dbManager.getTenant({ id: tenantId })
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    const authMethods = tenant.config.auth?.allowedMethods || []
    if (!authMethods.includes(`social-${provider}`)) {
      throw new ValidationError(`${provider} authentication is not enabled`)
    }
    
    // Generate state token
    const state = generateSecureToken(32)
    
    // Store state in cache with tenant and redirect info
    await cache.set(
      `oauth:state:${state}`,
      {
        provider,
        tenantId,
        redirectUri,
      },
      600 // 10 minutes
    )
    
    // Build authorization URL
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: providerConfig.scope,
      state,
    })
    
    // Provider-specific parameters
    if (provider === 'google') {
      params.append('access_type', 'offline')
      params.append('prompt', 'consent')
    }
    
    return {
      url: `${providerConfig.authorizationUrl}?${params.toString()}`,
      state,
    }
  }
  
  async handleCallback(
    provider: string,
    code: string,
    state: string,
    ipAddress: string,
    userAgent: string
  ) {
    // Verify state
    const stateData = await cache.get(`oauth:state:${state}`)
    
    if (!stateData || stateData.provider !== provider) {
      throw new ValidationError('Invalid state parameter')
    }
    
    const { tenantId, redirectUri } = stateData
    
    // Clear state token
    await cache.delete(`oauth:state:${state}`)
    
    const providerConfig = this.providers.get(provider)
    if (!providerConfig) {
      throw new ValidationError(`Provider ${provider} is not configured`)
    }
    
    // Exchange code for tokens
    const tokenResponse = await this.exchangeCodeForToken(
      providerConfig,
      code,
      redirectUri
    )
    
    // Get user info from provider
    const userInfo = await this.getUserInfo(
      providerConfig,
      tokenResponse.access_token
    )
    
    // Find or create user
    const db = await dbManager.getClient(tenantId)
    
    // Look for existing social auth
    let socialAuth = await db.socialAuth.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId: userInfo.id,
        },
      },
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
    
    let user
    
    if (socialAuth) {
      // Existing user
      user = socialAuth.user
      
      // Update tokens
      await db.socialAuth.update({
        where: { id: socialAuth.id },
        data: {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt: tokenResponse.expires_in
            ? new Date(Date.now() + tokenResponse.expires_in * 1000)
            : null,
        },
      })
    } else {
      // Check if user exists with same email
      user = await db.user.findUnique({
        where: { email: userInfo.email },
        include: {
          memberships: {
            include: {
              organization: true,
            },
          },
        },
      })
      
      if (user) {
        // Link social auth to existing user
        await db.socialAuth.create({
          data: {
            userId: user.id,
            provider,
            providerId: userInfo.id,
            email: userInfo.email,
            profile: userInfo,
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token,
            expiresAt: tokenResponse.expires_in
              ? new Date(Date.now() + tokenResponse.expires_in * 1000)
              : null,
          },
        })
      } else {
        // Create new user
        const tenant = await dbManager.getTenant({ id: tenantId })
        
        if (tenant?.config.auth?.requireInvitation) {
          throw new ValidationError('Registration requires invitation')
        }
        
        // Create Keycloak user
        const keycloakUser = await this.createKeycloakUser(
          tenant!.keycloakRealm!,
          userInfo.email,
          userInfo.name
        )
        
        // Create user with social auth
        user = await db.user.create({
          data: {
            keycloakId: keycloakUser.id,
            email: userInfo.email,
            userType: 'INDIVIDUAL',
            profile: {
              name: userInfo.name,
              avatarUrl: userInfo.picture || userInfo.avatar_url,
              emailVerified: true,
              emailVerifiedAt: new Date(),
            },
            socialAuths: {
              create: {
                provider,
                providerId: userInfo.id,
                email: userInfo.email,
                profile: userInfo,
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token,
                expiresAt: tokenResponse.expires_in
                  ? new Date(Date.now() + tokenResponse.expires_in * 1000)
                  : null,
              },
            },
          },
          include: {
            memberships: {
              include: {
                organization: true,
              },
            },
          },
        })
      }
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
    
    // Log successful login
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: `social_login.${provider}`,
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
  
  private async exchangeCodeForToken(
    provider: SocialProvider,
    code: string,
    redirectUri: string
  ) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
    })
    
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    })
    
    if (!response.ok) {
      throw new ValidationError('Failed to exchange authorization code')
    }
    
    return response.json()
  }
  
  private async getUserInfo(provider: SocialProvider, accessToken: string) {
    const response = await fetch(provider.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new ValidationError('Failed to fetch user information')
    }
    
    const data = await response.json()
    
    // Normalize user info across providers
    switch (provider.name) {
      case 'google':
        return {
          id: data.id,
          email: data.email,
          name: data.name,
          picture: data.picture,
        }
      
      case 'github':
        // GitHub might need additional email fetch
        if (!data.email) {
          const emailResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          })
          
          if (emailResponse.ok) {
            const emails = await emailResponse.json()
            const primaryEmail = emails.find((e: any) => e.primary)
            data.email = primaryEmail?.email || emails[0]?.email
          }
        }
        
        return {
          id: data.id.toString(),
          email: data.email,
          name: data.name || data.login,
          avatar_url: data.avatar_url,
        }
      
      case 'microsoft':
        return {
          id: data.id,
          email: data.mail || data.userPrincipalName,
          name: data.displayName,
        }
      
      default:
        return data
    }
  }
  
  async unlinkProvider(userId: string, provider: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    // Check if user has other auth methods
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        socialAuths: true,
      },
    })
    
    if (!user) {
      throw new NotFoundError('User')
    }
    
    // Don't allow unlinking if it's the only auth method
    const hasPassword = !!user.passwordHash
    const otherSocialAuths = user.socialAuths.filter(sa => sa.provider !== provider)
    
    if (!hasPassword && otherSocialAuths.length === 0) {
      throw new ValidationError('Cannot remove the only authentication method')
    }
    
    // Delete social auth
    await db.socialAuth.deleteMany({
      where: {
        userId,
        provider,
      },
    })
    
    // Log action
    await db.auditLog.create({
      data: {
        userId,
        action: `social_auth.unlinked`,
        resource: 'social_auth',
        metadata: { provider },
        ipAddress: '0.0.0.0', // Would come from request context
        userAgent: 'Unknown',
      },
    })
    
    return { success: true }
  }
  
  async getLinkedProviders(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const socialAuths = await db.socialAuth.findMany({
      where: { userId },
      select: {
        provider: true,
        email: true,
        createdAt: true,
      },
    })
    
    return socialAuths
  }
  
  private async createKeycloakUser(realm: string, email: string, name?: string) {
    // This would integrate with Keycloak service
    // For now, return mock data
    return {
      id: `keycloak-${generateSecureToken(16)}`,
    }
  }
}

export const socialAuthService = new SocialAuthService()