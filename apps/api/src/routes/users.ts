import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { userService } from '../services/user.service'
import { authMiddleware } from '../middleware/auth'

const app = new OpenAPIHono()

// Get current user profile
const getProfileRoute = createRoute({
  method: 'get',
  path: '/profile',
  tags: ['users'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'User profile',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              profile: z.any(),
              userType: z.enum(['INDIVIDUAL', 'ORGANIZATIONAL', 'HYBRID']),
              createdAt: z.string(),
              updatedAt: z.string(),
              memberships: z.array(z.object({
                role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']),
                organization: z.object({
                  id: z.string(),
                  name: z.string(),
                  slug: z.string(),
                  logo: z.string().nullable(),
                }),
              })),
              socialAuths: z.array(z.object({
                provider: z.string(),
                email: z.string(),
                createdAt: z.string(),
              })),
              mfaSettings: z.array(z.object({
                type: z.enum(['TOTP', 'WEBAUTHN']),
                createdAt: z.string(),
                lastUsedAt: z.string().nullable(),
              })),
              _count: z.object({
                devices: z.number(),
                sessions: z.number(),
              }),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(getProfileRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const profile = await userService.getProfile(user.id, tenantId)
  
  return c.json({
    success: true,
    data: profile,
  })
})

// Update profile
const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/profile',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100).optional(),
            bio: z.string().max(500).optional(),
            phone: z.string().max(20).optional(),
            location: z.string().max(100).optional(),
            website: z.string().url().optional(),
            company: z.string().max(100).optional(),
            jobTitle: z.string().max(100).optional(),
            preferences: z.record(z.any()).optional(),
            metadata: z.record(z.any()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Profile updated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              profile: z.any(),
              userType: z.string(),
              updatedAt: z.string(),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(updateProfileRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const updatedUser = await userService.updateProfile(
    user.id,
    tenantId,
    body
  )
  
  return c.json({
    success: true,
    data: updatedUser,
  })
})

// Change password
const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            currentPassword: z.string(),
            newPassword: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password changed',
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
      description: 'Invalid password',
    },
  },
})

app.openapi(changePasswordRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  await userService.changePassword(user.id, tenantId, body)
  
  return c.json({
    success: true,
    data: {
      message: 'Password changed successfully',
    },
  })
})

// Upload avatar
const uploadAvatarRoute = createRoute({
  method: 'post',
  path: '/avatar',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any(), // File upload
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Avatar uploaded',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              profile: z.any(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'Invalid file',
    },
  },
})

app.openapi(uploadAvatarRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  // Get file from form data
  const formData = await c.req.formData()
  const file = formData.get('file') as File
  
  if (!file) {
    return c.json({
      success: false,
      error: {
        code: 'MISSING_FILE',
        message: 'No file provided',
      },
    }, 400)
  }
  
  const updatedUser = await userService.uploadAvatar(
    user.id,
    tenantId,
    file
  )
  
  return c.json({
    success: true,
    data: updatedUser,
  })
})

// Delete avatar
const deleteAvatarRoute = createRoute({
  method: 'delete',
  path: '/avatar',
  tags: ['users'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Avatar deleted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              profile: z.any(),
            }),
          }),
        },
      },
    },
    400: {
      description: 'No avatar to delete',
    },
  },
})

app.openapi(deleteAvatarRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const updatedUser = await userService.deleteAvatar(user.id, tenantId)
  
  return c.json({
    success: true,
    data: updatedUser,
  })
})

// Update email
const updateEmailRoute = createRoute({
  method: 'post',
  path: '/update-email',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            newEmail: z.string().email(),
            password: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Email update initiated',
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
      description: 'Invalid request',
    },
    409: {
      description: 'Email already in use',
    },
  },
})

app.openapi(updateEmailRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const result = await userService.updateEmail(
    user.id,
    tenantId,
    body.newEmail,
    body.password
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Delete account
const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/account',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            password: z.string().optional(),
            reason: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Account deletion initiated',
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
      description: 'Cannot delete account',
    },
  },
})

app.openapi(deleteAccountRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const result = await userService.deleteAccount(
    user.id,
    tenantId,
    body.password,
    body.reason
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Search users
const searchUsersRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
      organizationId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              users: z.array(z.object({
                id: z.string(),
                email: z.string(),
                profile: z.any(),
                userType: z.string(),
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

app.openapi(searchUsersRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const query = c.req.valid('query')
  
  const result = await userService.searchUsers(
    query.q,
    tenantId,
    {
      limit: query.limit,
      offset: query.offset,
      organizationId: query.organizationId,
    }
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Get user by ID (for viewing other users' public profiles)
const getUserByIdRoute = createRoute({
  method: 'get',
  path: '/:userId',
  tags: ['users'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      userId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'User profile',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              id: z.string(),
              email: z.string(),
              profile: z.any(),
              userType: z.string(),
              createdAt: z.string(),
            }),
          }),
        },
      },
    },
    404: {
      description: 'User not found',
    },
  },
})

app.openapi(getUserByIdRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const { userId } = c.req.valid('param')
  
  const user = await userService.getProfile(userId, tenantId)
  
  // Return limited public information
  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      profile: {
        name: (user.profile as any)?.name,
        bio: (user.profile as any)?.bio,
        avatarUrl: (user.profile as any)?.avatarUrl,
        company: (user.profile as any)?.company,
        jobTitle: (user.profile as any)?.jobTitle,
        location: (user.profile as any)?.location,
        website: (user.profile as any)?.website,
      },
      userType: user.userType,
      createdAt: user.createdAt,
    },
  })
})

export { app as userRoutes }