import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '@user-service/shared'
import { logger } from '../lib/logger'
import crypto from 'crypto'
import type { DeviceType, TrustLevel } from '@user-service/database'

export interface RegisterDeviceDto {
  name: string
  type: DeviceType
  platform?: string
  browser?: string
  os?: string
}

export interface UpdateDeviceDto {
  name?: string
  trustLevel?: TrustLevel
}

export class DeviceService {
  async registerDevice(
    userId: string,
    tenantId: string,
    deviceInfo: RegisterDeviceDto & {
      ipAddress: string
      userAgent: string
    }
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Generate device fingerprint
    const fingerprint = this.generateFingerprint({
      userId,
      userAgent: deviceInfo.userAgent,
      platform: deviceInfo.platform,
      browser: deviceInfo.browser,
    })
    
    // Check if device already exists
    let device = await db.device.findUnique({
      where: { fingerprint },
    })
    
    if (device) {
      // Update last used
      device = await db.device.update({
        where: { id: device.id },
        data: {
          lastUsedAt: new Date(),
          lastIp: deviceInfo.ipAddress,
          name: deviceInfo.name || device.name,
        },
      })
    } else {
      // Create new device
      device = await db.device.create({
        data: {
          userId,
          name: deviceInfo.name,
          type: deviceInfo.type,
          fingerprint,
          platform: deviceInfo.platform,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          lastIp: deviceInfo.ipAddress,
          trustLevel: 'UNKNOWN',
        },
      })
      
      // Log new device
      await db.auditLog.create({
        data: {
          userId,
          action: 'device.registered',
          resource: 'device',
          resourceId: device.id,
          metadata: {
            name: device.name,
            type: device.type,
            platform: device.platform,
          },
          ipAddress: deviceInfo.ipAddress,
          userAgent: deviceInfo.userAgent,
        },
      })
    }
    
    return device
  }
  
  async listDevices(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const devices = await db.device.findMany({
      where: { userId },
      include: {
        _count: {
          select: {
            sessions: {
              where: {
                expiresAt: { gt: new Date() },
              },
            },
          },
        },
      },
      orderBy: {
        lastUsedAt: 'desc',
      },
    })
    
    return devices.map(device => ({
      ...device,
      isCurrentDevice: false, // Would be determined by current session
      activeSessions: device._count.sessions,
    }))
  }
  
