import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authMiddleware } from "../middleware/auth";
import { teamService } from "../services/team.service";

const app = new OpenAPIHono();

// Create team
const createTeamRoute = createRoute({
	method: "post",
	path: "/organizations/:orgId/teams",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(50),
						description: z.string().max(200).optional(),
						permissions: z.array(z.string()).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Team created",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							orgId: z.string(),
							name: z.string(),
							description: z.string().nullable(),
							permissions: z.array(z.string()),
							createdAt: z.string(),
						}),
					}),
				},
			},
		},
		403: {
			description: "Insufficient permissions",
		},
		409: {
			description: "Team name already exists",
		},
	},
});

app.openapi(createTeamRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { orgId } = c.req.valid("param");
	const body = c.req.valid("json");

	const team = await teamService.createTeam(orgId, user.id, tenantId, body);

	return c.json(
		{
			success: true,
			data: team,
		},
		201,
	);
});

// List teams
const listTeamsRoute = createRoute({
	method: "get",
	path: "/organizations/:orgId/teams",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "List of teams",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.array(
							z.object({
								id: z.string(),
								orgId: z.string(),
								name: z.string(),
								description: z.string().nullable(),
								permissions: z.array(z.string()),
								isMember: z.boolean(),
								memberRole: z.string().optional(),
								_count: z.object({
									members: z.number(),
								}),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
		},
		403: {
			description: "Not a member of this organization",
		},
	},
});

app.openapi(listTeamsRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { orgId } = c.req.valid("param");

	const teams = await teamService.listTeams(orgId, user.id, tenantId);

	return c.json({
		success: true,
		data: teams,
	});
});

// Get team details
const getTeamRoute = createRoute({
	method: "get",
	path: "/teams/:teamId",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Team details",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.object({
							id: z.string(),
							orgId: z.string(),
							name: z.string(),
							description: z.string().nullable(),
							permissions: z.array(z.string()),
							organization: z.object({
								id: z.string(),
								name: z.string(),
								slug: z.string(),
							}),
							_count: z.object({
								members: z.number(),
							}),
							createdAt: z.string(),
							updatedAt: z.string(),
						}),
					}),
				},
			},
		},
		403: {
			description: "Not a member of the organization",
		},
		404: {
			description: "Team not found",
		},
	},
});

app.openapi(getTeamRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId } = c.req.valid("param");

	const team = await teamService.getTeam(teamId, user.id, tenantId);

	return c.json({
		success: true,
		data: team,
	});
});

// Update team
const updateTeamRoute = createRoute({
	method: "patch",
	path: "/teams/:teamId",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(50).optional(),
						description: z.string().max(200).optional(),
						permissions: z.array(z.string()).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Team updated",
		},
		403: {
			description: "Insufficient permissions",
		},
		409: {
			description: "Team name already exists",
		},
	},
});

app.openapi(updateTeamRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId } = c.req.valid("param");
	const body = c.req.valid("json");

	const team = await teamService.updateTeam(teamId, user.id, tenantId, body);

	return c.json({
		success: true,
		data: team,
	});
});

// Delete team
const deleteTeamRoute = createRoute({
	method: "delete",
	path: "/teams/:teamId",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Team deleted",
		},
		403: {
			description: "Insufficient permissions",
		},
	},
});

app.openapi(deleteTeamRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId } = c.req.valid("param");

	const result = await teamService.deleteTeam(teamId, user.id, tenantId);

	return c.json({
		success: true,
		data: result,
	});
});

// List team members
const listTeamMembersRoute = createRoute({
	method: "get",
	path: "/teams/:teamId/members",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Team members",
			content: {
				"application/json": {
					schema: z.object({
						success: z.literal(true),
						data: z.array(
							z.object({
								id: z.string(),
								role: z.string(),
								joinedAt: z.string(),
								organizationRole: z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]),
								user: z.object({
									id: z.string(),
									email: z.string(),
									profile: z.any(),
									createdAt: z.string(),
								}),
							}),
						),
					}),
				},
			},
		},
		403: {
			description: "Not a member of the organization",
		},
	},
});

app.openapi(listTeamMembersRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId } = c.req.valid("param");

	const members = await teamService.listTeamMembers(teamId, user.id, tenantId);

	return c.json({
		success: true,
		data: members,
	});
});

// Add team member
const addTeamMemberRoute = createRoute({
	method: "post",
	path: "/teams/:teamId/members",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						email: z.string().email(),
						role: z.string().default("member"),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Team member added",
		},
		400: {
			description: "User must be an organization member first",
		},
		403: {
			description: "Insufficient permissions",
		},
		404: {
			description: "User not found",
		},
		409: {
			description: "User is already a team member",
		},
	},
});

app.openapi(addTeamMemberRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId } = c.req.valid("param");
	const { email, role } = c.req.valid("json");

	const member = await teamService.addTeamMember(
		teamId,
		email,
		role,
		user.id,
		tenantId,
	);

	return c.json(
		{
			success: true,
			data: member,
		},
		201,
	);
});

// Update team member role
const updateTeamMemberRoute = createRoute({
	method: "patch",
	path: "/teams/:teamId/members/:memberId",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
			memberId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						role: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Team member role updated",
		},
		403: {
			description: "Insufficient permissions",
		},
	},
});

app.openapi(updateTeamMemberRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId, memberId } = c.req.valid("param");
	const { role } = c.req.valid("json");

	const member = await teamService.updateTeamMemberRole(
		teamId,
		memberId,
		role,
		user.id,
		tenantId,
	);

	return c.json({
		success: true,
		data: member,
	});
});

// Remove team member
const removeTeamMemberRoute = createRoute({
	method: "delete",
	path: "/teams/:teamId/members/:memberId",
	tags: ["organizations"],
	middleware: authMiddleware,
	request: {
		params: z.object({
			teamId: z.string(),
			memberId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Team member removed",
		},
		403: {
			description: "Insufficient permissions",
		},
	},
});

app.openapi(removeTeamMemberRoute, async (c) => {
	const user = c.get("user");
	const tenantId = c.get("tenantId");
	const { teamId, memberId } = c.req.valid("param");

	const result = await teamService.removeTeamMember(
		teamId,
		memberId,
		user.id,
		tenantId,
	);

	return c.json({
		success: true,
		data: result,
	});
});

export { app as teamRoutes };
