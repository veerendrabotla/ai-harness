import { describe, it, expect } from "vitest";
import {
  createScheduleRequestSchema,
  updateScheduleRequestSchema,
  scheduleCadenceEnum,
  SCHEDULE_CADENCES,
  type ScheduleDto,
} from "./schedules.js";

const wsId = "00000000-0000-0000-0000-000000000001";
const projectId = "00000000-0000-0000-0000-000000000002";

const base = { workspaceId: wsId, projectId, name: "Nightly build", goal: "Run the nightly build" };

describe("Schedule cadence enum", () => {
  it("defines all four cadences", () => {
    expect(SCHEDULE_CADENCES).toEqual(["EVERY_MINUTES", "HOURLY", "DAILY", "WEEKLY"]);
  });

  it("validates each cadence value", () => {
    for (const c of SCHEDULE_CADENCES) expect(scheduleCadenceEnum.parse(c)).toBe(c);
  });

  it("rejects cron strings and unknown cadences", () => {
    expect(() => scheduleCadenceEnum.parse("0 3 * * *")).toThrow();
    expect(() => scheduleCadenceEnum.parse("YEARLY")).toThrow();
  });
});

describe("createScheduleRequestSchema", () => {
  it("accepts EVERY_MINUTES and defaults enabled to true", () => {
    const v = createScheduleRequestSchema.parse({ ...base, cadence: "EVERY_MINUTES", intervalMinutes: 5 });
    expect(v.enabled).toBe(true);
    expect(v.intervalMinutes).toBe(5);
  });

  it("accepts HOURLY with minuteOfHour", () => {
    const v = createScheduleRequestSchema.parse({ ...base, cadence: "HOURLY", minuteOfHour: 15 });
    expect(v.minuteOfHour).toBe(15);
  });

  it("accepts DAILY with timeOfDay", () => {
    const v = createScheduleRequestSchema.parse({ ...base, cadence: "DAILY", timeOfDay: "06:30" });
    expect(v.timeOfDay).toBe("06:30");
  });

  it("accepts WEEKLY with timeOfDay + dayOfWeek", () => {
    const v = createScheduleRequestSchema.parse({
      ...base,
      cadence: "WEEKLY",
      timeOfDay: "09:00",
      dayOfWeek: 1,
    });
    expect(v.dayOfWeek).toBe(1);
  });

  it("requires the field belonging to each cadence", () => {
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "EVERY_MINUTES" })).toThrow(/intervalMinutes/);
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "HOURLY" })).toThrow(/minuteOfHour/);
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "DAILY" })).toThrow(/timeOfDay/);
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "WEEKLY", timeOfDay: "09:00" })).toThrow(
      /dayOfWeek/,
    );
  });

  it("rejects fields from other cadences (no ambiguous rows)", () => {
    expect(() =>
      createScheduleRequestSchema.parse({ ...base, cadence: "EVERY_MINUTES", intervalMinutes: 5, timeOfDay: "09:00" }),
    ).toThrow(/does not accept/);
    expect(() =>
      createScheduleRequestSchema.parse({ ...base, cadence: "DAILY", timeOfDay: "09:00", intervalMinutes: 5 }),
    ).toThrow(/does not accept/);
    expect(() =>
      createScheduleRequestSchema.parse({ ...base, cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 0, minuteOfHour: 3 }),
    ).toThrow(/does not accept/);
  });

  it("rejects malformed timeOfDay, out-of-range values, and missing cadence", () => {
    expect(() =>
      createScheduleRequestSchema.parse({ ...base, cadence: "DAILY", timeOfDay: "9:00" }),
    ).toThrow();
    expect(() =>
      createScheduleRequestSchema.parse({ ...base, cadence: "DAILY", timeOfDay: "25:00" }),
    ).toThrow();
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "EVERY_MINUTES", intervalMinutes: 0 })).toThrow();
    expect(() => createScheduleRequestSchema.parse({ ...base, cadence: "EVERY_MINUTES", intervalMinutes: 10_081 })).toThrow();
    expect(() => createScheduleRequestSchema.parse({ ...base })).toThrow(/cadence/);
  });
});

describe("updateScheduleRequestSchema", () => {
  it("accepts plain field patches without cadence", () => {
    const v = updateScheduleRequestSchema.parse({ name: "Renamed", enabled: false });
    expect(v.name).toBe("Renamed");
    expect(v.enabled).toBe(false);
  });

  it("requires the full cadence config when any cadence field is touched", () => {
    expect(() => updateScheduleRequestSchema.parse({ intervalMinutes: 10 })).toThrow(/full cadence config/);
    expect(() => updateScheduleRequestSchema.parse({ cadence: "DAILY", timeOfDay: "08:00" })).not.toThrow();
    expect(() => updateScheduleRequestSchema.parse({ cadence: "DAILY" })).toThrow(/timeOfDay/);
  });

  it("rejects cadence fields that contradict the chosen cadence", () => {
    expect(() => updateScheduleRequestSchema.parse({ cadence: "HOURLY", minuteOfHour: 5, dayOfWeek: 2 })).toThrow(
      /does not accept/,
    );
  });
});

describe("ScheduleDto shape", () => {
  it("serializes ISO timestamps and nullable run references", () => {
    const dto: ScheduleDto = {
      id: "00000000-0000-0000-0000-000000000003",
      workspaceId: wsId,
      projectId,
      createdBy: wsId,
      name: "Nightly build",
      goal: "Run the nightly build",
      constraints: null,
      cadence: "DAILY",
      intervalMinutes: null,
      minuteOfHour: null,
      timeOfDay: "06:30",
      dayOfWeek: null,
      enabled: true,
      nextRunAt: "2026-10-05T06:30:00.000Z",
      lastRunAt: null,
      lastTaskId: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
    };
    expect(new Date(dto.nextRunAt).getTime()).toBeGreaterThan(0);
    expect(dto.timeOfDay).toBe("06:30");
  });
});
