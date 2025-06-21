import { Context, Next } from 'hono'
import { ForbiddenError } from '@user-service/shared'
import { logger } from '../lib/logger'

// Admin middleware to check if user has admin privileges
export async function adminMiddleware(c: Context, next: Next) {
  try {
    // Get user from context (set by auth middleware)
    const user = c.get('user')
    
    if (!user) {
      throw new ForbiddenError('Authentication required')
    }
    
    // Check if user is admin
    // In a real implementation, this would check against a database or JWT claims
    // For now, we'll check if the user has a specific admin flag or email domain
    const isAdmin = checkIfUserIsAdmin(user)
    
    if (!isAdmin) {
      throw new ForbiddenError('Admin access required')
    }
    
    // Add admin flag to context
    c.set('isAdmin', true)
    
    await next()
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: error.message,
        },
      }, 403)
    }
    
    throw error
  }
}

function checkIfUserIsAdmin(user: any): boolean {
  // Check various admin indicators
  
  // 1. Check if user has admin role in their profile
  if (user.profile?.role === 'admin' || user.profile?.isAdmin === true) {
    return true
  }
  
  // 2. Check if user email is in admin domain
  const adminDomains = (process.env.ADMIN_EMAIL_DOMAINS || '').split(',').filter(Boolean)
  if (adminDomains.length > 0) {
    const userDomain = user.email.split('@')[1]
    if (adminDomains.includes(userDomain)) {
      return true
    }
  }
  
  // 3. Check if user email is in admin list
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean)
  if (adminEmails.includes(user.email)) {
    return true
  }
  
  // 4. Check if user has special admin tenant ID
  const adminTenantId = process.env.ADMIN_TENANT_ID
  if (adminTenantId && user.tenantId === adminTenantId) {
    return true
  }
  
  return false
}