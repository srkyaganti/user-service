import KcAdminClient from '@keycloak/keycloak-admin-client'
import { getEnvVar } from '@user-service/shared'
import { logger } from '../lib/logger'

export class KeycloakService {
  private static instance: KeycloakService
  private adminClient: KcAdminClient
  private initialized = false
  
  private constructor() {
    this.adminClient = new KcAdminClient({
      baseUrl: getEnvVar('KEYCLOAK_URL'),
      realmName: 'master',
    })
  }
  
  static getInstance(): KeycloakService {
    if (!KeycloakService.instance) {
      KeycloakService.instance = new KeycloakService()
    }
    return KeycloakService.instance
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return
    
    try {
      await this.authenticate()
      this.initialized = true
      
      // Re-authenticate periodically
      setInterval(() => {
        this.authenticate().catch(error => {
          logger.error({ error }, 'Keycloak re-authentication failed')
        })
      }, 50 * 60 * 1000) // Every 50 minutes
    } catch (error) {
      logger.error({ error }, 'Keycloak initialization failed')
      throw error
    }
  }
  
  private async authenticate(): Promise<void> {
    await this.adminClient.auth({
      grantType: 'password',
      clientId: getEnvVar('KEYCLOAK_CLIENT_ID', 'admin-cli'),
      username: getEnvVar('KEYCLOAK_ADMIN_USERNAME'),
      password: getEnvVar('KEYCLOAK_ADMIN_PASSWORD'),
    })
  }
  
  async healthCheck(): Promise<void> {
    // Try to get server info
    await this.adminClient.serverInfo.find()
  }
  
  async getClientForRealm(realm: string): Promise<KcAdminClient> {
    const client = new KcAdminClient({
      baseUrl: getEnvVar('KEYCLOAK_URL'),
      realmName: realm,
    })
    
    await client.auth({
      grantType: 'password',
      clientId: getEnvVar('KEYCLOAK_CLIENT_ID', 'admin-cli'),
      username: getEnvVar('KEYCLOAK_ADMIN_USERNAME'),
      password: getEnvVar('KEYCLOAK_ADMIN_PASSWORD'),
    })
    
    return client
  }
  
  async createRealm(realmName: string, displayName: string): Promise<void> {
    await this.ensureAuthenticated()
    
    try {
      await this.adminClient.realms.create({
        id: realmName,
        realm: realmName,
        enabled: true,
        displayName,
        sslRequired: 'external',
        bruteForceProtected: true,
        passwordPolicy: 'length(8) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1)',
        attributes: {
          frontendUrl: getEnvVar('KEYCLOAK_FRONTEND_URL', getEnvVar('KEYCLOAK_URL')),
        },
      })
      
      logger.info({ realm: realmName }, 'Keycloak realm created')
    } catch (error: any) {
      if (error.response?.status === 409) {
        logger.warn({ realm: realmName }, 'Keycloak realm already exists')
      } else {
        throw error
      }
    }
  }
  
  async createUser(realm: string, userData: {
    email: string
    password?: string
    firstName?: string
    lastName?: string
    attributes?: Record<string, string>
  }): Promise<{ id: string }> {
    const client = await this.getClientForRealm(realm)
    
    const response = await client.users.create({
      realm,
      username: userData.email,
      email: userData.email,
      enabled: true,
      emailVerified: false,
      firstName: userData.firstName,
      lastName: userData.lastName,
      attributes: userData.attributes,
      credentials: userData.password ? [{
        type: 'password',
        value: userData.password,
        temporary: false,
      }] : undefined,
      requiredActions: ['VERIFY_EMAIL'],
    })
    
    return { id: response.id }
  }
  
  async verifyUserCredentials(realm: string, email: string, password: string): Promise<boolean> {
    try {
      // Try to get a token for the user
      const tokenEndpoint = `${getEnvVar('KEYCLOAK_URL')}/realms/${realm}/protocol/openid-connect/token`
      
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'account', // Default client
          username: email,
          password,
        }),
      })
      
      return response.ok
    } catch (error) {
      logger.error({ error, realm, email }, 'Failed to verify user credentials')
      return false
    }
  }
  
  async updateUser(realm: string, userId: string, updates: {
    email?: string
    firstName?: string
    lastName?: string
    attributes?: Record<string, string>
    enabled?: boolean
  }): Promise<void> {
    const client = await this.getClientForRealm(realm)
    
    await client.users.update(
      { id: userId, realm },
      {
        email: updates.email,
        firstName: updates.firstName,
        lastName: updates.lastName,
        attributes: updates.attributes,
        enabled: updates.enabled,
      }
    )
  }
  
  async deleteUser(realm: string, userId: string): Promise<void> {
    const client = await this.getClientForRealm(realm)
    await client.users.del({ id: userId, realm })
  }
  
  async sendVerificationEmail(realm: string, userId: string): Promise<void> {
    const client = await this.getClientForRealm(realm)
    await client.users.sendVerifyEmail({ id: userId, realm })
  }
  
  async resetPassword(realm: string, userId: string, newPassword: string): Promise<void> {
    const client = await this.getClientForRealm(realm)
    
    await client.users.resetPassword({
      id: userId,
      realm,
      credential: {
        type: 'password',
        value: newPassword,
        temporary: false,
      },
    })
  }
  
  async getUser(realm: string, userId: string): Promise<any> {
    const client = await this.getClientForRealm(realm)
    return client.users.findOne({ id: userId, realm })
  }
  
  private async ensureAuthenticated(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}