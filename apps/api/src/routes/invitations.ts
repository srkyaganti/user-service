import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { invitationService } from '../services/invitation.service'
import { authMiddleware } from '../middleware/auth'

const app = new OpenAPIHono()

// Get invitation details (public)
const getInvitationRoute = createRoute({
  method: 'get',
  path: '/:token',
  tags: ['invitations'],
  request: {
    params: z.object({
      token: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Invitation details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
              organization: z.object({
                id: z.string(),
                name: z.string(),
                slug: z.string(),
                logo: z.string().nullable(),
                description: z.string().nullable(),
              }),
              invitedBy: z.object({
                id: z.string(),
                email: z.string(),
                name: z.string().optional(),
              }).nullable(),
              message: z.string().optional(),
              expiresAt: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Invalid or expired invitation',
    },
    404: {
      description: 'Invitation not found',
    },
  },
})

app.openapi(getInvitationRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const { token } = c.req.valid('param')
  
  const invitation = await invitationService.getInvitation(token, tenantId)
  
  return c.json({
    success: true,
    data: invitation,
  })
})

// Accept invitation
const acceptInvitationRoute = createRoute({
  method: 'post',
  path: '/:token/accept',
  tags: ['invitations'],
  request: {
    params: z.object({
      token: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Invitation accepted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.union([
              z.object({
                requiresRegistration: z.literal(true),
                email: z.string(),
                organization: z.object({
                  id: z.string(),
                  name: z.string(),
                  slug: z.string(),
                }),
              }),
              z.object({
                success: z.literal(true),
                membership: z.object({
                  id: z.string(),
                  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
                  organization: z.object({
                    id: z.string(),
                    name: z.string(),
                    slug: z.string(),
                  }),
                }),
              }),
            ]),
          }),
        },
      },
    },
    400: {
      description: 'Invalid or expired invitation',
    },
    409: {
      description: 'Already a member',
    },
  },
})

app.openapi(acceptInvitationRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const { token } = c.req.valid('param')
  
  // Get user ID if authenticated
  let userId = null
  try {
    const user = c.get('user')
    userId = user?.id
  } catch {
    // User not authenticated
  }
  
  const result = await invitationService.acceptInvitation(
    token,
    userId,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Organization invitation routes (nested under organizations)
// Send invitation
const sendInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/:orgId/invitations',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            role: z.enum(['ADMIN', 'MEMBER', 'GUEST']),
            message: z.string().max(500).optional(),
            expiresInDays: z.number().min(1).max(30).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invitation sent',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
              expiresAt: z.string(),
              invitedBy: z.object({
                id: z.string(),
                email: z.string(),
                name: z.string().optional(),
              }),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Insufficient permissions',
    },
    409: {
      description: 'User already invited or member',
    },
  },
})

app.openapi(sendInvitationRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  const body = c.req.valid('json')
  
  const invitation = await invitationService.createInvitation(
    orgId,
    user.id,
    tenantId,
    body
  )
  
  return c.json({
    success: true,
    data: invitation,
  }, 201)
})

// List invitations
const listInvitationsRoute = createRoute({
  method: 'get',
  path: '/organizations/:orgId/invitations',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
    query: z.object({
      status: z.enum(['pending', 'accepted', 'expired']).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of invitations',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              invitations: z.array(z.object({
                id: z.string(),
                email: z.string(),
                role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
                status: z.enum(['pending', 'accepted', 'expired']),
                invitedBy: z.object({
                  id: z.string(),
                  email: z.string(),
                  name: z.string().optional(),
                }).nullable(),
                createdAt: z.string(),
                acceptedAt: z.string().nullable(),
                expiresAt: z.string(),
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
    403: {
      description: 'Insufficient permissions',
    },
  },
})

app.openapi(listInvitationsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  const query = c.req.valid('query')
  
  const result = await invitationService.listInvitations(
    orgId,
    user.id,
    tenantId,
    query
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Revoke invitation
const revokeInvitationRoute = createRoute({
  method: 'delete',
  path: '/invitations/:invitationId',
  tags: ['invitations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      invitationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Invitation revoked',
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
    400: {
      description: 'Cannot revoke accepted invitation',
    },
    403: {
      description: 'Insufficient permissions',
    },
    404: {
      description: 'Invitation not found',
    },
  },
})

app.openapi(revokeInvitationRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { invitationId } = c.req.valid('param')
  
  await invitationService.revokeInvitation(
    invitationId,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: {
      message: 'Invitation revoked successfully',
    },
  })
})

// Resend invitation
const resendInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/:invitationId/resend',
  tags: ['invitations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      invitationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Invitation resent',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              success: z.literal(true),
              expiresAt: z.string(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Cannot resend accepted invitation',
    },
    403: {
      description: 'Insufficient permissions',
    },
    404: {
      description: 'Invitation not found',
    },
  },
})

app.openapi(resendInvitationRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { invitationId } = c.req.valid('param')
  
  const result = await invitationService.resendInvitation(
    invitationId,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

export { app as invitationRoutes }