import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the @vta/data package.
 *
 * The schema barrel re-exports every table so a single `out` directory holds
 * all generated migrations. DATABASE_URL must be present in the environment
 * when running any db:* script (db:generate is the exception in some setups,
 * but we keep credentials wired here for push/migrate/studio).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // Non-null assertion is intentional: the db:* scripts are operator-run and
    // require DATABASE_URL. drizzle-kit will fail loudly if it is missing.
    url: process.env.DATABASE_URL!,
  },
});
