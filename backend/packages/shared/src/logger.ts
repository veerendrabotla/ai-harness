import pino, { type Logger as PinoLogger } from "pino";
import { redactValue } from "./redact.js";

export interface LoggerOptions {
  name?: string;
  level?: string;
}

const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.refreshToken",
  "*.accessToken",
  "*.apiKey",
  "*.credential",
  "*.encryptedCredential",
];

export function createLogger(options: LoggerOptions = {}): PinoLogger {
  return pino({
    name: options.name ?? "ai-harness",
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    redact: { paths: PINO_REDACT_PATHS, censor: "[REDACTED]" },
    base: undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

/** Secondary defense-in-depth: redact an object before passing it to any sink. */
export function sanitizeLogObject<T>(value: T): T {
  return redactValue(value);
}

export type Logger = PinoLogger;
