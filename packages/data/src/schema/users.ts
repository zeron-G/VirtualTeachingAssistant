import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * `users` — a global (non-tenant-scoped) identity record. A single human may be
 * a member of many courses; their per-course role lives in `courseMemberships`,
 * NOT here. This table holds only stable identity, never tenant data.
 *
 * In Phase-1 the Discord user id is the primary external identity. `jhedId`
 * (JHU enterprise directory id) and `email` are reserved for SSO/LMS linking.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Phase-1 primary external identity. Unique across the deployment. */
  discordUserId: text("discord_user_id").notNull().unique(),
  /** JHED (JHU enterprise directory) id — reserved for SSO linking. */
  jhedId: text("jhed_id"),
  email: text("email"),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
