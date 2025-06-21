import { SignJWT, jwtVerify } from 'jose'
import { getEnvVar, JWTPayload, AuthenticationError } from '@user-service/shared'
import { nanoid } from 'nanoid'

const JWT_SECRET = new TextEncoder().encode(getEnvVar('JWT_SECRET'))
const JWT_ISSUER = 'user-service'
const JWT_AUDIENCE = 'user-service-api'

export async function generateTokens(payload: {
  userId: string
  email: string
  tenantId: string
  organizationId?: string
}) {
  const sessionId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  
  // Access token - short lived
  const accessToken = await new SignJWT({
    sub: payload.userId,
    email: payload.email,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime('15m')
    .setJti(nanoid())
    .sign(JWT_SECRET)
  
  // Refresh token - long lived
  const refreshToken = await new SignJWT({
    sub: payload.userId,
    sessionId,
    type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime('30d')
    .setJti(nanoid())
    .sign(JWT_SECRET)
  
  return {
    accessToken,
    refreshToken,
    sessionId,
  }
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })
    
    return payload as unknown as JWTPayload
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token')
  }
}

export async function verifyRefreshToken(token: string): Promise<{ sub: string; sessionId: string }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })
    
    if (payload.type !== 'refresh') {
      throw new Error('Not a refresh token')
    }
    
    return {
      sub: payload.sub as string,
      sessionId: payload.sessionId as string,
    }
  } catch (error) {
    throw new AuthenticationError('Invalid or expired refresh token')
  }
}