  async getDevice(deviceId: string, userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const device = await db.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: {
            expiresAt: { gt: new Date() },
          },
          orderBy: {
            lastActivity: 'desc',
          },
          take: 10,
        },
      },
    })
    
    if (!device) {
      throw new NotFoundError('Device')
    }
    
    if (device.userId !== userId) {
      throw new ForbiddenError('You can only view your own devices')
    }
    
    return device
  }
  
  async updateDevice(
    deviceId: string,
    userId: string,
    tenantId: string,
    data: UpdateDeviceDto
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Get device
    const device = await db.device.findUnique({
      where: { id: deviceId },
    })
    
    if (!device) {
      throw new NotFoundError('Device')
    }
    
    if (device.userId !== userId) {
      throw new ForbiddenError('You can only update your own devices')
    }
    
    // Update device
    const updatedDevice = await db.device.update({
      where: { id: deviceId },
      data: {
        name: data.name,
        trustLevel: data.trustLevel,
      },
    })
    
    // Log update
    await db.auditLog.create({
      data: {
        userId,
        action: 'device.updated',
        resource: 'device',
        resourceId: deviceId,
        metadata: { changes: data },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return updatedDevice
  }
  
  async trustDevice(
    deviceId: string,
    userId: string,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    const device = await db.device.findUnique({
      where: { id: deviceId },
    })
    
    if (!device) {
      throw new NotFoundError('Device')
    }
    
    if (device.userId !== userId) {
      throw new ForbiddenError('You can only trust your own devices')
    }
    
    // Mark as trusted
    const trustedDevice = await db.device.update({
      where: { id: deviceId },
      data: { trustLevel: 'TRUSTED' },
    })
    
    // Log trust action
    await db.auditLog.create({
      data: {
        userId,
        action: 'device.trusted',
        resource: 'device',
        resourceId: deviceId,
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return trustedDevice
  }
  
  async removeDevice(
    deviceId: string,
    userId: string,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    const device = await db.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: {
            expiresAt: { gt: new Date() },
          },
        },
      },
    })
    
    if (!device) {
      throw new NotFoundError('Device')
    }
    
    if (device.userId !== userId) {
      throw new ForbiddenError('You can only remove your own devices')
    }
    
    // Don't allow removing device with active sessions
    if (device.sessions.length > 0) {
      throw new ValidationError(
        'Cannot remove device with active sessions. Please log out first.'
      )
    }
    
    // Delete device
    await db.device.delete({
      where: { id: deviceId },
    })
    
    // Log removal
    await db.auditLog.create({
      data: {
        userId,
        action: 'device.removed',
        resource: 'device',
        resourceId: deviceId,
        metadata: {
          name: device.name,
          type: device.type,
        },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return { success: true }
  }
  
  async logoutDevice(
    deviceId: string,
    userId: string,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    const device = await db.device.findUnique({
      where: { id: deviceId },
    })
    
    if (!device) {
      throw new NotFoundError('Device')
    }
    
    if (device.userId !== userId) {
      throw new ForbiddenError('You can only logout your own devices')
    }
    
    // Invalidate all sessions for this device
    const result = await db.session.updateMany({
      where: {
        deviceId,
        userId,
        expiresAt: { gt: new Date() },
      },
      data: {
        expiresAt: new Date(), // Expire immediately
      },
    })
    
    // Log logout
    await db.auditLog.create({
      data: {
        userId,
        action: 'device.logged_out',
        resource: 'device',
        resourceId: deviceId,
        metadata: {
          sessionsInvalidated: result.count,
        },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return {
      success: true,
      sessionsInvalidated: result.count,
    }
  }
  
  async getDeviceStats(userId: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const [
      totalDevices,
      trustedDevices,
      activeSessions,
      deviceTypes,
    ] = await Promise.all([
      db.device.count({
        where: { userId },
      }),
      db.device.count({
        where: { userId, trustLevel: 'TRUSTED' },
      }),
      db.session.count({
        where: {
          userId,
          expiresAt: { gt: new Date() },
        },
      }),
      db.device.groupBy({
        by: ['type'],
        where: { userId },
        _count: true,
      }),
    ])
    
    return {
      totalDevices,
      trustedDevices,
      activeSessions,
      deviceTypes: deviceTypes.reduce((acc, item) => {
        acc[item.type] = item._count
        return acc
      }, {} as Record<string, number>),
    }
  }
  
  private generateFingerprint(data: {
    userId: string
    userAgent: string
    platform?: string
    browser?: string
  }): string {
    const parts = [
      data.userId,
      data.userAgent,
      data.platform || 'unknown',
      data.browser || 'unknown',
    ]
    
    return crypto
      .createHash('sha256')
      .update(parts.join('|'))
      .digest('hex')
  }
  
  async detectDeviceInfo(userAgent: string): Promise<{
    type: DeviceType
    platform?: string
    browser?: string
    os?: string
  }> {
    // Simple user agent parsing
    const ua = userAgent.toLowerCase()
    
    let type: DeviceType = 'UNKNOWN'
    let platform: string | undefined
    let browser: string | undefined
    let os: string | undefined
    
    // Detect device type
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      type = 'MOBILE'
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      type = 'TABLET'
    } else if (ua.includes('windows') || ua.includes('mac') || ua.includes('linux')) {
      type = 'DESKTOP'
    }
    
    // Detect OS
    if (ua.includes('windows')) os = 'Windows'
    else if (ua.includes('mac')) os = 'macOS'
    else if (ua.includes('linux')) os = 'Linux'
    else if (ua.includes('android')) os = 'Android'
    else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS'
    
    // Detect browser
    if (ua.includes('chrome')) browser = 'Chrome'
    else if (ua.includes('firefox')) browser = 'Firefox'
    else if (ua.includes('safari')) browser = 'Safari'
    else if (ua.includes('edge')) browser = 'Edge'
    else if (ua.includes('opera')) browser = 'Opera'
    
    // Detect platform
    if (ua.includes('win64') || ua.includes('win32')) platform = 'Windows'
    else if (ua.includes('macintosh')) platform = 'Mac'
    else if (ua.includes('x11') || ua.includes('linux')) platform = 'Linux'
    else if (ua.includes('android')) platform = 'Android'
    else if (ua.includes('iphone') || ua.includes('ipad')) platform = 'iOS'
    
    return { type, platform, browser, os }
  }
}

export const deviceService = new DeviceService()