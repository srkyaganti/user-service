import { execSync } from 'child_process'
import { dbManager } from '@user-service/database'
import Redis from 'ioredis'

export class TestDatabaseManager {
  private static instance: TestDatabaseManager
  private isSetup = false
  private testRedis?: Redis

  static getInstance(): TestDatabaseManager {
    if (!TestDatabaseManager.instance) {
      TestDatabaseManager.instance = new TestDatabaseManager()
    }
    return TestDatabaseManager.instance
  }

  async setupTestEnvironment(): Promise<void> {
    if (this.isSetup) return

    console.log('Setting up test environment...')

    // Set test environment variables
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5433/userservice_test'
    process.env.REDIS_URL = 'redis://localhost:6380'
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only-do-not-use-in-production'
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012'
    process.env.LOG_LEVEL = 'silent'
    process.env.SMTP_HOST = 'localhost'
    process.env.SMTP_PORT = '1026'
    process.env.SMTP_FROM = 'test@userservice.local'

    // Start test services
    await this.startTestServices()

    // Wait for services to be ready
    await this.waitForServices()

    // Initialize test database schema
    await this.initializeTestDatabase()

    // Initialize test Redis
    await this.initializeTestRedis()

    this.isSetup = true
    console.log('Test environment setup complete')
  }

  async teardownTestEnvironment(): Promise<void> {
    if (!this.isSetup) return

    console.log('Tearing down test environment...')

    try {
      // Close Redis connection
      if (this.testRedis) {
        await this.testRedis.quit()
        this.testRedis = undefined
      }

      // Close database connections
      await dbManager.disconnect()

      // Stop test services
      await this.stopTestServices()
    } catch (error) {
      console.warn('Error during test environment teardown:', error)
    }

    this.isSetup = false
    console.log('Test environment teardown complete')
  }

  async cleanupTestData(): Promise<void> {
    if (!this.isSetup) return

    try {
      // Clean up central database
      const centralDb = await dbManager.getCentralDb()
      await centralDb.$executeRaw`TRUNCATE TABLE "tenants" RESTART IDENTITY CASCADE`

      // Clean up Redis
      if (this.testRedis) {
        await this.testRedis.flushall()
      }

      console.log('Test data cleaned up')
    } catch (error) {
      console.warn('Error during test data cleanup:', error)
    }
  }

  async createTestTenant(slug: string = 'test-tenant'): Promise<any> {
    const centralDb = await dbManager.getCentralDb()
    
    // Create tenant in central database
    const tenant = await centralDb.tenant.create({
      data: {
        slug,
        name: `Test Tenant ${slug}`,
        config: {
          auth: {
            allowedMethods: ['email', 'magic-link', 'social'],
            requireInvitation: false,
            mfaRequired: false,
          },
          features: {
            organizations: true,
            teams: true,
            mfa: true,
            socialLogin: true,
          },
        },
        status: 'ACTIVE',
        dbHost: 'localhost',
        dbName: `test_${slug}`,
        dbUser: 'test_user',
        dbPassword: 'encrypted_password',
      },
    })

    // Initialize tenant database schema
    await this.initializeTenantDatabase(tenant.id)

    return tenant
  }

  async createTestUser(tenantId: string, overrides: any = {}): Promise<any> {
    const db = await dbManager.getClient(tenantId)
    
    const defaultUser = {
      email: 'test@example.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test-hash',
      profile: { name: 'Test User' },
      userType: 'INDIVIDUAL',
      emailVerified: true,
    }

    return db.user.create({
      data: {
        ...defaultUser,
        ...overrides,
      },
    })
  }

  async createTestOrganization(tenantId: string, overrides: any = {}): Promise<any> {
    const db = await dbManager.getClient(tenantId)
    
    const defaultOrg = {
      name: 'Test Organization',
      slug: 'test-org',
      description: 'Test organization for testing',
    }

    return db.organization.create({
      data: {
        ...defaultOrg,
        ...overrides,
      },
    })
  }

  getTestRedis(): Redis {
    if (!this.testRedis) {
      throw new Error('Test Redis not initialized')
    }
    return this.testRedis
  }

