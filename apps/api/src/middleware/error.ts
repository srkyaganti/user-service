import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { AppError } from '@user-service/shared'
import { logger } from '../lib/logger'

export async function errorHandler(err: Error, c: Context) {
  const requestId = c.get('requestId')
  
  // Log the error
  logger.error({
    err,
    requestId,
    path: c.req.path,
    method: c.req.method,
  }, 'Request error')
  
  // Handle known error types
  if (err instanceof AppError) {
    return c.json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
      },
    }, err.statusCode)
  }
  
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: {
        code: 'HTTP_EXCEPTION',
        message: err.message,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
      },
    }, err.status)
  }
  
  if (err instanceof ZodError) {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
      },
    }, 400)
  }
  
  // Handle Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any
    
    if (prismaError.code === 'P2002') {
      return c.json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this value already exists',
          details: {
            field: prismaError.meta?.target,
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
        },
      }, 409)
    }
    
    if (prismaError.code === 'P2025') {
      return c.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
        },
      }, 404)
    }
  }
  
  // Generic error response
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : err.message
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
      ...(process.env.NODE_ENV !== 'production' && {
        stack: err.stack,
      }),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId,
    },
  }, 500)
}