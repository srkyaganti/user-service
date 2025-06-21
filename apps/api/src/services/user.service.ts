import { dbManager } from "@user-service/database";
import {
	ConflictError,
	NotFoundError,
	ValidationError,
	hashPassword,
	verifyPassword,
} from "@user-service/shared";
import { logger } from "../lib/logger";
import { deleteFile, uploadFile } from "../lib/storage";

/**
 * DTO for updating user profile information
 */
export interface UpdateProfileDto {
	name?: string;
	bio?: string;
	phone?: string;
	location?: string;
	website?: string;
	company?: string;
	jobTitle?: string;
	preferences?: Record<string, any>;
	metadata?: Record<string, any>;
}

/**
 * DTO for changing user password
 */
export interface ChangePasswordDto {
	currentPassword: string;
	newPassword: string;
}

/**
 * DTO for uploading user avatar
 */
export interface UploadAvatarDto {
	file: File;
	userId: string;
}

/**
 * UserService handles all user-related operations including:
 * - Profile management
 * - Password changes
 * - Avatar uploads
 * - User search and listing
 */
export class UserService {
	/**
	 * Retrieves a user's profile information
	 * @param userId - The user identifier
	 * @param tenantId - The tenant identifier
	 * @returns User profile data with organization memberships
	 * @throws NotFoundError if user doesn't exist
	 */
	async getProfile(userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		const user = await db.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				profile: true,
				userType: true,
				createdAt: true,
				updatedAt: true,
				memberships: {
					include: {
						organization: {
							select: {
								id: true,
								name: true,
								slug: true,
								logo: true,
							},
						},
					},
				},
				socialAuths: {
					select: {
						provider: true,
						email: true,
						createdAt: true,
					},
				},
				mfaSettings: {
					where: { enabled: true },
					select: {
						type: true,
						createdAt: true,
						lastUsedAt: true,
					},
				},
				_count: {
					select: {
						devices: true,
						sessions: true,
					},
				},
			},
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		return user;
	}

	async updateProfile(
		userId: string,
		tenantId: string,
		data: UpdateProfileDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get current profile
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		const currentProfile = (user.profile as any) || {};

		// Merge profile data
		const updatedProfile = {
			...currentProfile,
			...data,
			updatedAt: new Date(),
		};

		// Update user profile
		const updatedUser = await db.user.update({
			where: { id: userId },
			data: {
				profile: updatedProfile,
			},
			select: {
				id: true,
				email: true,
				profile: true,
				userType: true,
				updatedAt: true,
			},
		});

		// Log update
		await db.auditLog.create({
			data: {
				userId,
				action: "profile.updated",
				resource: "user",
				resourceId: userId,
				metadata: { fields: Object.keys(data) },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return updatedUser;
	}

	async changePassword(
		userId: string,
		tenantId: string,
		data: ChangePasswordDto,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get user with password
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		// Check if user has a password (might be social auth only)
		if (!user.passwordHash) {
			throw new ValidationError("No password set for this account");
		}

		// Verify current password
		const isValid = await verifyPassword(
			data.currentPassword,
			user.passwordHash,
		);
		if (!isValid) {
			throw new ValidationError("Current password is incorrect");
		}

		// Validate new password
		if (data.newPassword.length < 8) {
			throw new ValidationError("Password must be at least 8 characters long");
		}

		// Hash new password
		const hashedPassword = await hashPassword(data.newPassword);

		// Update password
		await db.user.update({
			where: { id: userId },
			data: { passwordHash: hashedPassword },
		});

		// Invalidate all sessions except current
		// This would be done by checking the current session token

		// Log password change
		await db.auditLog.create({
			data: {
				userId,
				action: "password.changed",
				resource: "user",
				resourceId: userId,
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return { success: true };
	}

	async uploadAvatar(userId: string, tenantId: string, file: File) {
		const db = await dbManager.getClient(tenantId);

		// Validate file
		const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
		if (!allowedTypes.includes(file.type)) {
			throw new ValidationError(
				"Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed",
			);
		}

		if (file.size > 5 * 1024 * 1024) {
			// 5MB
			throw new ValidationError("File size must be less than 5MB");
		}

		// Get current user
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		const currentProfile = (user.profile as any) || {};

		// Delete old avatar if exists
		if (currentProfile.avatarUrl) {
			try {
				await deleteFile(currentProfile.avatarUrl);
			} catch (error) {
				logger.error({ error }, "Failed to delete old avatar");
			}
		}

		// Upload new avatar
		const avatarUrl = await uploadFile(file, `avatars/${userId}`);

		// Update profile
		const updatedUser = await db.user.update({
			where: { id: userId },
			data: {
				profile: {
					...currentProfile,
					avatarUrl,
					avatarUpdatedAt: new Date(),
				},
			},
			select: {
				id: true,
				email: true,
				profile: true,
			},
		});

		// Log avatar update
		await db.auditLog.create({
			data: {
				userId,
				action: "avatar.updated",
				resource: "user",
				resourceId: userId,
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return updatedUser;
	}

	async deleteAvatar(userId: string, tenantId: string) {
		const db = await dbManager.getClient(tenantId);

		// Get current user
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		const currentProfile = (user.profile as any) || {};

		if (!currentProfile.avatarUrl) {
			throw new ValidationError("No avatar to delete");
		}

		// Delete avatar file
		try {
			await deleteFile(currentProfile.avatarUrl);
		} catch (error) {
			logger.error({ error }, "Failed to delete avatar file");
		}

		// Update profile
		const updatedUser = await db.user.update({
			where: { id: userId },
			data: {
				profile: {
					...currentProfile,
					avatarUrl: null,
					avatarUpdatedAt: new Date(),
				},
			},
			select: {
				id: true,
				email: true,
				profile: true,
			},
		});

		// Log avatar deletion
		await db.auditLog.create({
			data: {
				userId,
				action: "avatar.deleted",
				resource: "user",
				resourceId: userId,
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		return updatedUser;
	}

	async updateEmail(
		userId: string,
		tenantId: string,
		newEmail: string,
		password?: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get user
		const user = await db.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		// Check if new email is already taken
		const existingUser = await db.user.findUnique({
			where: { email: newEmail },
		});

		if (existingUser) {
			throw new ConflictError("Email address is already in use");
		}

		// If user has password, verify it
		if (user.passwordHash && password) {
			const isValid = await verifyPassword(password, user.passwordHash);
			if (!isValid) {
				throw new ValidationError("Password is incorrect");
			}
		} else if (user.passwordHash && !password) {
			throw new ValidationError("Password is required to change email");
		}

		// Generate email change token and send verification email
		// For now, we'll update directly (in production, this should require email verification)

		const currentProfile = (user.profile as any) || {};

		// Update email
		const updatedUser = await db.user.update({
			where: { id: userId },
			data: {
				email: newEmail,
				profile: {
					...currentProfile,
					emailVerified: false, // Require re-verification
					emailVerifiedAt: null,
					previousEmail: user.email,
					emailChangedAt: new Date(),
				},
			},
		});

		// Log email change
		await db.auditLog.create({
			data: {
				userId,
				action: "email.changed",
				resource: "user",
				resourceId: userId,
				metadata: {
					from: user.email,
					to: newEmail,
				},
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		// TODO: Send verification email to new address
		// TODO: Send notification to old email address

		return {
			success: true,
			message: "Email updated. Please verify your new email address.",
		};
	}

	async deleteAccount(
		userId: string,
		tenantId: string,
		password?: string,
		reason?: string,
	) {
		const db = await dbManager.getClient(tenantId);

		// Get user with all relations
		const user = await db.user.findUnique({
			where: { id: userId },
			include: {
				memberships: {
					include: {
						organization: {
							include: {
								_count: {
									select: {
										members: true,
									},
								},
							},
						},
					},
				},
			},
		});

		if (!user) {
			throw new NotFoundError("User");
		}

		// Verify password if user has one
		if (user.passwordHash && password) {
			const isValid = await verifyPassword(password, user.passwordHash);
			if (!isValid) {
				throw new ValidationError("Password is incorrect");
			}
		} else if (user.passwordHash && !password) {
			throw new ValidationError("Password is required to delete account");
		}

		// Check if user is the only owner of any organizations
		for (const membership of user.memberships) {
			if (membership.role === "OWNER") {
				const ownerCount = await db.organizationMember.count({
					where: {
						orgId: membership.orgId,
						role: "OWNER",
					},
				});

				if (ownerCount === 1) {
					throw new ValidationError(
						`You are the only owner of "${membership.organization.name}". Please transfer ownership or delete the organization first.`,
					);
				}
			}
		}

		// Soft delete user (preserves audit trail)
		await db.user.update({
			where: { id: userId },
			data: {
				deletedAt: new Date(),
				email: `deleted_${userId}_${user.email}`, // Prevent email conflicts
			},
		});

		// Log account deletion
		await db.auditLog.create({
			data: {
				userId,
				action: "account.deleted",
				resource: "user",
				resourceId: userId,
				metadata: { reason },
				ipAddress: "0.0.0.0",
				userAgent: "Unknown",
			},
		});

		// Invalidate all sessions
		await db.session.deleteMany({
			where: { userId },
		});

		// TODO: Queue job to clean up user data after grace period
		// TODO: Send confirmation email

		return {
			success: true,
			message: "Your account has been scheduled for deletion.",
		};
	}

	async searchUsers(
		query: string,
		tenantId: string,
		options?: {
			limit?: number;
			offset?: number;
			organizationId?: string;
		},
	) {
		const db = await dbManager.getClient(tenantId);

		const limit = options?.limit || 20;
		const offset = options?.offset || 0;

		const whereClause: any = {
			OR: [
				{ email: { contains: query, mode: "insensitive" } },
				{ profile: { path: ["name"], string_contains: query } },
			],
			deletedAt: null,
		};

		// Filter by organization if specified
		if (options?.organizationId) {
			whereClause.memberships = {
				some: {
					orgId: options.organizationId,
				},
			};
		}

		const [users, total] = await Promise.all([
			db.user.findMany({
				where: whereClause,
				select: {
					id: true,
					email: true,
					profile: true,
					userType: true,
				},
				take: limit,
				skip: offset,
				orderBy: {
					email: "asc",
				},
			}),
			db.user.count({ where: whereClause }),
		]);

		return {
			users,
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + limit < total,
			},
		};
	}
}

export const userService = new UserService();
