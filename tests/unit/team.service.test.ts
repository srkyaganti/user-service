import { dbManager } from "@user-service/database";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@user-service/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventService } from "../../apps/api/src/services/event.service";
import { TeamService } from "../../apps/api/src/services/team.service";
import { mockDbOperations, mockEvents } from "../helpers/test-utils";

// Mock dependencies
vi.mock("@user-service/database");
vi.mock("../../apps/api/src/services/event.service");

describe("TeamService", () => {
	let teamService: TeamService;

	const mockTeam = {
		id: "team-123",
		name: "Engineering Team",
		description: "Engineering team description",
		organizationId: "org-123",
		permissions: ["repos.read", "repos.write"],
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	const mockMembership = {
		id: "membership-123",
		userId: "user-123",
		organizationId: "org-123",
		role: "ADMIN",
	};

	const mockTeamMembership = {
		id: "team-membership-123",
		userId: "user-123",
		teamId: "team-123",
		role: "member",
		joinedAt: new Date(),
	};

	beforeEach(() => {
		teamService = new TeamService();
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(dbManager.getClient).mockResolvedValue(mockDbOperations as any);
		vi.mocked(EventService.getInstance).mockReturnValue(mockEvents as any);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("createTeam", () => {
		it("should successfully create team", async () => {
			// Arrange
			const createData = {
				name: "New Team",
				description: "New team description",
				permissions: ["repos.read"],
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.team.create.mockResolvedValue({
				...mockTeam,
				...createData,
				members: [mockTeamMembership],
			});

			// Act
			const result = await teamService.createTeam(
				"tenant-123",
				"user-123",
				"org-123",
				createData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					name: createData.name,
					description: createData.description,
					permissions: createData.permissions,
				}),
			);

			expect(mockDbOperations.team.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					...createData,
					organizationId: "org-123",
				}),
				include: { members: { include: { user: true } } },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError for insufficient permissions", async () => {
			// Arrange
			const memberMembership = {
				...mockMembership,
				role: "MEMBER",
			};

			const createData = {
				name: "New Team",
				description: "Description",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(memberMembership);

			// Act & Assert
			await expect(
				teamService.createTeam("tenant-123", "user-123", "org-123", createData),
			).rejects.toThrow(ForbiddenError);

			expect(mockDbOperations.team.create).not.toHaveBeenCalled();
		});

		it("should throw NotFoundError for non-member user", async () => {
			// Arrange
			const createData = {
				name: "New Team",
				description: "Description",
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				teamService.createTeam("tenant-123", "user-123", "org-123", createData),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("getTeam", () => {
		it("should successfully get team", async () => {
			// Arrange
			const teamWithMembers = {
				...mockTeam,
				members: [
					{
						...mockTeamMembership,
						user: {
							id: "user-123",
							email: "test@example.com",
							profile: { name: "Test User" },
						},
					},
				],
				organization: {
					id: "org-123",
					name: "Test Org",
				},
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.team.findUnique.mockResolvedValue(teamWithMembers);

			// Act
			const result = await teamService.getTeam(
				"tenant-123",
				"user-123",
				"team-123",
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: mockTeam.id,
					name: mockTeam.name,
					members: expect.arrayContaining([
						expect.objectContaining({
							user: expect.objectContaining({ id: "user-123" }),
							role: mockTeamMembership.role,
						}),
					]),
				}),
			);
		});

		it("should throw NotFoundError for non-existent team", async () => {
			// Arrange
			mockDbOperations.team.findUnique.mockResolvedValue(null);

			// Act & Assert
			await expect(
				teamService.getTeam("tenant-123", "user-123", "non-existent"),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw ForbiddenError for non-organization member", async () => {
			// Arrange
			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				teamService.getTeam("tenant-123", "user-123", "team-123"),
			).rejects.toThrow(ForbiddenError);
		});
	});

	describe("updateTeam", () => {
		it("should successfully update team", async () => {
			// Arrange
			const updateData = {
				name: "Updated Team Name",
				description: "Updated description",
				permissions: ["repos.read", "repos.write", "issues.read"],
			};

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.team.update.mockResolvedValue({
				...mockTeam,
				...updateData,
			});

			// Act
			const result = await teamService.updateTeam(
				"tenant-123",
				"user-123",
				"team-123",
				updateData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					name: updateData.name,
					description: updateData.description,
					permissions: updateData.permissions,
				}),
			);

			expect(mockDbOperations.team.update).toHaveBeenCalledWith({
				where: { id: "team-123" },
				data: updateData,
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError for insufficient permissions", async () => {
			// Arrange
			const memberMembership = {
				...mockMembership,
				role: "MEMBER",
			};

			const updateData = { name: "Updated Name" };

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(memberMembership);

			// Act & Assert
			await expect(
				teamService.updateTeam(
					"tenant-123",
					"user-123",
					"team-123",
					updateData,
				),
			).rejects.toThrow(ForbiddenError);

			expect(mockDbOperations.team.update).not.toHaveBeenCalled();
		});
	});

	describe("deleteTeam", () => {
		it("should successfully delete team", async () => {
			// Arrange
			const adminMembership = {
				...mockMembership,
				role: "ADMIN",
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(adminMembership);
			mockDbOperations.team.delete.mockResolvedValue(mockTeam);

			// Act
			const result = await teamService.deleteTeam(
				"tenant-123",
				"user-123",
				"team-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.team.delete).toHaveBeenCalledWith({
				where: { id: "team-123" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw ForbiddenError for insufficient permissions", async () => {
			// Arrange
			const memberMembership = {
				...mockMembership,
				role: "MEMBER",
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(memberMembership);

			// Act & Assert
			await expect(
				teamService.deleteTeam("tenant-123", "user-123", "team-123"),
			).rejects.toThrow(ForbiddenError);

			expect(mockDbOperations.team.delete).not.toHaveBeenCalled();
		});
	});

	describe("listTeams", () => {
		it("should return organization teams", async () => {
			// Arrange
			const teams = [
				mockTeam,
				{
					...mockTeam,
					id: "team-456",
					name: "Another Team",
				},
			];

			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.team.findMany.mockResolvedValue(teams);

			// Act
			const result = await teamService.listTeams(
				"tenant-123",
				"user-123",
				"org-123",
			);

			// Assert
			expect(result).toEqual({
				teams: expect.arrayContaining([
					expect.objectContaining({ id: "team-123" }),
					expect.objectContaining({ id: "team-456" }),
				]),
			});

			expect(mockDbOperations.team.findMany).toHaveBeenCalledWith({
				where: { organizationId: "org-123" },
				orderBy: { createdAt: "desc" },
			});
		});

		it("should support pagination", async () => {
			// Arrange
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.team.findMany.mockResolvedValue([]);

			// Act
			const result = await teamService.listTeams(
				"tenant-123",
				"user-123",
				"org-123",
				{ limit: 10, offset: 20 },
			);

			// Assert
			expect(mockDbOperations.team.findMany).toHaveBeenCalledWith({
				where: { organizationId: "org-123" },
				take: 10,
				skip: 20,
				orderBy: { createdAt: "desc" },
			});
		});
	});

	describe("addTeamMember", () => {
		it("should successfully add member to team", async () => {
			// Arrange
			const newMemberData = {
				email: "newmember@example.com",
				role: "member" as const,
			};

			const newUser = {
				id: "new-user-123",
				email: newMemberData.email,
			};

			const orgMembership = {
				id: "org-membership-123",
				userId: newUser.id,
				organizationId: "org-123",
				role: "MEMBER",
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(orgMembership); // Org membership check

			mockDbOperations.user.findUnique.mockResolvedValue(newUser);
			mockDbOperations.teamMembership.findFirst.mockResolvedValue(null); // No existing team membership
			mockDbOperations.teamMembership.create.mockResolvedValue({
				id: "new-team-membership-123",
				userId: newUser.id,
				teamId: "team-123",
				role: newMemberData.role,
				user: newUser,
			});

			// Act
			const result = await teamService.addTeamMember(
				"tenant-123",
				"user-123",
				"team-123",
				newMemberData,
			);

			// Assert
			expect(result).toEqual(
				expect.objectContaining({
					id: "new-team-membership-123",
					role: newMemberData.role,
					user: expect.objectContaining({ email: newMemberData.email }),
				}),
			);

			expect(mockDbOperations.teamMembership.create).toHaveBeenCalledWith({
				data: {
					userId: newUser.id,
					teamId: "team-123",
					role: newMemberData.role,
				},
				include: { user: true },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw NotFoundError for user not in organization", async () => {
			// Arrange
			const newMemberData = {
				email: "outsider@example.com",
				role: "member" as const,
			};

			const outsideUser = {
				id: "outside-user-123",
				email: newMemberData.email,
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst
				.mockResolvedValueOnce(mockMembership) // Permission check
				.mockResolvedValueOnce(null); // No org membership

			mockDbOperations.user.findUnique.mockResolvedValue(outsideUser);

			// Act & Assert
			await expect(
				teamService.addTeamMember(
					"tenant-123",
					"user-123",
					"team-123",
					newMemberData,
				),
			).rejects.toThrow(NotFoundError);
		});

		it("should throw ConflictError for existing team member", async () => {
			// Arrange
			const existingMemberData = {
				email: "existing@example.com",
				role: "member" as const,
			};

			const existingUser = {
				id: "existing-user-123",
				email: existingMemberData.email,
			};

			const existingTeamMembership = {
				id: "existing-team-membership-123",
				userId: existingUser.id,
				teamId: "team-123",
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.user.findUnique.mockResolvedValue(existingUser);
			mockDbOperations.teamMembership.findFirst.mockResolvedValue(
				existingTeamMembership,
			);

			// Act & Assert
			await expect(
				teamService.addTeamMember(
					"tenant-123",
					"user-123",
					"team-123",
					existingMemberData,
				),
			).rejects.toThrow(ConflictError);
		});
	});

	describe("removeTeamMember", () => {
		it("should successfully remove member from team", async () => {
			// Arrange
			const targetTeamMembership = {
				id: "target-team-membership-123",
				userId: "target-user-123",
				teamId: "team-123",
				role: "member",
			};

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.teamMembership.findFirst.mockResolvedValue(
				targetTeamMembership,
			);
			mockDbOperations.teamMembership.delete.mockResolvedValue(
				targetTeamMembership,
			);

			// Act
			const result = await teamService.removeTeamMember(
				"tenant-123",
				"user-123",
				"team-123",
				"target-team-membership-123",
			);

			// Assert
			expect(result).toEqual({ success: true });
			expect(mockDbOperations.teamMembership.delete).toHaveBeenCalledWith({
				where: { id: "target-team-membership-123" },
			});
			expect(mockEvents.publish).toHaveBeenCalled();
		});

		it("should throw NotFoundError for non-existent team membership", async () => {
			// Arrange
			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.teamMembership.findFirst.mockResolvedValue(null);

			// Act & Assert
			await expect(
				teamService.removeTeamMember(
					"tenant-123",
					"user-123",
					"team-123",
					"non-existent-membership",
				),
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("getTeamMembers", () => {
		it("should return team members", async () => {
			// Arrange
			const teamMembers = [
				{
					...mockTeamMembership,
					user: {
						id: "user-123",
						email: "member1@example.com",
						profile: { name: "Member 1" },
					},
				},
				{
					id: "team-membership-456",
					userId: "user-456",
					teamId: "team-123",
					role: "lead",
					user: {
						id: "user-456",
						email: "member2@example.com",
						profile: { name: "Member 2" },
					},
				},
			];

			mockDbOperations.team.findUnique.mockResolvedValue(mockTeam);
			mockDbOperations.membership.findFirst.mockResolvedValue(mockMembership);
			mockDbOperations.teamMembership.findMany.mockResolvedValue(teamMembers);

			// Act
			const result = await teamService.getTeamMembers(
				"tenant-123",
				"user-123",
				"team-123",
			);

			// Assert
			expect(result).toEqual({
				members: expect.arrayContaining([
					expect.objectContaining({
						role: "member",
						user: expect.objectContaining({ email: "member1@example.com" }),
					}),
					expect.objectContaining({
						role: "lead",
						user: expect.objectContaining({ email: "member2@example.com" }),
					}),
				]),
			});
		});
	});
});
