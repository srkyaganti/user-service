import { dbManager } from "@user-service/database";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventService } from "../../apps/api/src/services/event.service";
import { OrganizationService } from "../../apps/api/src/services/organization.service";
import {
	mockDbOperations,
	mockEvents,
	mockOrganization,
	mockUser,
} from "../helpers/test-utils";

// Mock dependencies
vi.mock("@user-service/database");
vi.mock("../../apps/api/src/services/event.service");

describe("OrganizationService", () => {
	let organizationService: OrganizationService;

	const mockMembership = {
		id: "membership-123",
		userId: "user-123",
		organizationId: "org-123",
		role: "OWNER",
		joinedAt: new Date(),
	};

	beforeEach(() => {
		organizationService = new OrganizationService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("createOrganization", () => {
		it("should successfully create organization", async () => {
			// Arrange
			const createData = {
				name: "Test Organization",
				slug: "test-org",
				description: "Test organization description",
			};

			mockDbOperations.organization.findUnique.mockResolvedValue(null); // No existing org
			mockDbOperations.organization.create.mockResolvedValue({
				...mockOrganization,
				...createData,
				memberships: [mockMembership],
			});

			// Act
			const result = await organizationService.createOrganization(
				"tenant-123",
				"user-123",
				createData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: mockOrganization.id,
					name: createData.name,
					slug: createData.slug,
				}),
			);

			expect(mockDbOperations.organization.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					...createData,
					memberships: {
						create: {
							userId: "user-123",
							role: "OWNER",
						},
					},
				}),
				include: { memberships: true },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ConflictError for duplicate slug", async () => {
			// Arrange
			const createData = {
				name: "Test Organization",
				slug: "existing-slug",
				description: "Test description",
			};

			mockDbOperations.organization.findUnique.mockResolvedValue(
				mockOrganization,
			);

			// Act & Assert
			await expect(
				organizationService.createOrganization(
					"tenant-123",
					"user-123",
					createData,
				),
			).rejects.toThrow(ConflictError);

			expect(mockDbOperations.organization.findUnique).toHaveBeenCalledWith({
				where: { slug: createData.slug },
			});
			expect(mockDbOperations.organization.create).not.toHaveBeenCalled();
		});

		it("should auto-generate slug from name if not provided", async () => {
			// Arrange
			const createData = {
				name: "Test Organization Name",
				description: "Test description",
			};

			mockDbOperations.organization.findUnique.mockResolvedValue(null);
			mockDbOperations.organization.create.mockResolvedValue({
				...mockOrganization,
				...createData,
				slug: "test-organization-name",
			});

			// Act
			await organizationService.createOrganization(
				"tenant-123",
				"user-123",
				createData,
			);

			// Assert
			expect(mockDbOperations.organization.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					slug: expect.stringMatching(/test-organization-name/),
				}),
				include: { memberships: true },
			});
		});
	});

	describe("getOrganization", () => {
		it("should successfully get organization", async () => {
			// Arrange
			const orgWithMembers = {
				...mockOrganization,
				memberships: [
					{
						...mockMembership,
						user: mockUser,
					},
				],
				teams: [],
			};

			mockDbOperations.organization.findUnique.mockResolvedValue(
				orgWithMembers,
			);
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);

			// Act
			const result = await organizationService.getOrganization(
				"tenant-123",
				"user-123",
				"org-123",
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: mockOrganization.id,
					name: mockOrganization.name,
					members: expect.arrayContaining([
						expect.objectContaining({
							user: expect.objectContaining({ id: mockUser.id }),
							role: mockMembership.role,
						}),
					]),
				}),
			);
		});

		it("should throw NotFoundError for non-existent organization", async () => {
			// Arrange
			mockDbOperations.organization.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				organizationService.getOrganization(
					"tenant-123",
					"user-123",
					"non-existent",
				),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw ForbiddenError for non-member user", async () => {
			// Arrange
			mockDbOperations.organization.findUnique.mockResolvedValue(
				mockOrganization,
			);
			mockDbOperations.membership.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				organizationService.getOrganization(
					"tenant-123",
					"user-123",
					"org-123",
				),
			).rejects.toThrow(ForbiddenError);
		});
	});

	describe("updateOrganization", () => {
		it("should successfully update organization", async () => {
			// Arrange
			const updateData = {
				name: "Updated Organization Name",
				description: "Updated description",
			};

			const membershipWithPermissions = {
				...mockMembership,
				role: "ADMIN",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(
				membershipWithPermissions,
			);
			mockDbOperations.organization.update.mockResolvedValue({
				...mockOrganization,
				...updateData,
			});

			// Act
			const result = await organizationService.updateOrganization(
				"tenant-123",
				"user-123",
				"org-123",
				updateData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					name: updateData.name,
					description: updateData.description,
				}),
			);

			expect(mockDbOperations.organization.update).toHaveBeenCalledWith({
				where: { id: "org-123" },
				data: updateData,
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError for insufficient permissions", async () => {
			// Arrange
			const updateData = { name: "Updated Name" };

			const membershipWithoutPermissions = {
				...mockMembership,
				role: "MEMBER",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(
				membershipWithoutPermissions,
			);

			// Act & Assert
			await expect(
				organizationService.updateOrganization(
					"tenant-123",
					"user-123",
					"org-123",
					updateData,
				),
			).rejects.toThrow(ForbiddenError);

			expect(mockDbOperations.organization.update).not.toHaveBeenCalled();
		});

		it("should throw ConflictError for duplicate slug update", async () => {
			// Arrange
			const updateData = { slug: "existing-slug" };

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.organization.findFirst.mockResolvedValue(
				mockOrganization,
			);

			// Act & Assert
			await expect(
				organizationService.updateOrganization(
					"tenant-123",
					"user-123",
					"org-123",
					updateData,
				),
			).rejects.toThrow(ConflictError);
		});
	});

	describe("deleteOrganization", () => {
		it("should successfully delete organization", async () => {
			// Arrange
			const ownerMembership = {
				...mockMembership,
				role: "OWNER",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(ownerMembership);
			mockDbOperations.organization.delete.mockResolvedValue(mockOrganization);

			// Act
			const result = await organizationService.deleteOrganization(
				"tenant-123",
				"user-123",
				"org-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.organization.delete).toHaveBeenCalledWith({
				where: { id: "org-123" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError for non-owner", async () => {
			// Arrange
			const nonOwnerMembership = {
				...mockMembership,
				role: "ADMIN",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(
				nonOwnerMembership,
			);

			// Act & Assert
			await expect(
				organizationService.deleteOrganization(
					"tenant-123",
					"user-123",
					"org-123",
				),
			).rejects.toThrow(ForbiddenError);

			expect(mockDbOperations.organization.delete).not.toHaveBeenCalled();
		});
	});

	describe("listOrganizations", () => {
		it("should return user organizations", async () => {
			// Arrange
			const userMemberships = [
				{
					organization: mockOrganization,
					role: "OWNER",
					joinedAt: new Date(),
				},
			];

			mockDbOperations.membership.findMany.mockResolvedValue(userMemberships);

			// Act
			const result = await organizationService.listOrganizations(
				"tenant-123",
				"user-123",
			);

			// Assert
			expect(result).toEqual({
				organizations: expect.arrayContaining([
					expect.objectContaining({
						...mockOrganization,
						role: "OWNER",
					}),
				]),
			});
		});

		it("should support pagination", async () => {
			// Arrange
			const userMemberships = [];

			mockDbOperations.membership.findMany.mockResolvedValue(userMemberships);

			// Act
			const result = await organizationService.listOrganizations(
				"tenant-123",
				"user-123",
				{ limit: 10, offset: 20 },
			);

			// Assert
			expect(mockDbOperations.membership.findMany).toHaveBeenCalledWith({
				where: { userId: "user-123" },
				include: { organization: true },
				take: 10,
				skip: 20,
				orderBy: { joinedAt: "desc" },
			});
		});
	});

	describe("addMember", () => {
		it("should successfully add member to organization", async () => {
			// Arrange
			const newMemberData = {
				email: "newmember@example.com",
				role: "MEMBER" as const,
			};

			const adminMembership = {
				...mockMembership,
				role: "ADMIN",
			};

			const newUser = {
				id: "new-user-123",
				email: newMemberData.email,
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(adminMembership) // Permission check
				.mockResolvedValueOnce(null); // Existing membership check

			mockDbOperations.user.findUnique.mockResolvedValue(newUser);
			mockDbOperations.membership.create.mockResolvedValue({
				id: "new-membership-123",
				userId: newUser.id,
				organizationId: "org-123",
				role: newMemberData.role,
				user: newUser,
			});

			// Act
			const result = await organizationService.addMember(
				"tenant-123",
				"user-123",
				"org-123",
				newMemberData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: "new-membership-123",
					role: newMemberData.role,
					user: expect.objectContaining({ email: newMemberData.email }),
				}),
			);

			expect(mockDbOperations.membership.create).toHaveBeenCalledWith({
				data: {
					userId: newUser.id,
					organizationId: "org-123",
					role: newMemberData.role,
				},
				include: { user: true },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw NotFoundError for non-existent user", async () => {
			// Arrange
			const newMemberData = {
				email: "nonexistent@example.com",
				role: "MEMBER" as const,
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.user.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				organizationService.addMember(
					"tenant-123",
					"user-123",
					"org-123",
					newMemberData,
				),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw ConflictError for existing member", async () => {
			// Arrange
			const existingMemberData = {
				email: "existing@example.com",
				role: "MEMBER" as const,
			};

			const existingUser = {
				id: "existing-user-123",
				email: existingMemberData.email,
			};

			const existingMembership = {
				id: "existing-membership-123",
				userId: existingUser.id,
				organizationId: "org-123",
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(existingMembership); // Existing membership check

			mockDbOperations.user.findUnique.mockResolvedValue(existingUser);

			// Act & Assert
			await expect(
				organizationService.addMember(
					"tenant-123",
					"user-123",
					"org-123",
					existingMemberData,
				),
			).rejects.toThrow(ConflictError);
		});
	});

	describe("updateMemberRole", () => {
		it("should successfully update member role", async () => {
			// Arrange
			const targetMembership = {
				id: "target-membership-123",
				userId: "target-user-123",
				organizationId: "org-123",
				role: "MEMBER",
			};

			const adminMembership = {
				...mockMembership,
				role: "ADMIN",
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(adminMembership) // Permission check
				.mockResolvedValueOnce(targetMembership); // Target membership

			mockDbOperations.membership.update.mockResolvedValue({
				...targetMembership,
				role: "ADMIN",
			});

			// Act
			const result = await organizationService.updateMemberRole(
				"tenant-123",
				"user-123",
				"org-123",
				"target-membership-123",
				"ADMIN",
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					role: "ADMIN",
				}),
			);

			expect(mockDbOperations.membership.update).toHaveBeenCalledWith({
				where: { id: "target-membership-123" },
				data: { role: "ADMIN" },
				include: { user: true },
			});
		});

		it("should throw ForbiddenError when trying to change owner role", async () => {
			// Arrange
			const ownerMembership = {
				id: "owner-membership-123",
				userId: "owner-user-123",
				organizationId: "org-123",
				role: "OWNER",
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(ownerMembership); // Target membership

			// Act & Assert
			await expect(
				organizationService.updateMemberRole(
					"tenant-123",
					"user-123",
					"org-123",
					"owner-membership-123",
					"ADMIN",
				),
			).rejects.toThrow(ForbiddenError);
		});
	});

	describe("removeMember", () => {
		it("should successfully remove member from organization", async () => {
			// Arrange
			const targetMembership = {
				id: "target-membership-123",
				userId: "target-user-123",
				organizationId: "org-123",
				role: "MEMBER",
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(targetMembership); // Target membership

			mockDbOperations.membership.delete.mockResolvedValue(targetMembership);

			// Act
			const result = await organizationService.removeMember(
				"tenant-123",
				"user-123",
				"org-123",
				"target-membership-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.membership.delete).toHaveBeenCalledWith({
				where: { id: "target-membership-123" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError when trying to remove owner", async () => {
			// Arrange
			const ownerMembership = {
				id: "owner-membership-123",
				userId: "owner-user-123",
				organizationId: "org-123",
				role: "OWNER",
			};

			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(ownerMembership); // Target membership

			// Act & Assert
			await expect(
				organizationService.removeMember(
					"tenant-123",
					"user-123",
					"org-123",
					"owner-membership-123",
				),
			).rejects.toThrow(ForbiddenError);
		});
	});
});
