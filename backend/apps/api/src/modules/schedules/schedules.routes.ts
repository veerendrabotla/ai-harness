import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createScheduleRequestSchema, updateScheduleRequestSchema, type ScheduleDto } from "@ai-harness/contracts";
import { errors, computeNextRun, type CadenceConfig } from "@ai-harness/shared";
import { createAuditRepository } from "@ai-harness/database";
import type { EventPublisher } from "@ai-harness/agent-runtime";
import { ok, reqParam } from "../../lib/http.js";
import { withCache } from "../../lib/cache.js";

type ScheduleRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  name: string;
  goal: string;
  constraints: string | null;
  cadence: ScheduleDto["cadence"];
  intervalMinutes: number | null;
  minuteOfHour: number | null;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeSchedule(s: ScheduleRow): ScheduleDto {
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    createdBy: s.createdBy,
    name: s.name,
    goal: s.goal,
    constraints: s.constraints,
    cadence: s.cadence,
    intervalMinutes: s.intervalMinutes,
    minuteOfHour: s.minuteOfHour,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek,
    enabled: s.enabled,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastTaskId: s.lastTaskId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function cadenceOf(s: Pick<ScheduleRow, "cadence" | "intervalMinutes" | "minuteOfHour" | "timeOfDay" | "dayOfWeek">): CadenceConfig {
  return {
    cadence: s.cadence,
    intervalMinutes: s.intervalMinutes,
    minuteOfHour: s.minuteOfHour,
    timeOfDay: s.timeOfDay,
    dayOfWeek: s.dayOfWeek,
  };
}

export default function registerSchedulesRoutes(app: FastifyInstance, _events: EventPublisher) {
  const audit = createAuditRepository(app.prisma);

  app.get("/v1/schedules", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["schedules"],
      summary: "List scheduled tasks for the authenticated user",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          workspaceId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reply) => {
    const query = (req.query ?? {}) as { workspaceId?: string };
    const userId = req.user!.sub;
    const memberships = await withCache(`memberships:user:${userId}`, 30, () =>
      app.prisma.workspaceMember.findMany({
        where: { userId },
        select: { workspaceId: true },
      }),
    );
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const schedules = await app.prisma.taskSchedule.findMany({
      where: {
        workspaceId: query.workspaceId
          ? workspaceIds.includes(query.workspaceId)
            ? query.workspaceId
            : "__denied__"
          : { in: workspaceIds },
      },
      orderBy: { nextRunAt: "asc" },
      take: 200,
    });
    return ok(reply, schedules.map(serializeSchedule));
  });

  app.post(
    "/v1/schedules",
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: { max: 60, timeWindow: "1 hour", keyGenerator: (r) => r.user?.sub ?? r.ip },
      },
      schema: {
        tags: ["schedules"],
        summary: "Create a scheduled task (recurring, UTC cadence)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["workspaceId", "projectId", "name", "goal", "cadence"],
          properties: {
            workspaceId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            goal: { type: "string", minLength: 4, maxLength: 20000 },
            constraints: { type: "string", maxLength: 10000 },
            enabled: { type: "boolean", default: true },
            cadence: { type: "string", enum: ["EVERY_MINUTES", "HOURLY", "DAILY", "WEEKLY"] },
            intervalMinutes: { type: "integer", minimum: 1, maximum: 10080 },
            minuteOfHour: { type: "integer", minimum: 0, maximum: 59 },
            timeOfDay: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
            dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
          },
        },
      },
    },
    async (req, reply) => {
      const input = createScheduleRequestSchema.parse(req.body);
      const userId = req.user!.sub;

      await app.requireWorkspaceRole(req, input.workspaceId, "MEMBER");
      const workspace = await app.prisma.workspace.findUnique({ where: { id: input.workspaceId } });
      if (!workspace) throw errors.notFound("Workspace");
      if (workspace.status === "ARCHIVED") throw errors.workspaceArchived();

      const project = await app.prisma.project.findFirst({
        where: { id: input.projectId, workspaceId: input.workspaceId },
      });
      if (!project) throw errors.notFound("Project");
      if (project.status !== "AVAILABLE") throw errors.projectUnavailable();

      const now = new Date();
      const schedule = await app.prisma.taskSchedule.create({
        data: {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          createdBy: userId,
          name: input.name,
          goal: input.goal,
          constraints: input.constraints ?? null,
          cadence: input.cadence,
          intervalMinutes: input.intervalMinutes ?? null,
          minuteOfHour: input.minuteOfHour ?? null,
          timeOfDay: input.timeOfDay ?? null,
          dayOfWeek: input.dayOfWeek ?? null,
          enabled: input.enabled,
          nextRunAt: computeNextRun(
            {
              cadence: input.cadence,
              intervalMinutes: input.intervalMinutes,
              minuteOfHour: input.minuteOfHour,
              timeOfDay: input.timeOfDay,
              dayOfWeek: input.dayOfWeek,
            },
            now,
          ),
        },
      });
      await audit.record({
        actorUserId: userId,
        workspaceId: input.workspaceId,
        action: "SCHEDULE_CREATED",
        entityType: "TASK_SCHEDULE",
        entityId: schedule.id,
      });

      return ok(reply, serializeSchedule(schedule), 201);
    },
  );

  app.patch("/v1/schedules/:scheduleId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["schedules"],
      summary: "Update a scheduled task (name, goal, cadence, enabled)",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: { scheduleId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          goal: { type: "string", minLength: 4, maxLength: 20000 },
          constraints: { type: "string", maxLength: 10000 },
          enabled: { type: "boolean" },
          cadence: { type: "string", enum: ["EVERY_MINUTES", "HOURLY", "DAILY", "WEEKLY"] },
          intervalMinutes: { type: "integer", minimum: 1, maximum: 10080 },
          minuteOfHour: { type: "integer", minimum: 0, maximum: 59 },
          timeOfDay: { type: "string" },
          dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
        },
      },
    },
  }, async (req, reply) => {
    const scheduleId = reqParam(req, "scheduleId");
    const input = updateScheduleRequestSchema.parse(req.body ?? {});
    const userId = req.user!.sub;

    const existing = await app.prisma.taskSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) throw errors.notFound("Schedule");
    await app.requireWorkspaceRole(req, existing.workspaceId, "MEMBER");

    const cadenceTouched =
      input.cadence !== undefined ||
      input.intervalMinutes !== undefined ||
      input.minuteOfHour !== undefined ||
      input.timeOfDay !== undefined ||
      input.dayOfWeek !== undefined;

    const merged = {
      cadence: input.cadence ?? existing.cadence,
      intervalMinutes: input.intervalMinutes !== undefined ? input.intervalMinutes : existing.intervalMinutes,
      minuteOfHour: input.minuteOfHour !== undefined ? input.minuteOfHour : existing.minuteOfHour,
      timeOfDay: input.timeOfDay !== undefined ? input.timeOfDay : existing.timeOfDay,
      dayOfWeek: input.dayOfWeek !== undefined ? input.dayOfWeek : existing.dayOfWeek,
    };

    // Recompute on cadence changes and on re-enable so a stale past
    // nextRunAt never causes an immediate burst of fires.
    const recompute = cadenceTouched || input.enabled === true;
    const updated = await app.prisma.taskSchedule.update({
      where: { id: scheduleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(recompute ? { nextRunAt: computeNextRun(cadenceOf(merged), new Date()) } : {}),
      },
    });
    await audit.record({
      actorUserId: userId,
      workspaceId: existing.workspaceId,
      action: "SCHEDULE_UPDATED",
      entityType: "TASK_SCHEDULE",
      entityId: scheduleId,
    });

    return ok(reply, serializeSchedule(updated));
  });

  app.delete("/v1/schedules/:scheduleId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["schedules"],
      summary: "Delete a scheduled task",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["scheduleId"],
        properties: { scheduleId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req, reply) => {
    const scheduleId = reqParam(req, "scheduleId");
    const userId = req.user!.sub;

    const existing = await app.prisma.taskSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) throw errors.notFound("Schedule");
    await app.requireWorkspaceRole(req, existing.workspaceId, "MEMBER");

    await app.prisma.taskSchedule.delete({ where: { id: scheduleId } });
    await audit.record({
      actorUserId: userId,
      workspaceId: existing.workspaceId,
      action: "SCHEDULE_DELETED",
      entityType: "TASK_SCHEDULE",
      entityId: scheduleId,
    });

    return ok(reply, { deleted: true });
  });
}
