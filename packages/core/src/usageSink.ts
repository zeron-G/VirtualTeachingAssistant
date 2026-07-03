/**
 * `DbUsageSink` — a persistent {@link UsageSink} that records every served LLM
 * call into the `usage_records` table.
 *
 * Like `routerJudge`/`routerModerator`, this adapter lives in the composition
 * layer (`@vta/core`) — the only place allowed to know both `@vta/llm` (the port)
 * and `@vta/data` (the store) — so neither of those packages depends on the other.
 *
 * FIRE-AND-FORGET: the `UsageSink` port is synchronous and MUST NOT throw, but a
 * DB write is async and can fail. `record` therefore kicks off the write without
 * awaiting it and swallows-and-logs any error — usage accounting must never break
 * or slow the request path, and a lost usage row is acceptable (it is telemetry,
 * not the system of record).
 */

import type { UsageSink, UsageRecord } from '@vta/llm';
import type { Logger } from '@vta/shared';
import { createLogger, toError } from '@vta/shared';
import { UsageRepository } from '@vta/data';
import type { Db } from '@vta/data';

export class DbUsageSink implements UsageSink {
  private readonly repo: UsageRepository;
  private readonly log: Logger;

  constructor(db: Db, logger?: Logger) {
    this.repo = new UsageRepository(db);
    this.log = logger ?? createLogger({ name: 'usage-sink' });
  }

  record(r: UsageRecord): void {
    void this.repo
      .record({
        role: r.role,
        provider: r.provider,
        model: r.model,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costUsd: r.usage.costUsd ?? null,
        latencyMs: r.latencyMs,
        // The router stamps an ISO-8601 string; the column is a timestamptz.
        createdAt: new Date(r.ts),
      })
      .catch((err: unknown) => {
        this.log.warn({ err: toError(err).message }, 'usage record write failed (dropped)');
      });
  }
}
