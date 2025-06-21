import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { compress } from 'hono/compress'
import { secureHeaders } from 'hono/secure-headers'
import { timing } from 'hono/timing'
import { prettyJSON } from 'hono/pretty-json'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { prometheus } from '@hono/prometheus'

// Import routes
import { authRoutes } from './routes/auth'
import { mfaRoutes } from './routes/mfa'
import { socialAuthRoutes } from './routes/social-auth'
import { userRoutes } from './routes/users'
import { orgRoutes } from './routes/organizations'
import { teamRoutes } from './routes/teams'
import { invitationRoutes } from './routes/invitations'
import { deviceRoutes } from './routes/devices'
import { sessionRoutes } from './routes/sessions'
import { auditRoutes } from './routes/audit'
import { adminRoutes } from './routes/admin'
import { healthRoutes } from './routes/health'
import { tenantSettingsRoutes } from './routes/tenant-settings.routes'
import { activationRoutes } from './routes/activation.routes'

// Import middleware
import { errorHandler } from './middleware/error'
import { tenantMiddleware } from './middleware/tenant'
import { requestIdMiddleware } from './middleware/request-id'
import { rateLimitMiddleware } from './middleware/rate-limit'

// Import utilities
import { getEnvVar, getEnvVarAsInt } from '@user-service/shared'
import { initializeServices } from './lib/init'

// Create app with OpenAPI support
const app = new OpenAPIHono()

// Prometheus metrics
const { printMetrics, registerMetrics } = prometheus()

// Global middleware (order matters!)
app.use('*', requestIdMiddleware)
app.use('*', logger())
app.use('*', timing())
app.use('*', registerMetrics)
app.use('*', secureHeaders())
app.use('*', compress())
app.use('*', prettyJSON())

// CORS configuration
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = getEnvVar('CORS_ORIGINS', 'http://localhost:3000').split(',')
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID'],
}))

// Metrics endpoint
app.get('/metrics', printMetrics)

// Health check routes (no tenant required)
app.route('/health', healthRoutes)

// API documentation
app.doc('/api/docs/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'User Service API',
    description: 'Multi-tenant authentication and user management service',
  },
  servers: [
    { 
      url: 'http://localhost:3000', 
      description: 'Development server' 
    },
    { 
      url: 'https://api.userservice.com', 
      description: 'Production server' 
    },
  ],
  tags: [
    { name: 'auth', description: 'Authentication endpoints' },
    { name: 'mfa', description: 'Multi-factor authentication' },
    { name: 'social-auth', description: 'Social authentication' },
    { name: 'users', description: 'User management' },
    { name: 'organizations', description: 'Organization management' },
    { name: 'admin', description: 'Admin operations' },
    { name: 'tenant', description: 'Tenant settings and configuration' },
  ],
})

// Swagger UI
app.get('/api/docs', swaggerUI({ url: '/api/docs/openapi.json' }))

// Apply tenant middleware for API routes
app.use('/api/*', tenantMiddleware)
app.use('/api/*', rateLimitMiddleware)

// Mount API routes
const api = app.basePath('/api/v1')
api.route('/auth', authRoutes)
api.route('/auth/mfa', mfaRoutes)
api.route('/auth/social', socialAuthRoutes)
api.route('/users', userRoutes)
api.route('/organizations', orgRoutes)
api.route('/teams', teamRoutes)
api.route('/invitations', invitationRoutes)
api.route('/devices', deviceRoutes)
api.route('/sessions', sessionRoutes)
api.route('/audit', auditRoutes)
api.route('/admin', adminRoutes)
api.route('/tenant', tenantSettingsRoutes)
api.route('/activation', activationRoutes)

// Error handling
app.onError(errorHandler)

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: c.get('requestId'),
    },
  }, 404)
})

// Initialize services on startup
await initializeServices()

// Export for Bun
const port = getEnvVarAsInt('PORT', 3000)

export default {
  port,
  fetch: app.fetch,
  hostname: '0.0.0.0', // Listen on all interfaces
}

console.log(`🚀 User Service API running on http://localhost:${port}`)
console.log(`📚 API Documentation: http://localhost:${port}/api/docs`)
console.log(`📊 Metrics: http://localhost:${port}/metrics`)

// Graceful shutdown
let isShuttingDown = false

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return
  
  console.log(`\n${signal} received, shutting down gracefully...`)
  isShuttingDown = true
  
  // Give ongoing requests 10 seconds to complete
  setTimeout(() => {
    console.log('Forcing shutdown...')
    process.exit(1)
  }, 10000)
  
  try {
    // Cleanup resources
    const { dbManager } = await import('@user-service/database')
    await dbManager.disconnectAll()
    
    console.log('Shutdown complete')
    process.exit(0)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))