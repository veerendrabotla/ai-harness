import { z } from "zod";

export const SCHEDULE_CADENCES = ["EVERY_MINUTES", "HOURLY", "DAILY", "WEEKLY"] as const;
export const scheduleCadenceEnum = z.enum(SCHEDULE_CADENCES);
export type ScheduleCadence = z.infer<typeof scheduleCadenceEnum>;

/** Raw cadence fields shared by create/update request schemas. */
const cadenceShape = {
  cadence: scheduleCadenceEnum,
  intervalMinutes: z.number().int().min(1).max(10_080).optional(),
  minuteOfHour: z.number().int().min(0).max(59).optional(),
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "timeOfDay must be HH:MM in 24-hour format")
    .optional(),
  /** 0 = Sunday .. 6 = Saturday (matches Date#getUTCDay). */
  dayOfWeek: z.number().int().min(0).max(6).optional(),
};

/**
 * Every cadence requires exactly its structured fields (all times UTC) and
 * rejects fields belonging to other cadences so a row can never hold
 * ambiguous scheduling data.
 */
function validateCadence(v: {
  cadence: ScheduleCadence;
  intervalMinutes?: number;
  minuteOfHour?: number;
  timeOfDay?: string;
  dayOfWeek?: number;
}, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (v.cadence === "EVERY_MINUTES") {
    if (v.intervalMinutes === undefined) issue("intervalMinutes", "EVERY_MINUTES requires intervalMinutes (1-10080)");
    if (v.minuteOfHour !== undefined || v.timeOfDay !== undefined || v.dayOfWeek !== undefined) {
      issue("cadence", "EVERY_MINUTES does not accept minuteOfHour, timeOfDay, or dayOfWeek");
    }
  } else if (v.cadence === "HOURLY") {
    if (v.minuteOfHour === undefined) issue("minuteOfHour", "HOURLY requires minuteOfHour (0-59)");
    if (v.intervalMinutes !== undefined || v.timeOfDay !== undefined || v.dayOfWeek !== undefined) {
      issue("cadence", "HOURLY does not accept intervalMinutes, timeOfDay, or dayOfWeek");
    }
  } else if (v.cadence === "DAILY") {
    if (v.timeOfDay === undefined) issue("timeOfDay", "DAILY requires timeOfDay (HH:MM, UTC)");
    if (v.intervalMinutes !== undefined || v.minuteOfHour !== undefined || v.dayOfWeek !== undefined) {
      issue("cadence", "DAILY does not accept intervalMinutes, minuteOfHour, or dayOfWeek");
    }
  } else {
    if (v.timeOfDay === undefined) issue("timeOfDay", "WEEKLY requires timeOfDay (HH:MM, UTC)");
    if (v.dayOfWeek === undefined) issue("dayOfWeek", "WEEKLY requires dayOfWeek (0=Sunday .. 6=Saturday, UTC)");
    if (v.intervalMinutes !== undefined || v.minuteOfHour !== undefined) {
      issue("cadence", "WEEKLY does not accept intervalMinutes or minuteOfHour");
    }
  }
}

export const createScheduleRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string().min(1).max(120),
    goal: z.string().min(4).max(20_000),
    constraints: z.string().max(10_000).optional(),
    enabled: z.boolean().default(true),
    ...cadenceShape,
  })
  .superRefine((v, ctx) => validateCadence(v, ctx));
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

/**
 * Partial update. Cadence fields are all-or-nothing: providing any cadence
 * field requires the complete cadence configuration (including `cadence`).
 */
export const updateScheduleRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    goal: z.string().min(4).max(20_000).optional(),
    constraints: z.string().max(10_000).optional(),
    enabled: z.boolean().optional(),
    cadence: scheduleCadenceEnum.optional(),
    intervalMinutes: cadenceShape.intervalMinutes,
    minuteOfHour: cadenceShape.minuteOfHour,
    timeOfDay: cadenceShape.timeOfDay,
    dayOfWeek: cadenceShape.dayOfWeek,
  })
  .superRefine((v, ctx) => {
    const touched =
      v.cadence !== undefined ||
      v.intervalMinutes !== undefined ||
      v.minuteOfHour !== undefined ||
      v.timeOfDay !== undefined ||
      v.dayOfWeek !== undefined;
    if (!touched) return;
    if (v.cadence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cadence"],
        message: "cadence is required whenever any cadence field is provided (send the full cadence config)",
      });
      return;
    }
    validateCadence(
      {
        cadence: v.cadence,
        intervalMinutes: v.intervalMinutes,
        minuteOfHour: v.minuteOfHour,
        timeOfDay: v.timeOfDay,
        dayOfWeek: v.dayOfWeek,
      },
      ctx,
    );
  });
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;

export interface ScheduleDto {
  id: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  name: string;
  goal: string;
  constraints: string | null;
  cadence: ScheduleCadence;
  intervalMinutes: number | null;
  minuteOfHour: number | null;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}
