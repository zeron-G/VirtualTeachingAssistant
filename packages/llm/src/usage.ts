/**
 * Usage accounting.
 *
 * Every completion/embedding the router serves emits a {@link UsageRecord} to a
 * {@link UsageSink}. Phase-1 will add a persistent sink (DB / metrics) for
 * cost dashboards and per-course quotas; for now a logging sink is enough and
 * keeps the router decoupled from storage.
 */

import { createLogger } from '@vta/shared';
import type { Logger, LlmRole } from '@vta/shared';
import type { Usage } from './types.js';

/** One served LLM operation, with the concrete provider/model that served it. */
export interface UsageRecord {
  readonly role: LlmRole;
  readonly provider: string;
  readonly model: string;
  readonly usage: Usage;
  readonly latencyMs: number;
  /** ISO-8601 timestamp of completion. */
  readonly ts: string;
}

/** A consumer of usage records. Implementations must not throw. */
export interface UsageSink {
  record(r: UsageRecord): void;
}

/**
 * Default sink that emits structured log lines. Useful in every environment and
 * a sensible fallback when no metrics/DB sink is wired.
 */
export class LoggingUsageSink implements UsageSink {
  private readonly log: Logger;

  constructor(logger?: Logger) {
    this.log = logger ?? createLogger({ name: 'llm-usage' });
  }

  record(r: UsageRecord): void {
    this.log.info(
      {
        role: r.role,
        provider: r.provider,
        model: r.model,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costUsd: r.usage.costUsd,
        latencyMs: r.latencyMs,
        ts: r.ts,
      },
      'llm_usage',
    );
  }
}

/** A no-op sink for tests or callers that track usage elsewhere. */
export class NullUsageSink implements UsageSink {
  record(_r: UsageRecord): void {
    /* intentionally empty */
  }
}
