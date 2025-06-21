import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { getEnvVar } from '@user-service/shared'

const UPLOAD_DIR = getEnvVar('UPLOAD_DIR', './uploads')
const PUBLIC_URL = getEnvVar('PUBLIC_URL', 'http://localhost:3000')

// Ensure upload directory exists
async function ensureUploadDir(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

export async function uploadFile(file: File, path?: string): Promise<string> {
  // Generate unique filename
  const ext = file.name.split('.').pop()
  const filename = `${nanoid()}.${ext}`
  const filepath = path ? join(UPLOAD_DIR, path, filename) : join(UPLOAD_DIR, filename)
  
  // Ensure directory exists
  await ensureUploadDir(filepath)
  
  // Convert File to Buffer
  const buffer = Buffer.from(await file.arrayBuffer())
  
  // Process image if it's an image file
  if (file.type.startsWith('image/')) {
    const processed = await sharp(buffer)
      .resize(512, 512, {
        fit: 'cover',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer()
    
    await writeFile(filepath.replace(`.${ext}`, '.jpg'), processed)
    return `${PUBLIC_URL}/uploads/${path ? path + '/' : ''}${filename.replace(`.${ext}`, '.jpg')}`
  }
  
  // Write file directly for non-images
  await writeFile(filepath, buffer)
  return `${PUBLIC_URL}/uploads/${path ? path + '/' : ''}${filename}`
}

export async function deleteFile(url: string): Promise<void> {
  // Extract path from URL
  const urlPath = new URL(url).pathname
  const relativePath = urlPath.replace('/uploads/', '')
  const filepath = join(UPLOAD_DIR, relativePath)
  
  // Delete file if it exists
  if (existsSync(filepath)) {
    await unlink(filepath)
  }
}

// For production, you might want to use cloud storage like S3
export interface CloudStorageAdapter {
  upload(file: File, path?: string): Promise<string>
  delete(url: string): Promise<void>
}

// Example S3 adapter (not implemented, just interface)
export class S3StorageAdapter implements CloudStorageAdapter {
  async upload(file: File, path?: string): Promise<string> {
    // Implementation would use AWS SDK
    throw new Error('S3 storage not implemented')
  }
  
  async delete(url: string): Promise<void> {
    // Implementation would use AWS SDK
    throw new Error('S3 storage not implemented')
  }
}