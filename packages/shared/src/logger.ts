/**
 * Structured logging.
 *
 * One JSON logger for the whole system. Logs must never contain raw student
 * PII or secrets — redact upstream before logging. The audit trail (in
 * `@vta/audit`) is a separate, durable concern; this is operational logging.
 */

import { pino } from 'pino';
import type { Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  readonly level?: string;
  /** Stable component name attached to every line (e.g. "discord-worker"). */
  readonly name?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({
    name: options.name,
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: {
      // Defence-in-depth: scrub common secret-bearing keys if they ever leak in.
      paths: ['token', 'apiKey', 'authorization', '*.token', '*.apiKey', '*.password'],
      censor: '[redacted]',
    },
  });
}

/** A shared root logger for convenience; prefer a named child per component. */
export const logger: Logger = createLogger();
