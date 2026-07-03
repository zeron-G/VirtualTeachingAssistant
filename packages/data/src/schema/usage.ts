import { pgTable, uuid, text, integer, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

/**
 * `usage_records` — append-only LLM token-usage log. One row per served model
 * call (every `ModelRouter.complete`), written fire-and-forget from the usage
 * sink so a failed write never touches the request path.
 *
 * There is no `courseId` yet: the router records usage below the tenant layer
 * and does not know the course. Per-course attribution is a future enhancement
 * (thread `courseId` through the sink); today this supports per-model / per-role
 * / over-time cost tracking, which is what the usage report reads.
 *
 * `costUsd` is nullable and currently unpopulated — OpenRouter's default chat
 * response does not return a per-call cost, so we record token counts only.
 */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Logical LLM role that was served (e.g. 'agent.primary', 'guard.judge'). */
    role: text("role").notNull(),
    /** Provider label that served it (e.g. 'openai-compatible'). */
    provider: text("provider").notNull(),
    /** Concrete model id that served it (e.g. 'anthropic/claude-opus-4.8'). */
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Cost in USD if the provider reported it; null otherwise. */
    costUsd: doublePrecision("cost_usd"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Reports filter by time window and group by model.
    createdAtIdx: index("usage_records_created_at_idx").on(t.createdAt),
    modelIdx: index("usage_records_model_idx").on(t.model),
  }),
);

export type UsageRecordRow = typeof usageRecords.$inferSelect;
export type NewUsageRecordRow = typeof usageRecords.$inferInsert;
