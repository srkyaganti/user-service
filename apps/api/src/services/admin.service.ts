import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  generateSlug,
  encrypt,
  decrypt,
} from '@user-service/shared'
import { logger } from '../lib/logger'
import type { TenantStatus } from '@user-service/database'

export interface CreateTenantDto {
  name: string
  slug?: string
  config?: {
    auth?: {
      allowedMethods?: string[]
      requireInvitation?: boolean
      requireEmailVerification?: boolean
    }
    features?: {
      organizations?: boolean
      teams?: boolean
      mfa?: boolean
      deviceTracking?: boolean
      auditLogs?: boolean
    }
    limits?: {
      maxUsers?: number
      maxOrganizations?: number
      maxTeamsPerOrg?: number
    }
  }
}

export interface UpdateTenantDto {
  name?: string
  status?: TenantStatus
  config?: Record<string, any>
}

export interface TenantStats {
  userCount: number
  organizationCount: number
  sessionCount: number
  storageUsed: number
  lastActivity?: Date
}

export class AdminService {
  async createTenant(data: CreateTenantDto) {
    // Generate slug if not provided
    const slug = data.slug || generateSlug(data.name)
    
    // Check if slug already exists
    const existingTenant = await dbManager.getTenant({ slug })
    if (existingTenant) {
      throw new ConflictError('Tenant slug already exists')
    }
    
    // Create database for tenant
    const dbConfig = await this.createTenantDatabase(slug)
    
    // Create tenant record
    const tenant = await dbManager.createTenant({
      name: data.name,
      slug,
      config: data.config || this.getDefaultConfig(),
      dbHost: dbConfig.host,
      dbName: dbConfig.database,
      dbUser: dbConfig.user,
      dbPassword: await encrypt(dbConfig.password),
    })
    
    // Initialize tenant database schema
    await this.initializeTenantSchema(tenant.id)
    
    logger.info({ tenantId: tenant.id, slug }, 'Tenant created')
    
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      config: tenant.config,
      createdAt: tenant.createdAt,
    }
  }
  
  async listTenants(filters?: {
    status?: TenantStatus
    search?: string
    limit?: number
    offset?: number
  }) {
    const tenants = await dbManager.listTenants({
      status: filters?.status,
      search: filters?.search,
      limit: filters?.limit || 20,
      offset: filters?.offset || 0,
    })
    
    // Get stats for each tenant
    const tenantsWithStats = await Promise.all(
      tenants.map(async (tenant) => {
        const stats = await this.getTenantStats(tenant.id).catch(() => null)
        return {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          config: tenant.config,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          stats,
        }
      })
    )
    
    return tenantsWithStats
  }
  
  async getTenant(tenantId: string) {
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    const stats = await this.getTenantStats(tenantId)
    
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      config: tenant.config,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      stats,
    }
  }
  
  async updateTenant(tenantId: string, data: UpdateTenantDto) {
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    // Update tenant
    const updatedTenant = await dbManager.updateTenant(tenantId, {
      name: data.name,
      status: data.status,
      config: data.config ? {
        ...tenant.config as any,
        ...data.config,
      } : undefined,
    })
    
    logger.info({ tenantId, changes: data }, 'Tenant updated')
    
    return {
      id: updatedTenant.id,
      name: updatedTenant.name,
      slug: updatedTenant.slug,
      status: updatedTenant.status,
      config: updatedTenant.config,
      updatedAt: updatedTenant.updatedAt,
    }
  }
  
  async suspendTenant(tenantId: string, reason?: string) {
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    if (tenant.status === 'SUSPENDED') {
      throw new ValidationError('Tenant is already suspended')
    }
    
    // Update status
    await dbManager.updateTenant(tenantId, {
      status: 'SUSPENDED',
      config: {
        ...tenant.config as any,
        suspension: {
          reason,
          suspendedAt: new Date(),
        },
      },
    })
    
    
    logger.warn({ tenantId, reason }, 'Tenant suspended')
    
    return { success: true }
  }
  
  async reactivateTenant(tenantId: string) {
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    if (tenant.status !== 'SUSPENDED') {
      throw new ValidationError('Tenant is not suspended')
    }
    
    // Update status
    await dbManager.updateTenant(tenantId, {
      status: 'ACTIVE',
      config: {
        ...tenant.config as any,
        suspension: null,
      },
    })
    
    
    logger.info({ tenantId }, 'Tenant reactivated')
    
    return { success: true }
  }
  
  async deleteTenant(tenantId: string) {
    const tenant = await dbManager.getTenant({ id: tenantId })
    
    if (!tenant) {
      throw new NotFoundError('Tenant')
    }
    
    // Archive tenant instead of hard delete
    await dbManager.updateTenant(tenantId, {
      status: 'ARCHIVED',
      config: {
        ...tenant.config as any,
        archived: {
          archivedAt: new Date(),
        },
      },
    })
    
    // TODO: Archive database
    
    logger.warn({ tenantId }, 'Tenant archived')
    
    return { success: true }
  }
  
  private async getTenantStats(tenantId: string): Promise<TenantStats> {
    try {
      const db = await dbManager.getClient(tenantId)
      
      const [
        userCount,
        organizationCount,
        sessionCount,
        lastActivity,
      ] = await Promise.all([
        db.user.count(),
        db.organization.count(),
        db.session.count({
          where: { expiresAt: { gt: new Date() } },
        }),
        db.auditLog.findFirst({
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        }),
      ])
      
      return {
        userCount,
        organizationCount,
        sessionCount,
        storageUsed: 0, // TODO: Calculate actual storage
        lastActivity: lastActivity?.timestamp,
      }
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to get tenant stats')
      return {
        userCount: 0,
        organizationCount: 0,
        sessionCount: 0,
        storageUsed: 0,
      }
    }
  }
  
  private getDefaultConfig() {
    return {
      auth: {
        allowedMethods: ['email', 'magic-link'],
        requireInvitation: false,
        requireEmailVerification: true,
      },
      features: {
        organizations: true,
        teams: true,
        mfa: true,
        deviceTracking: true,
        auditLogs: true,
      },
      limits: {
        maxUsers: 1000,
        maxOrganizations: 100,
        maxTeamsPerOrg: 50,
      },
    }
  }
  
  private async createTenantDatabase(slug: string) {
    // This would create an actual database
    // For now, return mock config
    return {
      host: process.env.DB_HOST || 'localhost',
      database: `tenant_${slug}`,
      user: `tenant_${slug}`,
      password: generateSlug(32),
    }
  }
  
  
  private async initializeTenantSchema(tenantId: string) {
    // This would run Prisma migrations on tenant database
    logger.info({ tenantId }, 'Initializing tenant schema')
  }
  
  // System stats
  async getSystemStats() {
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      recentSignups,
    ] = await Promise.all([
      dbManager.countTenants(),
      dbManager.countTenants({ status: 'ACTIVE' }),
      dbManager.countTenants({ status: 'SUSPENDED' }),
      dbManager.listTenants({
        limit: 5,
        orderBy: 'createdAt',
        order: 'desc',
      }),
    ])
    
    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
      },
      recentSignups: recentSignups.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
      })),
    }
  }
}

export const adminService = new AdminService()