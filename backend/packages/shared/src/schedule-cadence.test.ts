import { describe, it, expect } from "vitest";
import { computeNextRun, describeCadence, parseTimeOfDay, type CadenceConfig } from "./schedule-cadence.js";

// Reference: 2026-10-04 is a Sunday (getUTCDay() === 0).
const SUN = new Date("2026-10-04T12:30:45.000Z");

describe("parseTimeOfDay", () => {
  it("parses valid HH:MM", () => {
    expect(parseTimeOfDay("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay("06:30")).toEqual({ hour: 6, minute: 30 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("rejects malformed values", () => {
    for (const bad of ["9:00", "25:00", "06:60", "0630", "", "noon"]) {
      expect(() => parseTimeOfDay(bad)).toThrow();
    }
  });
});

describe("computeNextRun — EVERY_MINUTES", () => {
  it("floors to the minute and adds the interval (strictly after from)", () => {
    expect(computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 5 }, SUN)).toEqual(
      new Date("2026-10-04T12:35:00.000Z"),
    );
    expect(computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 1 }, SUN)).toEqual(
      new Date("2026-10-04T12:31:00.000Z"),
    );
  });

  it("rolls over hour/day boundaries", () => {
    const nearHour = new Date("2026-10-04T12:59:30.000Z");
    expect(computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 2 }, nearHour)).toEqual(
      new Date("2026-10-04T13:01:00.000Z"),
    );
    const nearDay = new Date("2026-10-04T23:59:10.000Z");
    expect(computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 1 }, nearDay)).toEqual(
      new Date("2026-10-05T00:00:00.000Z"),
    );
  });

  it("throws without a valid interval", () => {
    expect(() => computeNextRun({ cadence: "EVERY_MINUTES" }, SUN)).toThrow(/intervalMinutes/);
    expect(() => computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 0 }, SUN)).toThrow(/intervalMinutes/);
    expect(() => computeNextRun({ cadence: "EVERY_MINUTES", intervalMinutes: 2.5 }, SUN)).toThrow(/intervalMinutes/);
  });
});

describe("computeNextRun — HOURLY", () => {
  it("returns the same hour's minute when still ahead", () => {
    const before = new Date("2026-10-04T12:10:00.000Z");
    expect(computeNextRun({ cadence: "HOURLY", minuteOfHour: 45 }, before)).toEqual(
      new Date("2026-10-04T12:45:00.000Z"),
    );
  });

  it("rolls to the next hour once past the minute", () => {
    expect(computeNextRun({ cadence: "HOURLY", minuteOfHour: 15 }, SUN)).toEqual(
      new Date("2026-10-04T13:15:00.000Z"),
    );
  });

  it("throws without minuteOfHour", () => {
    expect(() => computeNextRun({ cadence: "HOURLY" }, SUN)).toThrow(/minuteOfHour/);
    expect(() => computeNextRun({ cadence: "HOURLY", minuteOfHour: 60 }, SUN)).toThrow(/minuteOfHour/);
  });
});

describe("computeNextRun — DAILY", () => {
  it("returns today's time when still ahead", () => {
    const before = new Date("2026-10-04T05:00:00.000Z");
    expect(computeNextRun({ cadence: "DAILY", timeOfDay: "06:30" }, before)).toEqual(
      new Date("2026-10-04T06:30:00.000Z"),
    );
  });

  it("rolls to tomorrow once past", () => {
    expect(computeNextRun({ cadence: "DAILY", timeOfDay: "06:30" }, SUN)).toEqual(
      new Date("2026-10-05T06:30:00.000Z"),
    );
  });

  it("treats an exact match as past (strictly after from)", () => {
    const exact = new Date("2026-10-04T06:30:00.000Z");
    expect(computeNextRun({ cadence: "DAILY", timeOfDay: "06:30" }, exact)).toEqual(
      new Date("2026-10-05T06:30:00.000Z"),
    );
  });

  it("throws without timeOfDay", () => {
    expect(() => computeNextRun({ cadence: "DAILY" }, SUN)).toThrow(/timeOfDay/);
    expect(() => computeNextRun({ cadence: "DAILY", timeOfDay: "6:30" }, SUN)).toThrow(/timeOfDay/);
  });
});

describe("computeNextRun — WEEKLY", () => {
  it("computes the same weekday when still ahead", () => {
    const sunEarly = new Date("2026-10-04T05:00:00.000Z");
    expect(computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 0 }, sunEarly)).toEqual(
      new Date("2026-10-04T09:00:00.000Z"),
    );
  });

  it("rolls forward to the next matching weekday", () => {
    expect(computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 3 }, SUN)).toEqual(
      new Date("2026-10-07T09:00:00.000Z"),
    );
    expect(computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 6 }, SUN)).toEqual(
      new Date("2026-10-10T09:00:00.000Z"),
    );
  });

  it("rolls a full week when past this week's occurrence", () => {
    const afterSun9 = new Date("2026-10-04T10:00:00.000Z");
    expect(computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 0 }, afterSun9)).toEqual(
      new Date("2026-10-11T09:00:00.000Z"),
    );
  });

  it("throws without timeOfDay or dayOfWeek", () => {
    expect(() => computeNextRun({ cadence: "WEEKLY", dayOfWeek: 1 }, SUN)).toThrow(/timeOfDay/);
    expect(() => computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00" }, SUN)).toThrow(/dayOfWeek/);
    expect(() => computeNextRun({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 7 }, SUN)).toThrow(/dayOfWeek/);
  });
});

describe("computeNextRun — unknown cadence", () => {
  it("throws", () => {
    expect(() => computeNextRun({ cadence: "YEARLY" as CadenceConfig["cadence"] }, SUN)).toThrow(/unknown cadence/);
  });
});

describe("describeCadence", () => {
  it("renders every cadence", () => {
    expect(describeCadence({ cadence: "EVERY_MINUTES", intervalMinutes: 5 })).toBe("every 5 min");
    expect(describeCadence({ cadence: "HOURLY", minuteOfHour: 5 })).toBe("hourly at :05");
    expect(describeCadence({ cadence: "DAILY", timeOfDay: "06:30" })).toBe("daily at 06:30 UTC");
    expect(describeCadence({ cadence: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 1 })).toBe("weekly on Mon at 09:00 UTC");
  });
});
