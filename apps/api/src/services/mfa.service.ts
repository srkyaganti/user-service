import { OTPAuth } from 'otpauth'
import QRCode from 'qrcode'
import { 
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  AuthenticationError,
  CACHE_KEYS,
  generateSecureToken,
} from '@user-service/shared'
import { CacheService } from './cache.service'
import { encrypt, decrypt } from '../lib/crypto'
import { logger } from '../lib/logger'

const cache = CacheService.getInstance()

export class MFAService {
  // TOTP Methods
  async setupTOTP(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    // Check if TOTP is already set up
    const existingTOTP = await db.mFASetting.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    })
    
    if (existingTOTP && existingTOTP.enabled) {
      throw new ValidationError('TOTP is already enabled')
    }
    
    // Generate new TOTP secret
    const totp = new OTPAuth.TOTP({
      issuer: 'User Service',
      label: userId,
      algorithm: 'SHA256',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(generateSecureToken(32)),
    })
    
    const secret = totp.secret.base32
    const uri = totp.toString()
    const qrCode = await QRCode.toDataURL(uri)
    
    // Store setup temporarily
    const setupToken = generateSecureToken()
    await cache.set(
      CACHE_KEYS.MFA_SETUP(setupToken),
      {
        userId,
        type: 'TOTP',
        secret: await encrypt(secret),
      },
      600 // 10 minutes
    )
    
    return {
      setupToken,
      secret,
      qrCode,
    }
  }
  
  async verifyTOTPSetup(setupToken: string, code: string, tenantId: string) {
    const setupData = await cache.get(CACHE_KEYS.MFA_SETUP(setupToken))
    
    if (!setupData || setupData.type !== 'TOTP') {
      throw new ValidationError('Invalid or expired setup token')
    }
    
    const secret = await decrypt(setupData.secret)
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA256',
      digits: 6,
      period: 30,
    })
    
    // Verify the code
    const delta = totp.validate({ token: code, window: 1 })
    
    if (delta === null) {
      throw new ValidationError('Invalid verification code')
    }
    
    // Save TOTP settings
    const db = await dbManager.getClient(tenantId)
    await db.mFASetting.upsert({
      where: {
        userId_type: {
          userId: setupData.userId,
          type: 'TOTP',
        },
      },
      create: {
        userId: setupData.userId,
        type: 'TOTP',
        enabled: true,
        secret: await encrypt(secret),
        backupCodes: await this.generateBackupCodes(),
      },
      update: {
        enabled: true,
        secret: await encrypt(secret),
        backupCodes: await this.generateBackupCodes(),
        lastUsedAt: null,
      },
    })
    
    // Clear setup cache
    await cache.delete(CACHE_KEYS.MFA_SETUP(setupToken))
    
    return {
      success: true,
      backupCodes: await this.getBackupCodes(setupData.userId, tenantId),
    }
  }
  
  async verifyTOTP(userId: string, code: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const mfaSetting = await db.mFASetting.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'TOTP',
        },
      },
    })
    
    if (!mfaSetting || !mfaSetting.enabled) {
      throw new ValidationError('TOTP is not enabled')
    }
    
    const secret = await decrypt(mfaSetting.secret!)
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA256',
      digits: 6,
      period: 30,
    })
    
    // Check if it's a backup code
    if (code.length === 10) {
      return this.verifyBackupCode(userId, code, tenantId)
    }
    
    // Verify TOTP code
    const delta = totp.validate({ token: code, window: 1 })
    
    if (delta === null) {
      throw new AuthenticationError('Invalid verification code')
    }
    
    // Update last used
    await db.mFASetting.update({
      where: { id: mfaSetting.id },
      data: { lastUsedAt: new Date() },
    })
    
    return { success: true }
  }
  
  // WebAuthn Methods
  async setupWebAuthn(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    const user = await db.user.findUnique({ where: { id: userId } })
    
    if (!user) {
      throw new ValidationError('User not found')
    }
    
    // Generate registration options
    const options = await generateRegistrationOptions({
      rpName: 'User Service',
      rpID: process.env.WEBAUTHN_RP_ID || 'localhost',
      userID: userId,
      userName: user.email,
      userDisplayName: user.email,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        requireResidentKey: false,
        userVerification: 'preferred',
      },
    })
    
    // Store challenge temporarily
    const setupToken = generateSecureToken()
    await cache.set(
      CACHE_KEYS.MFA_SETUP(setupToken),
      {
        userId,
        type: 'WEBAUTHN',
        challenge: options.challenge,
      },
      600 // 10 minutes
    )
    
    return {
      setupToken,
      options,
    }
  }
  
  async verifyWebAuthnSetup(
    setupToken: string,
    credential: any,
    tenantId: string
  ) {
    const setupData = await cache.get(CACHE_KEYS.MFA_SETUP(setupToken))
    
    if (!setupData || setupData.type !== 'WEBAUTHN') {
      throw new ValidationError('Invalid or expired setup token')
    }
    
    // Verify the registration
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: setupData.challenge,
      expectedOrigin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000',
      expectedRPID: process.env.WEBAUTHN_RP_ID || 'localhost',
    })
    
    if (!verification.verified || !verification.registrationInfo) {
      throw new ValidationError('WebAuthn verification failed')
    }
    
    // Save WebAuthn credential
    const db = await dbManager.getClient(tenantId)
    await db.mFASetting.create({
      data: {
        userId: setupData.userId,
        type: 'WEBAUTHN',
        enabled: true,
        credentialId: verification.registrationInfo.credentialID,
        publicKey: Buffer.from(verification.registrationInfo.credentialPublicKey).toString('base64'),
        backupCodes: await this.generateBackupCodes(),
      },
    })
    
    // Clear setup cache
    await cache.delete(CACHE_KEYS.MFA_SETUP(setupToken))
    
    return {
      success: true,
      backupCodes: await this.getBackupCodes(setupData.userId, tenantId),
    }
  }
  
  async generateWebAuthnChallenge(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const credentials = await db.mFASetting.findMany({
      where: {
        userId,
        type: 'WEBAUTHN',
        enabled: true,
      },
    })
    
    if (credentials.length === 0) {
      throw new ValidationError('No WebAuthn credentials found')
    }
    
    const options = await generateAuthenticationOptions({
      rpID: process.env.WEBAUTHN_RP_ID || 'localhost',
      allowCredentials: credentials.map(cred => ({
        id: cred.credentialId!,
        type: 'public-key',
      })),
      userVerification: 'preferred',
    })
    
    // Store challenge
    const challengeToken = generateSecureToken()
    await cache.set(
      `webauthn:challenge:${challengeToken}`,
      {
        userId,
        challenge: options.challenge,
      },
      300 // 5 minutes
    )
    
    return {
      challengeToken,
      options,
    }
  }
  
  async verifyWebAuthn(
    challengeToken: string,
    credential: any,
    tenantId: string
  ) {
    const challengeData = await cache.get(`webauthn:challenge:${challengeToken}`)
    
    if (!challengeData) {
      throw new ValidationError('Invalid or expired challenge')
    }
    
    const db = await dbManager.getClient(tenantId)
    const mfaSetting = await db.mFASetting.findFirst({
      where: {
        userId: challengeData.userId,
        type: 'WEBAUTHN',
        credentialId: credential.id,
        enabled: true,
      },
    })
    
    if (!mfaSetting) {
      throw new ValidationError('Credential not found')
    }
    
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000',
      expectedRPID: process.env.WEBAUTHN_RP_ID || 'localhost',
      authenticator: {
        credentialID: mfaSetting.credentialId!,
        credentialPublicKey: Buffer.from(mfaSetting.publicKey!, 'base64'),
        counter: 0,
      },
    })
    
    if (!verification.verified) {
      throw new AuthenticationError('WebAuthn verification failed')
    }
    
    // Update last used
    await db.mFASetting.update({
      where: { id: mfaSetting.id },
      data: { lastUsedAt: new Date() },
    })
    
    // Clear challenge
    await cache.delete(`webauthn:challenge:${challengeToken}`)
    
    return { success: true }
  }
  
  // Backup codes
  private async generateBackupCodes(): Promise<string[]> {
    const codes = []
    for (let i = 0; i < 10; i++) {
      const code = generateSecureToken(5).toUpperCase()
      codes.push(await encrypt(`${code.slice(0, 5)}-${code.slice(5)}`))
    }
    return codes
  }
  
  private async getBackupCodes(userId: string, tenantId: string): Promise<string[]> {
    const db = await dbManager.getClient(tenantId)
    const mfaSetting = await db.mFASetting.findFirst({
      where: { userId, enabled: true },
    })
    
    if (!mfaSetting) {
      return []
    }
    
    // Decrypt backup codes
    const codes = []
    for (const encryptedCode of mfaSetting.backupCodes) {
      codes.push(await decrypt(encryptedCode))
    }
    
    return codes
  }
  
  private async verifyBackupCode(userId: string, code: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    const mfaSettings = await db.mFASetting.findMany({
      where: { userId, enabled: true },
    })
    
    for (const setting of mfaSettings) {
      const backupCodes = setting.backupCodes
      
      for (let i = 0; i < backupCodes.length; i++) {
        const decryptedCode = await decrypt(backupCodes[i])
        if (decryptedCode === code) {
          // Remove used backup code
          backupCodes.splice(i, 1)
          
          await db.mFASetting.update({
            where: { id: setting.id },
            data: { 
              backupCodes,
              lastUsedAt: new Date(),
            },
          })
          
          return { success: true, backupCodeUsed: true }
        }
      }
    }
    
    throw new AuthenticationError('Invalid backup code')
  }
  
  // Disable MFA
  async disableMFA(userId: string, type: 'TOTP' | 'WEBAUTHN', tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    await db.mFASetting.updateMany({
      where: {
        userId,
        type,
      },
      data: {
        enabled: false,
      },
    })
    
    return { success: true }
  }
  
  // Get user's MFA methods
  async getUserMFAMethods(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const methods = await db.mFASetting.findMany({
      where: {
        userId,
        enabled: true,
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
        lastUsedAt: true,
      },
    })
    
    return methods
  }
}

export const mfaService = new MFAService()