  private async startTestServices(): Promise<void> {
    try {
      console.log('Starting test services...')
      
      // Check if services are already running
      const isRunning = await this.checkServicesRunning()
      
      if (!isRunning) {
        // Start test services using docker-compose
        execSync('docker-compose -f docker-compose.test.yml up -d', {
          stdio: 'pipe',
          cwd: process.cwd(),
        })
        
        console.log('Test services started')
      } else {
        console.log('Test services already running')
      }
    } catch (error) {
      console.error('Failed to start test services:', error)
      throw new Error('Could not start test services')
    }
  }

  private async stopTestServices(): Promise<void> {
    try {
      console.log('Stopping test services...')
      
      execSync('docker-compose -f docker-compose.test.yml down', {
        stdio: 'pipe',
        cwd: process.cwd(),
      })
      
      console.log('Test services stopped')
    } catch (error) {
      console.warn('Error stopping test services:', error)
    }
  }

  private async checkServicesRunning(): Promise<boolean> {
    try {
      // Check if containers are running
      const result = execSync('docker-compose -f docker-compose.test.yml ps -q', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
      })
      
      return result.trim().length > 0
    } catch (error) {
      return false
    }
  }

  private async waitForServices(): Promise<void> {
    console.log('Waiting for test services to be ready...')
    
    const maxAttempts = 30
    const delay = 1000 // 1 second
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check PostgreSQL
        await this.checkPostgresReady()
        
        // Check Redis
        await this.checkRedisReady()
        
        console.log('All test services are ready')
        return
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Test services not ready after ${maxAttempts} attempts: ${error}`)
        }
        
        console.log(`Attempt ${attempt}/${maxAttempts}: Services not ready, waiting...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  private async checkPostgresReady(): Promise<void> {
    try {
      execSync('docker exec user-service-postgres-test pg_isready -U postgres -d userservice_test', {
        stdio: 'pipe',
      })
    } catch (error) {
      throw new Error('PostgreSQL not ready')
    }
  }

  private async checkRedisReady(): Promise<void> {
    try {
      execSync('docker exec user-service-redis-test redis-cli ping', {
        stdio: 'pipe',
      })
    } catch (error) {
      throw new Error('Redis not ready')
    }
  }

  private async initializeTestDatabase(): Promise<void> {
    try {
      console.log('Initializing test database schema...')
      
      // Run Prisma migrations/push for central database
      execSync('DATABASE_URL="postgresql://postgres:password@localhost:5433/userservice_test" bun run --cwd packages/database push --force-reset', {
        stdio: 'pipe',
        cwd: process.cwd(),
      })
      
      console.log('Test database schema initialized')
    } catch (error) {
      console.error('Failed to initialize test database:', error)
      throw new Error('Could not initialize test database schema')
    }
  }

  private async initializeTenantDatabase(tenantId: string): Promise<void> {
    try {
      // In a real multi-tenant setup, you might create separate databases
      // For testing, we'll use the same database with tenant isolation
      console.log(`Initializing tenant database for ${tenantId}`)
      
      // Create tenant-specific tables if needed
      const db = await dbManager.getClient(tenantId)
      
      // Verify connection works
      await db.$queryRaw`SELECT 1`
      
      console.log(`Tenant database initialized for ${tenantId}`)
    } catch (error) {
      console.error(`Failed to initialize tenant database for ${tenantId}:`, error)
      throw error
    }
  }

  private async initializeTestRedis(): Promise<void> {
    try {
      console.log('Initializing test Redis connection...')
      
      this.testRedis = new Redis({
        host: 'localhost',
        port: 6380,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
      })
      
      // Test connection
      await this.testRedis.ping()
      
      console.log('Test Redis connection initialized')
    } catch (error) {
      console.error('Failed to initialize test Redis:', error)
      throw new Error('Could not initialize test Redis connection')
    }
  }
}

// Export singleton instance
export const testDbManager = TestDatabaseManager.getInstance()

// Global setup/teardown functions for Vitest
export async function setup() {
  await testDbManager.setupTestEnvironment()
}

export async function teardown() {
  await testDbManager.teardownTestEnvironment()
}