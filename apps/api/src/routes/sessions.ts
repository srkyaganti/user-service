import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { sessionService } from '../services/session.service'
import { authMiddleware } from '../middleware/auth'

const app = new OpenAPIHono()

// List sessions
const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['sessions'],
  middleware: authMiddleware,
  request: {
    query: z.object({
      deviceId: z.string().optional(),
      active: z.coerce.boolean().optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of sessions',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              sessions: z.array(z.object({
                id: z.string(),
                device: z.object({
                  id: z.string(),
                  name: z.string(),
                  type: z.string(),
                  platform: z.string().nullable(),
                  browser: z.string().nullable(),
                }).nullable(),
                ipAddress: z.string(),
                userAgent: z.string(),
                createdAt: z.string(),
                lastActivity: z.string(),
                expiresAt: z.string(),
                isActive: z.boolean(),
                isCurrent: z.boolean(),
              })),
              pagination: z.object({
                total: z.number(),
                limit: z.number(),
                offset: z.number(),
                hasMore: z.boolean(),
              }),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(listSessionsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const query = c.req.valid('query')
  
  const result = await sessionService.listSessions(
    user.id,
    tenantId,
    query
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Get session details
const getSessionRoute = createRoute({
  method: 'get',
  path: '/:sessionId',
  tags: ['sessions'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Session details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              userId: z.string(),
              deviceId: z.string().nullable(),
              device: z.any().nullable(),
              token: z.string(),
              refreshToken: z.string(),
              ipAddress: z.string(),
              userAgent: z.string(),
              createdAt: z.string(),
              lastActivity: z.string(),
              expiresAt: z.string(),
              isActive: z.boolean(),
              recentActivity: z.array(z.object({
                action: z.string(),
                resource: z.string(),
                timestamp: z.string(),
                ipAddress: z.string(),
              })),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Cannot view other users sessions',
    },
    404: {
      description: 'Session not found',
    },
  },
})

app.openapi(getSessionRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { sessionId } = c.req.valid('param')
  
  const session = await sessionService.getSession(sessionId, user.id, tenantId)
  
  return c.json({
    success: true,
    data: session,
  })
})

// Revoke session
const revokeSessionRoute = createRoute({
  method: 'delete',
  path: '/:sessionId',
  tags: ['sessions'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Session revoked',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              message: z.string(),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Cannot revoke other users sessions',
    },
    404: {
      description: 'Session not found',
    },
  },
})

app.openapi(revokeSessionRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { sessionId } = c.req.valid('param')
  
  await sessionService.revokeSession(sessionId, user.id, tenantId)
  
  return c.json({
    success: true,
    data: {
      message: 'Session revoked successfully',
    },
  })
})

// Revoke all sessions
const revokeAllSessionsRoute = createRoute({
  method: 'post',
  path: '/revoke-all',
  tags: ['sessions'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            exceptCurrent: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'All sessions revoked',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              success: z.literal(true),
              sessionsRevoked: z.number(),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(revokeAllSessionsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const sessionId = c.get('sessionId')
  const body = c.req.valid('json')
  
  const result = await sessionService.revokeAllSessions(
    user.id,
    tenantId,
    body.exceptCurrent ? sessionId : undefined
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Extend session
const extendSessionRoute = createRoute({
  method: 'post',
  path: '/:sessionId/extend',
  tags: ['sessions'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Session extended',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              expiresAt: z.string(),
              lastActivity: z.string(),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Cannot extend other users sessions or expired sessions',
    },
    404: {
      description: 'Session not found',
    },
  },
})

app.openapi(extendSessionRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { sessionId } = c.req.valid('param')
  
  const session = await sessionService.extendSession(
    sessionId,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: {
      id: session.id,
      expiresAt: session.expiresAt,
      lastActivity: session.lastActivity,
    },
  })
})

// Get session statistics
const getSessionStatsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['sessions'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Session statistics',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              totalSessions: z.number(),
              activeSessions: z.number(),
              devicesWithActiveSessions: z.number(),
              recentActivity: z.array(z.object({
                sessionId: z.string(),
                lastActivity: z.string(),
                deviceName: z.string().optional(),
                deviceType: z.string().optional(),
              })),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(getSessionStatsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const stats = await sessionService.getSessionStats(user.id, tenantId)
  
  return c.json({
    success: true,
    data: stats,
  })
})

export { app as sessionRoutes }