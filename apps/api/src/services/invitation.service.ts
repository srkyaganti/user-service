import { dbManager } from '@user-service/database'
import { 
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  generateToken,
  TOKEN_EXPIRY,
} from '@user-service/shared'
import { EmailService } from './email.service'
import { generateSecureToken } from '../lib/crypto'
import { logger } from '../lib/logger'
import type { OrgRole } from '@user-service/database'

const emailService = EmailService.getInstance()

export interface CreateInvitationDto {
  email: string
  role: OrgRole
  message?: string
  expiresInDays?: number
}

export class InvitationService {
  async createInvitation(
    orgId: string,
    userId: string,
    tenantId: string,
    data: CreateInvitationDto
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Check permissions
    const member = await db.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
      include: {
        user: true,
        organization: true,
      },
    })
    
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
      throw new ForbiddenError('Only owners and admins can send invitations')
    }
    
    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: data.email },
    })
    
    if (existingUser) {
      // Check if already a member
      const existingMember = await db.organizationMember.findUnique({
        where: {
          userId_orgId: {
            userId: existingUser.id,
            orgId,
          },
        },
      })
      
      if (existingMember) {
        throw new ConflictError('User is already a member of this organization')
      }
    }
    
    // Check for existing pending invitation
    const existingInvitation = await db.invitation.findFirst({
      where: {
        orgId,
        email: data.email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
    
    if (existingInvitation) {
      throw new ConflictError('An invitation has already been sent to this email')
    }
    
    // Create invitation
    const token = generateSecureToken(32)
    const expiresInDays = data.expiresInDays || 7
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    
    const invitation = await db.invitation.create({
      data: {
        orgId,
        email: data.email,
        role: data.role,
        invitedBy: userId,
        token,
        expiresAt,
        metadata: data.message ? { message: data.message } : undefined,
      },
    })
    
    // Get tenant info for email
    const tenant = await dbManager.getTenant({ id: tenantId })
    const invitationUrl = `${process.env.APP_URL}/invitations/accept?token=${token}`
    
    // Send invitation email
    await emailService.sendInvitationEmail(data.email, {
      inviterName: (member.user.profile as any)?.name || member.user.email,
      organizationName: member.organization.name,
      invitationUrl,
      message: data.message,
    })
    
    // Log invitation creation
    await db.auditLog.create({
      data: {
        userId,
        action: 'invitation.sent',
        resource: 'invitation',
        resourceId: invitation.id,
        metadata: {
          email: data.email,
          role: data.role,
          orgId,
        },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      invitedBy: {
        id: member.user.id,
        email: member.user.email,
        name: (member.user.profile as any)?.name,
      },
    }
  }
  
  async acceptInvitation(
    token: string,
    userId: string | null,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Find invitation by token
    const invitation = await db.invitation.findUnique({
      where: { token },
      include: {
        organization: true,
      },
    })
    
    if (!invitation) {
      throw new NotFoundError('Invalid invitation token')
    }
    
    if (invitation.acceptedAt) {
      throw new ValidationError('Invitation has already been accepted')
    }
    
    if (invitation.expiresAt < new Date()) {
      throw new ValidationError('Invitation has expired')
    }
    
    let user
    
    // If user is logged in
    if (userId) {
      user = await db.user.findUnique({
        where: { id: userId },
      })
      
      if (!user) {
        throw new NotFoundError('User')
      }
      
      // Check if email matches
      if (user.email !== invitation.email) {
        throw new ValidationError('Invitation was sent to a different email address')
      }
    } else {
      // User needs to register or login
      user = await db.user.findUnique({
        where: { email: invitation.email },
      })
      
      if (!user) {
        // User needs to register first
        return {
          requiresRegistration: true,
          email: invitation.email,
          organization: {
            id: invitation.organization.id,
            name: invitation.organization.name,
            slug: invitation.organization.slug,
          },
        }
      }
    }
    
    // Check if already a member
    const existingMember = await db.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId: user.id,
          orgId: invitation.orgId,
        },
      },
    })
    
    if (existingMember) {
      throw new ConflictError('You are already a member of this organization')
    }
    
    // Add user to organization
    const membership = await db.organizationMember.create({
      data: {
        userId: user.id,
        orgId: invitation.orgId,
        role: invitation.role,
        permissions: this.getDefaultPermissions(invitation.role),
      },
      include: {
        organization: true,
      },
    })
    
    // Update user type if needed
    if (user.userType === 'INDIVIDUAL') {
      await db.user.update({
        where: { id: user.id },
        data: { userType: 'ORGANIZATIONAL' },
      })
    }
    
    // Mark invitation as accepted
    await db.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    })
    
    // Log acceptance
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: 'invitation.accepted',
        resource: 'invitation',
        resourceId: invitation.id,
        metadata: {
          orgId: invitation.orgId,
          role: invitation.role,
        },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return {
      success: true,
      membership,
    }
  }
  
  async getInvitation(token: string, tenantId: string) {
    const db = await dbManager.getClient(tenantId)
    
    const invitation = await db.invitation.findUnique({
      where: { token },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            description: true,
          },
        },
      },
    })
    
    if (!invitation) {
      throw new NotFoundError('Invalid invitation token')
    }
    
    if (invitation.acceptedAt) {
      throw new ValidationError('Invitation has already been accepted')
    }
    
    if (invitation.expiresAt < new Date()) {
      throw new ValidationError('Invitation has expired')
    }
    
    // Get inviter info
    const inviter = await db.user.findUnique({
      where: { id: invitation.invitedBy },
      select: {
        id: true,
        email: true,
        profile: true,
      },
    })
    
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      organization: invitation.organization,
      invitedBy: inviter ? {
        id: inviter.id,
        email: inviter.email,
        name: (inviter.profile as any)?.name,
      } : null,
      message: invitation.metadata?.message,
      expiresAt: invitation.expiresAt,
    }
  }
  
  async listInvitations(
    orgId: string,
    userId: string,
    tenantId: string,
    options?: {
      status?: 'pending' | 'accepted' | 'expired'
      limit?: number
      offset?: number
    }
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Check permissions
    const member = await db.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
    })
    
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
      throw new ForbiddenError('Only owners and admins can view invitations')
    }
    
    const limit = options?.limit || 20
    const offset = options?.offset || 0
    
    const whereClause: any = { orgId }
    
    if (options?.status === 'pending') {
      whereClause.acceptedAt = null
      whereClause.expiresAt = { gt: new Date() }
    } else if (options?.status === 'accepted') {
      whereClause.acceptedAt = { not: null }
    } else if (options?.status === 'expired') {
      whereClause.acceptedAt = null
      whereClause.expiresAt = { lt: new Date() }
    }
    
    const [invitations, total] = await Promise.all([
      db.invitation.findMany({
        where: whereClause,
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        take: limit,
        skip: offset,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      db.invitation.count({ where: whereClause }),
    ])
    
    // Get inviter info
    const inviterIds = [...new Set(invitations.map(i => i.invitedBy))]
    const inviters = await db.user.findMany({
      where: { id: { in: inviterIds } },
      select: {
        id: true,
        email: true,
        profile: true,
      },
    })
    
    const inviterMap = new Map(inviters.map(u => [u.id, u]))
    
    return {
      invitations: invitations.map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.acceptedAt ? 'accepted' : 
                inv.expiresAt < new Date() ? 'expired' : 'pending',
        invitedBy: inviterMap.get(inv.invitedBy) ? {
          id: inv.invitedBy,
          email: inviterMap.get(inv.invitedBy)!.email,
          name: (inviterMap.get(inv.invitedBy)!.profile as any)?.name,
        } : null,
        createdAt: inv.createdAt,
        acceptedAt: inv.acceptedAt,
        expiresAt: inv.expiresAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    }
  }
  
  async revokeInvitation(
    invitationId: string,
    userId: string,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Get invitation
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
    })
    
    if (!invitation) {
      throw new NotFoundError('Invitation')
    }
    
    if (invitation.acceptedAt) {
      throw new ValidationError('Cannot revoke an accepted invitation')
    }
    
    // Check permissions
    const member = await db.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId: invitation.orgId,
        },
      },
    })
    
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
      throw new ForbiddenError('Only owners and admins can revoke invitations')
    }
    
    // Delete invitation
    await db.invitation.delete({
      where: { id: invitationId },
    })
    
    // Log revocation
    await db.auditLog.create({
      data: {
        userId,
        action: 'invitation.revoked',
        resource: 'invitation',
        resourceId: invitationId,
        metadata: {
          email: invitation.email,
          orgId: invitation.orgId,
        },
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return { success: true }
  }
  
  async resendInvitation(
    invitationId: string,
    userId: string,
    tenantId: string
  ) {
    const db = await dbManager.getClient(tenantId)
    
    // Get invitation
    const invitation = await db.invitation.findUnique({
      where: { id: invitationId },
      include: {
        organization: true,
      },
    })
    
    if (!invitation) {
      throw new NotFoundError('Invitation')
    }
    
    if (invitation.acceptedAt) {
      throw new ValidationError('Invitation has already been accepted')
    }
    
    // Check permissions
    const member = await db.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId: invitation.orgId,
        },
      },
      include: {
        user: true,
      },
    })
    
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) {
      throw new ForbiddenError('Only owners and admins can resend invitations')
    }
    
    // Update expiration date
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    
    await db.invitation.update({
      where: { id: invitationId },
      data: { expiresAt: newExpiresAt },
    })
    
    // Resend email
    const invitationUrl = `${process.env.APP_URL}/invitations/accept?token=${invitation.token}`
    
    await emailService.sendInvitationEmail(invitation.email, {
      inviterName: (member.user.profile as any)?.name || member.user.email,
      organizationName: invitation.organization.name,
      invitationUrl,
      message: invitation.metadata?.message,
    })
    
    // Log resend
    await db.auditLog.create({
      data: {
        userId,
        action: 'invitation.resent',
        resource: 'invitation',
        resourceId: invitationId,
        ipAddress: '0.0.0.0',
        userAgent: 'Unknown',
      },
    })
    
    return { 
      success: true,
      expiresAt: newExpiresAt,
    }
  }
  
  private getDefaultPermissions(role: OrgRole): string[] {
    switch (role) {
      case 'OWNER':
        return ['*']
      case 'ADMIN':
        return [
          'org.read',
          'org.update',
          'members.read',
          'members.create',
          'members.update',
          'members.delete',
          'teams.read',
          'teams.create',
          'teams.update',
          'teams.delete',
        ]
      case 'MEMBER':
        return [
          'org.read',
          'members.read',
          'teams.read',
        ]
      case 'GUEST':
        return ['org.read']
      default:
        return []
    }
  }
}

export const invitationService = new InvitationService()