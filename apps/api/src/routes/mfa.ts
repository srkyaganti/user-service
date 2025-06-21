import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { authMiddleware } from '../middleware/auth'
import { mfaService } from '../services/mfa.service'

const app = new OpenAPIHono()

// Setup TOTP
const setupTOTPRoute = createRoute({
  method: 'post',
  path: '/totp/setup',
  tags: ['mfa'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'TOTP setup initiated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              setupToken: z.string(),
              secret: z.string(),
              qrCode: z.string(),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(setupTOTPRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const result = await mfaService.setupTOTP(user.id, tenantId)
  
  return c.json({
    success: true,
    data: result,
  })
})

// Verify TOTP setup
const verifyTOTPSetupRoute = createRoute({
  method: 'post',
  path: '/totp/verify-setup',
  tags: ['mfa'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            setupToken: z.string(),
            code: z.string().length(6),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'TOTP setup completed',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              backupCodes: z.array(z.string()),
            }),
          }),
        },
      },
    },
  },
})

app.openapi(verifyTOTPSetupRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const result = await mfaService.verifyTOTPSetup(
    body.setupToken,
    body.code,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Verify TOTP
const verifyTOTPRoute = createRoute({
  method: 'post',
  path: '/totp/verify',
  tags: ['mfa'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            mfaToken: z.string(),
            code: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'TOTP verified',
    },
  },
})

app.openapi(verifyTOTPRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  // Get user from MFA token
  const mfaSession = await c.get('cache').get(`mfa:session:${body.mfaToken}`)
  if (!mfaSession) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_MFA_TOKEN',
        message: 'Invalid or expired MFA token',
      },
    }, 401)
  }
  
  await mfaService.verifyTOTP(mfaSession.userId, body.code, tenantId)
  
  // Continue with login flow after MFA
  // This would generate tokens and create session
  
  return c.json({
    success: true,
    data: {
      message: 'MFA verified successfully',
    },
  })
})

// Setup WebAuthn
const setupWebAuthnRoute = createRoute({
  method: 'post',
  path: '/webauthn/setup',
  tags: ['mfa'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'WebAuthn setup initiated',
    },
  },
})

app.openapi(setupWebAuthnRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const result = await mfaService.setupWebAuthn(user.id, tenantId)
  
  return c.json({
    success: true,
    data: result,
  })
})

// Verify WebAuthn setup
const verifyWebAuthnSetupRoute = createRoute({
  method: 'post',
  path: '/webauthn/verify-setup',
  tags: ['mfa'],
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            setupToken: z.string(),
            credential: z.any(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'WebAuthn setup completed',
    },
  },
})

app.openapi(verifyWebAuthnSetupRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  const result = await mfaService.verifyWebAuthnSetup(
    body.setupToken,
    body.credential,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Generate WebAuthn challenge
const webAuthnChallengeRoute = createRoute({
  method: 'post',
  path: '/webauthn/challenge',
  tags: ['mfa'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            mfaToken: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'WebAuthn challenge generated',
    },
  },
})

app.openapi(webAuthnChallengeRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  // Get user from MFA token
  const mfaSession = await c.get('cache').get(`mfa:session:${body.mfaToken}`)
  if (!mfaSession) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_MFA_TOKEN',
        message: 'Invalid or expired MFA token',
      },
    }, 401)
  }
  
  const result = await mfaService.generateWebAuthnChallenge(
    mfaSession.userId,
    tenantId
  )
  
  return c.json({
    success: true,
    data: result,
  })
})

// Verify WebAuthn
const verifyWebAuthnRoute = createRoute({
  method: 'post',
  path: '/webauthn/verify',
  tags: ['mfa'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            challengeToken: z.string(),
            credential: z.any(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'WebAuthn verified',
    },
  },
})

app.openapi(verifyWebAuthnRoute, async (c) => {
  const tenantId = c.get('tenantId')
  const body = c.req.valid('json')
  
  await mfaService.verifyWebAuthn(
    body.challengeToken,
    body.credential,
    tenantId
  )
  
  return c.json({
    success: true,
    data: {
      message: 'MFA verified successfully',
    },
  })
})

// Disable MFA
const disableMFARoute = createRoute({
  method: 'delete',
  path: '/:type',
  tags: ['mfa'],
  middleware: authMiddleware,
  request: {
    params: z.object({
      type: z.enum(['totp', 'webauthn']),
    }),
  },
  responses: {
    200: {
      description: 'MFA disabled',
    },
  },
})

app.openapi(disableMFARoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  const { type } = c.req.valid('param')
  
  await mfaService.disableMFA(
    user.id,
    type.toUpperCase() as 'TOTP' | 'WEBAUTHN',
    tenantId
  )
  
  return c.json({
    success: true,
    data: {
      message: `${type.toUpperCase()} disabled successfully`,
    },
  })
})

// Get user's MFA methods
const getMFAMethodsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['mfa'],
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'User MFA methods',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({
              id: z.string(),
              type: z.enum(['TOTP', 'WEBAUTHN']),
              createdAt: z.string(),
              lastUsedAt: z.string().nullable(),
            })),
          }),
        },
      },
    },
  },
})

app.openapi(getMFAMethodsRoute, async (c) => {
  const user = c.get('user')
  const tenantId = c.get('tenantId')
  
  const methods = await mfaService.getUserMFAMethods(user.id, tenantId)
  
  return c.json({
    success: true,
    data: methods,
  })
})

export { app as mfaRoutes }