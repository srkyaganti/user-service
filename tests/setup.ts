import { beforeAll, afterAll, beforeEach } from 'vitest'
import { testDbManager } from './test-db-setup'

// Global setup for all tests
beforeAll(async () => {
  await testDbManager.setupTestEnvironment()
}, 60000) // 60 second timeout for setup

beforeEach(async () => {
  await testDbManager.cleanupTestData()
})

afterAll(async () => {
  await testDbManager.teardownTestEnvironment()
}, 30000) // 30 second timeout for teardown

// Re-export utilities for convenience
export const createTestTenant = (slug?: string, type?: 'B2B' | 'B2C' | 'HYBRID') => testDbManager.createTestTenant(slug, type)
export const createTestUser = (tenantId: string, overrides?: any) => testDbManager.createTestUser(tenantId, overrides)
export const createTestOrganization = (tenantId: string, overrides?: any) => testDbManager.createTestOrganization(tenantId, overrides)
export const getTestRedis = () => testDbManager.getTestRedis()