import { sql, gte, desc } from "drizzle-orm";
import type { Db } from "../client.js";
import { usageRecords } from "../schema/usage.js";
import type { NewUsageRecordRow } from "../schema/usage.js";

/** One row of the per-model usage summary. */
export interface UsageSummaryRow {
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Summed cost in USD, or null when no row carried a cost. */
  readonly costUsd: number | null;
}

/**
 * Append-only writer + aggregator for {@link usageRecords}. `record` is called
 * fire-and-forget from the usage sink (the caller swallows errors); the summary
 * query backs the `usage:report` admin command.
 *
 * NOT course-scoped: usage is recorded below the tenant layer (see the schema
 * note). This repository intentionally exposes no update/delete — the log is
 * append-only by contract.
 */
export class UsageRepository {
  constructor(private readonly db: Db) {}

  /** Persist one usage record. */
  async record(entry: NewUsageRecordRow): Promise<void> {
    await this.db.insert(usageRecords).values(entry);
  }

  /**
   * Aggregate token usage grouped by model, largest input-token consumer first.
   * When `since` is given, only records at/after that instant are counted.
   */
  async summaryByModel(since?: Date): Promise<UsageSummaryRow[]> {
    // bigint sums come back from node-postgres as strings; count(*)::int and
    // the float8 cost sum come back as JS numbers. `Number(...)` normalizes both.
    const rows = await this.db
      .select({
        model: usageRecords.model,
        requests: sql<number>`count(*)::int`,
        inputTokens: sql<string>`coalesce(sum(${usageRecords.inputTokens}), 0)::bigint`,
        outputTokens: sql<string>`coalesce(sum(${usageRecords.outputTokens}), 0)::bigint`,
        costUsd: sql<number | null>`sum(${usageRecords.costUsd})`,
      })
      .from(usageRecords)
      .where(since ? gte(usageRecords.createdAt, since) : undefined)
      .groupBy(usageRecords.model)
      .orderBy(desc(sql`sum(${usageRecords.inputTokens})`));

    return rows.map((r) => ({
      model: r.model,
      requests: r.requests,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
    }));
  }
}
