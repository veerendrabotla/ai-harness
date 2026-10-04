/**
 * Structured, UTC-based schedule cadences for scheduled tasks.
 *
 * Deliberately not a cron parser: cadences are restricted presets validated
 * by `@ai-harness/contracts` (EVERY_MINUTES / HOURLY / DAILY / WEEKLY). All
 * comparisons use UTC so behavior is identical on every host. Timezone
 * support is future work (see docs/guides/schedules.md).
 */

export interface CadenceConfig {
  cadence: "EVERY_MINUTES" | "HOURLY" | "DAILY" | "WEEKLY";
  intervalMinutes?: number | null;
  minuteOfHour?: number | null;
  /** "HH:MM" in 24-hour format, UTC. */
  timeOfDay?: string | null;
  /** 0 = Sunday .. 6 = Saturday (Date#getUTCDay), UTC. */
  dayOfWeek?: number | null;
}

export function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!m) throw new Error(`invalid timeOfDay "${timeOfDay}" (expected HH:MM, 24-hour)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function atUtcHourMinute(from: Date, addDays: number, hour: number, minute: number): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + addDays, hour, minute, 0, 0),
  );
}

/**
 * Returns the first occurrence strictly after `from` for the given cadence.
 * Throws when required cadence fields are missing or malformed (API-layer zod
 * validation prevents persisted rows from reaching this state).
 */
export function computeNextRun(config: CadenceConfig, from: Date = new Date()): Date {
  switch (config.cadence) {
    case "EVERY_MINUTES": {
      const n = config.intervalMinutes;
      if (n === undefined || n === null || !Number.isInteger(n) || n < 1) {
        throw new Error("EVERY_MINUTES requires intervalMinutes >= 1");
      }
      const floored = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours(), from.getUTCMinutes(), 0, 0);
      return new Date(floored + n * 60_000);
    }
    case "HOURLY": {
      const m = config.minuteOfHour;
      if (m === undefined || m === null || !Number.isInteger(m) || m < 0 || m > 59) {
        throw new Error("HOURLY requires minuteOfHour (0-59)");
      }
      const candidate = atUtcHourMinute(from, 0, from.getUTCHours(), m);
      return candidate.getTime() > from.getTime() ? candidate : new Date(candidate.getTime() + 3_600_000);
    }
    case "DAILY": {
      if (!config.timeOfDay) throw new Error("DAILY requires timeOfDay (HH:MM, UTC)");
      const { hour, minute } = parseTimeOfDay(config.timeOfDay);
      const candidate = atUtcHourMinute(from, 0, hour, minute);
      return candidate.getTime() > from.getTime() ? candidate : new Date(candidate.getTime() + 86_400_000);
    }
    case "WEEKLY": {
      if (!config.timeOfDay) throw new Error("WEEKLY requires timeOfDay (HH:MM, UTC)");
      const dow = config.dayOfWeek;
      if (dow === undefined || dow === null || !Number.isInteger(dow) || dow < 0 || dow > 6) {
        throw new Error("WEEKLY requires dayOfWeek (0=Sunday .. 6=Saturday)");
      }
      const { hour, minute } = parseTimeOfDay(config.timeOfDay);
      const diff = (dow - from.getUTCDay() + 7) % 7;
      const candidate = atUtcHourMinute(from, diff, hour, minute);
      return candidate.getTime() > from.getTime() ? candidate : new Date(candidate.getTime() + 7 * 86_400_000);
    }
    default: {
      throw new Error(`unknown cadence "${String(config.cadence)}"`);
    }
  }
}

/** Human-readable cadence summary used by logs and API responses. */
export function describeCadence(config: CadenceConfig): string {
  switch (config.cadence) {
    case "EVERY_MINUTES":
      return `every ${config.intervalMinutes} min`;
    case "HOURLY":
      return `hourly at :${String(config.minuteOfHour).padStart(2, "0")}`;
    case "DAILY":
      return `daily at ${config.timeOfDay} UTC`;
    case "WEEKLY":
      return `weekly on ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][config.dayOfWeek ?? 0]} at ${config.timeOfDay} UTC`;
    default:
      return String(config.cadence);
  }
}
