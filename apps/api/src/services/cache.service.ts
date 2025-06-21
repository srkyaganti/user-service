import Redis from 'ioredis'
import { getEnvVar } from '@user-service/shared'
import { logger } from '../lib/logger'

export class CacheService {
  private static instance: CacheService
  private client: Redis
  
  private constructor() {
    this.client = new Redis(getEnvVar('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis connection failed after 3 retries')
          return null
        }
        return Math.min(times * 100, 3000)
      },
    })
    
    this.client.on('error', (error) => {
      logger.error({ error }, 'Redis error')
    })
    
    this.client.on('connect', () => {
      logger.info('Redis connected')
    })
  }
  
  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }
  
  getClient(): Redis {
    return this.client
  }
  
  async ping(): Promise<void> {
    await this.client.ping()
  }
  
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key)
      return value ? JSON.parse(value) : null
    } catch (error) {
      logger.error({ error, key }, 'Cache get error')
      return null
    }
  }
  
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      if (ttl) {
        await this.client.setex(key, ttl, serialized)
      } else {
        await this.client.set(key, serialized)
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache set error')
    }
  }
  
  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      logger.error({ error, key }, 'Cache delete error')
    }
  }
  
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern)
      if (keys.length > 0) {
        await this.client.del(...keys)
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache delete pattern error')
    }
  }
  
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key)
      return result === 1
    } catch (error) {
      logger.error({ error, key }, 'Cache exists error')
      return false
    }
  }
  
  async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.client.expire(key, ttl)
    } catch (error) {
      logger.error({ error, key, ttl }, 'Cache expire error')
    }
  }
  
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key)
    } catch (error) {
      logger.error({ error, key }, 'Cache ttl error')
      return -1
    }
  }
  
  async increment(key: string, by: number = 1): Promise<number> {
    try {
      return await this.client.incrby(key, by)
    } catch (error) {
      logger.error({ error, key }, 'Cache increment error')
      return 0
    }
  }
  
  async disconnect(): Promise<void> {
    await this.client.quit()
  }
}