import { Hono } from 'hono'
import { z } from 'zod'
import { TenantSettingsService } from '../services/tenant-settings.service'
import { TenantAdminService } from '../services/tenant-admin.service'
import { authMiddleware } from '../middleware/auth'
import { requireTenantAdmin } from '../middleware/tenant-admin.middleware'

const tenantSettingsRoutes = new Hono()
const tenantSettingsService = new TenantSettingsService()
const tenantAdminService = new TenantAdminService()

// Schema for updating tenant settings
const updateSettingsSchema = z.object({
  // Login methods
  emailPasswordEnabled: z.boolean().optional(),
  magicLinkEnabled: z.boolean().optional(),
  googleAuthEnabled: z.boolean().optional(),
  githubAuthEnabled: z.boolean().optional(),
  microsoftAuthEnabled: z.boolean().optional(),
  
  // MFA settings
  mfaRequired: z.boolean().optional(),
  mfaRequiredForAdmins: z.boolean().optional(),
  totpEnabled: z.boolean().optional(),
  webauthnEnabled: z.boolean().optional(),
  
  // Account activation
  requireActivation: z.boolean().optional(),
  requireMfaForActivation: z.boolean().optional(),
  
  // Password policy
  passwordMinLength: z.number().min(6).max(32).optional(),
  passwordRequireSpecial: z.boolean().optional(),
  passwordRequireNumber: z.boolean().optional(),
  passwordRequireUpper: z.boolean().optional(),
  
  // Session settings
  sessionTimeout: z.number().min(300).max(86400).optional(), // 5 min to 24 hours
  refreshTokenExpiry: z.number().min(86400).max(31536000).optional(), // 1 day to 1 year
})

// Get current tenant settings
tenantSettingsRoutes.get('/settings', authMiddleware, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const settings = await tenantSettingsService.getSettings(tenantId)
    
    return c.json({
      success: true,
      data: settings
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get settings'
    }, 500)
  }
})

// Update tenant settings (admin only)
tenantSettingsRoutes.put('/settings', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const body = await c.req.json()
    
    // Validate input
    const data = updateSettingsSchema.parse(body)
    
    // Update settings
    const settings = await tenantAdminService.updateTenantSettings(
      tenantId,
      userId,
      data
    )
    
    return c.json({
      success: true,
      data: settings
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({
        success: false,
        error: 'Invalid input',
        details: error.errors
      }, 400)
    }
    
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update settings'
    }, 500)
  }
})

// Get tenant statistics (admin only)
tenantSettingsRoutes.get('/stats', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    
    const stats = await tenantAdminService.getTenantStats(tenantId, userId)
    
    return c.json({
      success: true,
      data: stats
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get stats'
    }, 500)
  }
})

// List tenant admins
tenantSettingsRoutes.get('/admins', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const admins = await tenantAdminService.listAdmins(tenantId)
    
    return c.json({
      success: true,
      data: admins.map(admin => ({
        id: admin.id,
        email: admin.email,
        profile: admin.profile,
        createdAt: admin.createdAt
      }))
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list admins'
    }, 500)
  }
})

// Grant admin privileges
tenantSettingsRoutes.post('/admins/:userId', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const grantedBy = c.get('userId')
    const targetUserId = c.req.param('userId')
    
    const user = await tenantAdminService.grantAdminPrivileges(
      tenantId,
      targetUserId,
      grantedBy
    )
    
    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        isTenantAdmin: user.isTenantAdmin
      }
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to grant admin privileges'
    }, 500)
  }
})

// Revoke admin privileges
tenantSettingsRoutes.delete('/admins/:userId', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const revokedBy = c.get('userId')
    const targetUserId = c.req.param('userId')
    
    const user = await tenantAdminService.revokeAdminPrivileges(
      tenantId,
      targetUserId,
      revokedBy
    )
    
    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        isTenantAdmin: user.isTenantAdmin
      }
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke admin privileges'
    }, 500)
  }
})

// Enforce MFA for all users
tenantSettingsRoutes.post('/mfa/enforce', authMiddleware, requireTenantAdmin, async (c) => {
  try {
    const tenantId = c.get('tenantId')
    const adminId = c.get('userId')
    const body = await c.req.json()
    
    await tenantAdminService.enforceMfaForAllUsers(
      tenantId,
      adminId,
      body.adminsOnly || false
    )
    
    return c.json({
      success: true,
      message: 'MFA enforcement updated successfully'
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to enforce MFA'
    }, 500)
  }
})

export { tenantSettingsRoutes }