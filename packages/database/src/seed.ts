import { prisma, dbManager } from './index'

async function seed() {
  console.log('🌱 Starting database seed...')

  try {
    // Create default tenant for development
    const devTenant = await dbManager.createTenant({
      name: 'Development Tenant',
      slug: 'dev',
      config: {
        features: {
          mfa: true,
          teams: true,
          sso: false,
        },
        auth: {
          allowedMethods: ['email', 'google', 'magic-link'],
          mfaRequired: false,
          sessionTimeout: 3600,
        },
        limits: {
          maxUsers: 1000,
          maxOrganizations: 10,
        }
      }
    })

    console.log('✅ Created development tenant:', devTenant.slug)

    // Get tenant database
    const tenantDb = await dbManager.getClient(devTenant.id)

    // Create test organization
    const org = await tenantDb.organization.create({
      data: {
        name: 'Test Organization',
        slug: 'test-org',
        settings: {
          features: ['teams', 'mfa'],
          branding: {
            primaryColor: '#6366f1',
          }
        }
      }
    })

    console.log('✅ Created test organization:', org.name)

    // Note: We'll create users after Keycloak integration is set up
    console.log('🌱 Seed completed successfully!')

  } catch (error) {
    console.error('❌ Seed failed:', error)
    process.exit(1)
  } finally {
    await dbManager.disconnectAll()
  }
}

// Run seed
seed().catch(console.error)