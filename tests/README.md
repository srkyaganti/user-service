# Test Suite Documentation

This document provides comprehensive information about the test suite for the User Service.

## Overview

The test suite is designed to ensure the reliability, security, and functionality of the User Service. It includes:

- **Unit Tests**: Test individual functions and methods in isolation
- **Integration Tests**: Test API endpoints and service interactions
- **End-to-End Tests**: Test complete user workflows and authentication flows
- **Database Tests**: Test database operations and data integrity

## Test Structure

```
tests/
├── unit/                     # Unit tests for services and utilities
│   ├── auth.service.test.ts
│   ├── mfa.service.test.ts
│   ├── organization.service.test.ts
│   ├── team.service.test.ts
│   ├── user.service.test.ts
│   ├── social-auth.service.test.ts
│   ├── magic-link.service.test.ts
│   ├── device-session.service.test.ts
│   └── invitation-audit.service.test.ts
├── integration/              # API integration tests
│   └── api-routes.test.ts
├── e2e/                     # End-to-end workflow tests
│   └── auth-flows.test.ts
├── helpers/                 # Test utilities and helpers
│   └── test-utils.ts
├── setup.ts                 # Global test setup
├── test-db-setup.ts        # Database setup and management
└── README.md               # This file
```

## Test Categories

### Unit Tests

Unit tests focus on testing individual services and their methods in isolation. They use mocks and stubs to isolate the code under test.

**Coverage includes:**
- Authentication service (login, register, logout, MFA)
- User management service (profile, password, avatar)
- Organization and team management
- MFA services (TOTP, WebAuthn)
- Social authentication
- Magic link authentication
- Device and session management
- Invitation system
- Audit logging

### Integration Tests

Integration tests verify that different components work together correctly, particularly API endpoints and database interactions.

**Coverage includes:**
- All API routes with proper authentication
- Request/response validation
- Error handling and status codes
- Rate limiting
- CORS and security headers

### End-to-End Tests

E2E tests simulate real user workflows from start to finish.

**Coverage includes:**
- Complete registration and login flows
- Magic link authentication workflow
- Organization creation and team management
- MFA setup and verification
- Device management lifecycle
- Session management and cleanup
- Audit trail verification

## Running Tests

### Prerequisites

1. **Docker and Docker Compose**: Required for test services
2. **Bun**: JavaScript runtime and package manager
3. **PostgreSQL and Redis**: Provided via Docker containers

### Quick Start

```bash
# Setup test environment (first time only)
./scripts/test-setup.sh setup

# Run all tests
bun run test

# Run specific test types
bun run test:unit
bun run test:integration
bun run test:e2e

# Run tests with coverage
bun run test:coverage

# Run tests in watch mode
bun run test:watch
```

### Manual Setup

```bash
# Start test services
docker-compose -f docker-compose.test.yml up -d

# Install dependencies
bun install

# Setup test database
bun run db:generate
DATABASE_URL="postgresql://postgres:password@localhost:5433/userservice_test" bun run db:push

# Run tests
bun run test
```

## Test Configuration

### Environment Variables

Test-specific environment variables are defined in `.env.test`:

- `DATABASE_URL`: Test PostgreSQL connection
- `REDIS_URL`: Test Redis connection
- `JWT_SECRET`: Test JWT signing key
- `SMTP_HOST`: Test email service (Mailhog)

### Test Services

The test suite uses dedicated Docker containers:

- **PostgreSQL**: `localhost:5433` (test database)
- **Redis**: `localhost:6380` (test cache)
- **Mailhog**: `localhost:8026` (email testing)

### Test Database

Each test run uses a clean database state:
- Database is reset before each test suite
- Test data is cleaned up between individual tests
- Isolated tenant databases for multi-tenancy testing

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthService } from '../../src/services/auth.service'

describe('AuthService', () => {
  let authService: AuthService

  beforeEach(() => {
    authService = new AuthService()
    vi.clearAllMocks()
  })

  it('should login user with valid credentials', async () => {
    // Arrange
    const loginData = {
      email: 'test@example.com',
      password: 'Password123!',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    }

    // Act
    const result = await authService.login('tenant-123', loginData)

    // Assert
    expect(result.user.email).toBe(loginData.email)
    expect(result.tokens.accessToken).toBeDefined()
  })
})
```

### Integration Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { testClient } from 'hono/testing'
import { app } from '../../src/index'

describe('Auth API', () => {
  const client = testClient(app)

  it('POST /auth/login should authenticate user', async () => {
    const response = await client.api.v1.auth.login.$post({
      header: {
        'X-Tenant-ID': 'test-tenant',
        'Content-Type': 'application/json',
      },
      json: {
        email: 'test@example.com',
        password: 'Password123!',
      },
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })
})
```

### E2E Test Example

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestTenant, createTestUser } from '../setup'

