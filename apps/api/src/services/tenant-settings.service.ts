import { getDbClient } from '../lib/database'
import type { TenantSettings, Prisma } from '@repo/database'
import { CacheService } from './cache.service'

export class TenantSettingsService {
  private cacheService: CacheService

  constructor() {
    this.cacheService = new CacheService()
  }

  /**
   * Get tenant settings with caching
   */
  async getSettings(tenantId: string): Promise<TenantSettings> {
    const cacheKey = `tenant:${tenantId}:settings`
    
    // Try cache first
    const cached = await this.cacheService.get<TenantSettings>(cacheKey)
    if (cached) {
      return cached
    }

    const db = await getDbClient(tenantId)
    
    // Get settings or create default if not exists
    let settings = await db.tenantSettings.findUnique({
      where: { id: 'default' }
    })

    if (!settings) {
      settings = await db.tenantSettings.create({
        data: { id: 'default' }
      })
    }

    // Cache for 1 hour
    await this.cacheService.set(cacheKey, settings, 3600)

    return settings
  }

  /**
   * Update tenant settings
   */
  async updateSettings(
    tenantId: string,
    data: Partial<Omit<TenantSettings, 'id' | 'updatedAt'>>
  ): Promise<TenantSettings> {
    const db = await getDbClient(tenantId)

    const settings = await db.tenantSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: {
        id: 'default',
        ...data
      }
    })

    // Invalidate cache
    const cacheKey = `tenant:${tenantId}:settings`
    await this.cacheService.delete(cacheKey)

    return settings
  }

  /**
   * Check if a login method is enabled
   */
  async isLoginMethodEnabled(
    tenantId: string,
    method: 'emailPassword' | 'magicLink' | 'google' | 'github' | 'microsoft'
  ): Promise<boolean> {
    const settings = await this.getSettings(tenantId)
    
    switch (method) {
      case 'emailPassword':
        return settings.emailPasswordEnabled
      case 'magicLink':
        return settings.magicLinkEnabled
      case 'google':
        return settings.googleAuthEnabled
      case 'github':
        return settings.githubAuthEnabled
      case 'microsoft':
        return settings.microsoftAuthEnabled
      default:
        return false
    }
  }

  /**
   * Check if MFA is required for a user type
   */
  async isMfaRequired(tenantId: string, isAdmin: boolean): Promise<boolean> {
    const settings = await this.getSettings(tenantId)
    
    if (isAdmin && settings.mfaRequiredForAdmins) {
      return true
    }
    
    return settings.mfaRequired
  }

  /**
   * Check if account activation is required
   */
  async isActivationRequired(tenantId: string): Promise<boolean> {
    const settings = await this.getSettings(tenantId)
    return settings.requireActivation
  }

  /**
   * Validate password against tenant policy
   */
  async validatePassword(tenantId: string, password: string): Promise<{ valid: boolean; errors: string[] }> {
    const settings = await this.getSettings(tenantId)
    const errors: string[] = []

    if (password.length < settings.passwordMinLength) {
      errors.push(`Password must be at least ${settings.passwordMinLength} characters long`)
    }

    if (settings.passwordRequireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character')
    }

    if (settings.passwordRequireNumber && !/\d/.test(password)) {
      errors.push('Password must contain at least one number')
    }

    if (settings.passwordRequireUpper && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Initialize default system roles for B2B use cases
   */
  async initializeSystemRoles(tenantId: string): Promise<void> {
    const db = await getDbClient(tenantId)

    const systemRoles = [
      {
        name: 'super_admin',
        displayName: 'Super Administrator',
        description: 'Full system access including tenant management',
        permissions: ['*'],
        isSystem: true
      },
      {
        name: 'admin',
        displayName: 'Administrator',
        description: 'Administrative access to most features',
        permissions: [
          'users.view', 'users.create', 'users.update', 'users.delete',
          'organizations.view', 'organizations.create', 'organizations.update',
          'teams.view', 'teams.create', 'teams.update', 'teams.delete',
          'settings.view', 'settings.update',
          'audit.view'
        ],
        isSystem: true
      },
      {
        name: 'manager',
        displayName: 'Manager',
        description: 'Can manage users and teams within their organization',
        permissions: [
          'users.view', 'users.create', 'users.update',
          'teams.view', 'teams.create', 'teams.update',
          'organizations.view'
        ],
        isSystem: true
      },
      {
        name: 'member',
        displayName: 'Member',
        description: 'Basic user with read access',
        permissions: [
          'users.view.self',
          'organizations.view',
          'teams.view'
        ],
        isSystem: true
      }
    ]

    // Create roles if they don't exist
    for (const role of systemRoles) {
      await db.role.upsert({
        where: { name: role.name },
        create: role,
        update: {} // Don't update system roles
      })
    }
  }

  /**
   * Assign default role to new user based on tenant settings
   */
  async assignDefaultRole(tenantId: string, userId: string, isFirstUser: boolean = false): Promise<void> {
    const db = await getDbClient(tenantId)

    // First user gets admin role, others get member role
    const roleName = isFirstUser ? 'admin' : 'member'
    
    const role = await db.role.findUnique({
      where: { name: roleName }
    })

    if (role) {
      await db.userRole.create({
        data: {
          userId,
          roleId: role.id
        }
      }).catch(() => {
        // Ignore if already exists
      })
    }
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(tenantId: string, userId: string, permission: string): Promise<boolean> {
    const db = await getDbClient(tenantId)

    const userRoles = await db.userRole.findMany({
      where: { userId },
      include: { role: true }
    })

    for (const userRole of userRoles) {
      // Super admin has all permissions
      if (userRole.role.permissions.includes('*')) {
        return true
      }

      // Check specific permission
      if (userRole.role.permissions.includes(permission)) {
        return true
      }

      // Check wildcard permissions (e.g., users.* matches users.view)
      const permissionParts = permission.split('.')
      for (let i = 1; i <= permissionParts.length; i++) {
        const wildcardPermission = permissionParts.slice(0, i).join('.') + '.*'
        if (userRole.role.permissions.includes(wildcardPermission)) {
          return true
        }
      }
    }

    return false
  }
}