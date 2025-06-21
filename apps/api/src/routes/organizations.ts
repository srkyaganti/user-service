import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { organizationService } from '../services/organization.service'
import { teamService } from '../services/team.service'
import { invitationService } from '../services/invitation.service'
import { authMiddleware } from '../middleware/auth'

const app = new OpenAPIHono()

// Create organization
const createOrgRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(100),
            slug: z.string().min(2).max(50).optional(),
            description: z.string().max(500).optional(),
            logo: z.string().url().optional(),
            metadata: z.record(z.any()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Organization created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              description: z.string().nullable(),
              logo: z.string().nullable(),
              metadata: z.any(),
              createdAt: z.string(),
            }),
          }),
        },
      },
    },
    409: {
      description: 'Organization slug already exists',
    },
  },
})

app.openapi(createOrgRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const org = await organizationService.createOrganization(
    user.id,
    tenantId,
    body
  )
  
  return c.json({
    success: true,
    data: org,
  }, 201)
})

// List user's organizations
const listOrgsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['organizations'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'List of organizations',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              description: z.string().nullable(),
              logo: z.string().nullable(),
              role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
              permissions: z.array(z.string()),
              joinedAt: z.string(),
              _count: z.object({
                members: z.number(),
                teams: z.number(),
              }),
            })),
          }),
        },
      },
    },
  },
})

app.openapi(listOrgsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const orgs = await organizationService.listOrganizations(user.id, tenantId)
  
  return c.json({
    success: true,
    data: orgs,
  })
})

// Get organization details
const getOrgRoute = createRoute({
  method: 'get',
  path: '/:orgId',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Organization details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              description: z.string().nullable(),
              logo: z.string().nullable(),
              metadata: z.any(),
              settings: z.any(),
              currentUserRole: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
              currentUserPermissions: z.array(z.string()),
              _count: z.object({
                members: z.number(),
                teams: z.number(),
              }),
              createdAt: z.string(),
              updatedAt: z.string(),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Not a member of this organization',
    },
    404: {
      description: 'Organization not found',
    },
  },
})

app.openapi(getOrgRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  
  const org = await organizationService.getOrganization(orgId, user.id, tenantId)
  
  return c.json({
    success: true,
    data: org,
  })
})

// Update organization
const updateOrgRoute = createRoute({
  method: 'patch',
  path: '/:orgId',
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
            name: z.string().min(2).max(100).optional(),
            slug: z.string().min(2).max(50).optional(),
            description: z.string().max(500).optional(),
            logo: z.string().url().optional(),
            metadata: z.record(z.any()).optional(),
            settings: z.record(z.any()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Organization updated',
    },
    403: {
      description: 'Insufficient permissions',
    },
    409: {
      description: 'Slug already exists',
    },
  },
})

app.openapi(updateOrgRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  const body = c.req.valid('json')
  
  const org = await organizationService.updateOrganization(
    orgId,
    user.id,
    tenantId,
    body
  )
  
  return c.json({
    success: true,
    data: org,
  })
})

// Delete organization
const deleteOrgRoute = createRoute({
  method: 'delete',
  path: '/:orgId',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Organization deleted',
    },
    403: {
      description: 'Only owners can delete organizations',
    },
  },
})

app.openapi(deleteOrgRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  
  const result = await organizationService.deleteOrganization(
    orgId,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// List organization members
const listMembersRoute = createRoute({
  method: 'get',
  path: '/:orgId/members',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Organization members',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({
              id: z.string(),
              role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
              permissions: z.array(z.string()),
              joinedAt: z.string(),
              user: z.object({
                id: z.string(),
                email: z.string(),
                profile: z.any(),
                createdAt: z.string(),
              }),
              teamMembers: z.array(z.object({
                team: z.object({
                  id: z.string(),
                  name: z.string(),
                }),
              })),
            })),
          }),
        },
      },
    },
    403: {
      description: 'Not a member of this organization',
    },
  },
})

app.openapi(listMembersRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  
  const members = await organizationService.listMembers(orgId, user.id, tenantId)
  
  return c.json({
    success: true,
    data: members,
  })
})

// Add member
const addMemberRoute = createRoute({
  method: 'post',
  path: '/:orgId/members',
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
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Member added',
    },
    403: {
      description: 'Insufficient permissions',
    },
    404: {
      description: 'User not found',
    },
    409: {
      description: 'User is already a member',
    },
  },
})

app.openapi(addMemberRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  const { email, role } = c.req.valid('json')
  
  const member = await organizationService.addMember(
    orgId,
    email,
    role,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: member,
  }, 201)
})

// Update member role
const updateMemberRoute = createRoute({
  method: 'patch',
  path: '/:orgId/members/:memberId',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
      memberId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Member role updated',
    },
    403: {
      description: 'Only owners can update roles',
    },
  },
})

app.openapi(updateMemberRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId, memberId } = c.req.valid('param')
  const { role } = c.req.valid('json')
  
  const member = await organizationService.updateMemberRole(
    orgId,
    memberId,
    role,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: member,
  })
})

// Remove member
const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/:orgId/members/:memberId',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
      memberId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Member removed',
    },
    400: {
      description: 'Cannot remove the last owner',
    },
    403: {
      description: 'Insufficient permissions',
    },
  },
})

app.openapi(removeMemberRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId, memberId } = c.req.valid('param')
  
  const result = await organizationService.removeMember(
    orgId,
    memberId,
    user.id,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Team routes (nested under organizations)
// Create team
const createTeamRoute = createRoute({
  method: 'post',
  path: '/:orgId/teams',
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
            name: z.string().min(2).max(50),
            description: z.string().max(200).optional(),
            permissions: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Team created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              orgId: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              permissions: z.array(z.string()),
              createdAt: z.string(),
            }),
          }),
        },
      },
    },
    403: {
      description: 'Insufficient permissions',
    },
    409: {
      description: 'Team name already exists',
    },
  },
})

app.openapi(createTeamRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  const body = c.req.valid('json')
  
  const team = await teamService.createTeam(
    orgId,
    user.id,
    tenantId,
    body
  )
  
  return c.json({
    success: true,
    data: team,
  }, 201)
})

// List teams
const listTeamsRoute = createRoute({
  method: 'get',
  path: '/:orgId/teams',
  tags: ['organizations'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'List of teams',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({
              id: z.string(),
              orgId: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              permissions: z.array(z.string()),
              isMember: z.boolean(),
              memberRole: z.string().optional(),
              _count: z.object({
                members: z.number(),
              }),
              createdAt: z.string(),
            })),
          }),
        },
      },
    },
    403: {
      description: 'Not a member of this organization',
    },
  },
})

app.openapi(listTeamsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { orgId } = c.req.valid('param')
  
  const teams = await teamService.listTeams(orgId, user.id, tenantId)
  
  return c.json({
    success: true,
    data: teams,
  })
})

// Invitation routes (nested under organizations)
// Send invitation
const sendInvitationRoute = createRoute({
  method: 'post',
  path: '/:orgId/invitations',
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
  path: '/:orgId/invitations',
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

export { app as orgRoutes }