describe('Complete Authentication Flow', () => {
  let testTenant: any

  beforeAll(async () => {
    testTenant = await createTestTenant('e2e-test')
  })

  it('should complete registration and login flow', async () => {
    // Step 1: Register user
    const registerResponse = await client.api.v1.auth.register.$post({
      // ... registration logic
    })

    // Step 2: Login with credentials
    const loginResponse = await client.api.v1.auth.login.$post({
      // ... login logic
    })

    // Step 3: Access protected resource
    const profileResponse = await client.api.v1.users.profile.$get({
      // ... with auth headers
    })

    expect(profileResponse.status).toBe(200)
  })
})
```

## Test Utilities

### Database Helpers

```typescript
import { createTestTenant, createTestUser, createTestOrganization } from '../setup'

// Create test tenant
const tenant = await createTestTenant('my-test-tenant')

// Create test user
const user = await createTestUser(tenant.id, {
  email: 'custom@example.com',
  profile: { name: 'Custom User' },
})

// Create test organization
const org = await createTestOrganization(tenant.id, {
  name: 'Custom Organization',
  slug: 'custom-org',
})
```

### Mock Utilities

```typescript
import { mockDbOperations, mockCache, mockEmailService } from '../helpers/test-utils'

// Mock database operations
mockDbOperations.user.findUnique.mockResolvedValue(mockUser)

// Mock cache operations
mockCache.get.mockResolvedValue(cachedData)

// Mock email service
mockEmailService.sendEmail.mockResolvedValue(true)
```

## Coverage Reports

Test coverage is tracked using Vitest's built-in coverage reporter:

```bash
# Generate coverage report
bun run test:coverage

# View coverage report
open coverage/index.html
```

**Coverage Targets:**
- Unit Tests: >90%
- Integration Tests: >80%
- Overall Coverage: >85%

## Continuous Integration

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual workflow dispatch

**CI Pipeline includes:**
- Dependency installation
- Linting and formatting checks
- Security audit
- Unit, integration, and E2E tests
- Coverage reporting
- Build verification

## Debugging Tests

### Running Single Tests

```bash
# Run specific test file
bun test auth.service.test.ts

# Run specific test case
bun test auth.service.test.ts -t "should login user"

# Run tests in debug mode
bun test --inspect-brk auth.service.test.ts
```

### Test Debugging Tips

1. **Use `console.log`** for quick debugging
2. **Use `vi.only()`** to run single test
3. **Use `vi.skip()`** to skip problematic tests
4. **Check test database state** between tests
5. **Verify mock configurations** are correct

### Common Issues

1. **Database connection errors**: Ensure test services are running
2. **Port conflicts**: Check if test ports are available
3. **Timing issues**: Add appropriate waits for async operations
4. **Mock leakage**: Ensure mocks are properly cleared between tests

## Best Practices

### Test Organization

1. **Group related tests** using `describe` blocks
2. **Use descriptive test names** that explain what is being tested
3. **Follow AAA pattern**: Arrange, Act, Assert
4. **Keep tests independent** and isolated
5. **Use setup/teardown** for common test preparations

### Test Data

1. **Use factory functions** for creating test data
2. **Make test data obvious** and readable
3. **Avoid hardcoded values** when possible
4. **Clean up test data** after each test
5. **Use realistic test data** that represents actual usage

### Assertions

1. **Be specific** with assertions
2. **Test both success and failure cases**
3. **Verify side effects** (database changes, events)
4. **Use appropriate matchers** for different data types
5. **Include error message context** in assertions

### Performance

1. **Keep tests fast** by using mocks appropriately
2. **Parallel test execution** when possible
3. **Optimize database operations** in tests
4. **Use test doubles** for external services
5. **Monitor test execution time** and optimize slow tests

## Contributing

When adding new features or fixing bugs:

1. **Write tests first** (TDD approach)
2. **Ensure adequate coverage** for new code
3. **Update existing tests** when changing behavior
4. **Add integration tests** for new API endpoints
5. **Document complex test scenarios**

## Troubleshooting

### Service Connection Issues

```bash
# Check if test services are running
docker-compose -f docker-compose.test.yml ps

# Restart test services
docker-compose -f docker-compose.test.yml restart

# View service logs
docker-compose -f docker-compose.test.yml logs
```

### Database Issues

```bash
# Reset test database
DATABASE_URL="postgresql://postgres:password@localhost:5433/userservice_test" bun run db:push --force-reset

# Check database connection
docker exec user-service-postgres-test psql -U postgres -d userservice_test -c "SELECT 1;"
```

### Redis Issues

```bash
# Test Redis connection
docker exec user-service-redis-test redis-cli ping

# Clear Redis data
docker exec user-service-redis-test redis-cli FLUSHALL
```

For additional help, check the [main documentation](../README.md) or open an issue in the repository.