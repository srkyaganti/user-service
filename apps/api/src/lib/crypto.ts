import { hash as argonHash, verify as argonVerify } from 'argon2'
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'
import { getEnvVar } from '@user-service/shared'

const scryptAsync = promisify(scrypt)

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    type: 2, // argon2id
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argonVerify(hash, password)
}

// Encryption for sensitive data
const ENCRYPTION_KEY = getEnvVar('ENCRYPTION_KEY')
const ALGORITHM = 'aes-256-gcm'

export async function encrypt(text: string): Promise<string> {
  const iv = randomBytes(16)
  const salt = randomBytes(32)
  const key = await scryptAsync(ENCRYPTION_KEY, salt, 32) as Buffer
  
  const cipher = createCipheriv(ALGORITHM, key, iv)
  
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ])
  
  const authTag = cipher.getAuthTag()
  
  // Combine salt, iv, authTag, and encrypted data
  const combined = Buffer.concat([salt, iv, authTag, encrypted])
  
  return combined.toString('base64')
}

export async function decrypt(encryptedText: string): Promise<string> {
  const combined = Buffer.from(encryptedText, 'base64')
  
  // Extract components
  const salt = combined.slice(0, 32)
  const iv = combined.slice(32, 48)
  const authTag = combined.slice(48, 64)
  const encrypted = combined.slice(64)
  
  const key = await scryptAsync(ENCRYPTION_KEY, salt, 32) as Buffer
  
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])
  
  return decrypted.toString('utf8')
}

// Generate secure random tokens
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('base64url')
}

// Generate numeric OTP
export function generateOTP(length: number = 6): string {
  const digits = '0123456789'
  let otp = ''
  
  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes(1)[0] % digits.length
    otp += digits[randomIndex]
  }
  
  return otp
}