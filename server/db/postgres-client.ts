import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database as DatabaseSchema } from "./types.js";
import { runPostgresMigrations } from "./postgres-migrations.js";
import { postgresPoolSettings } from "./runtime.js";

export type PostgresDatabaseRuntime = {
  db: Kysely<DatabaseSchema>;
  initialize(): Promise<void>;
  check(): Promise<void>;
  reconcileBookingIntegrity(): Promise<{
    duplicateBookings: number;
    staleWaitlistEntries: number;
  }>;
  close(): Promise<void>;
};

export function createPostgresDatabaseRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): PostgresDatabaseRuntime {
  pg.types.setTypeParser(20, (value) => Number(value));
  const pool = new pg.Pool(postgresPoolSettings(environment));
  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
  });
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
    log:
      environment.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

  return {
    db,
    async initialize() {
      await runPostgresMigrations(pool);
    },
    async check() {
      await sql`SELECT 1`.execute(db);
    },
    async reconcileBookingIntegrity() {
      const duplicateResult = await sql`
        WITH ranked AS (
          SELECT "id",
            ROW_NUMBER() OVER (
              PARTITION BY "activitySessionId", "userId"
              ORDER BY CASE "status" WHEN 'confirmed' THEN 0 ELSE 1 END,
                "createdAt" ASC,
                "id" ASC
            ) AS "activeRank"
          FROM "bookings"
          WHERE "status" IN ('confirmed', 'waitlist')
        )
        UPDATE "bookings"
        SET "status" = 'cancelled',
            "cancelledAt" = COALESCE("cancelledAt", ${Date.now()})
        WHERE "id" IN (SELECT "id" FROM ranked WHERE "activeRank" > 1)
      `.execute(db);
      const staleResult = await sql`
        DELETE FROM "waitlistEntries"
        WHERE "promotedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "bookings"
            WHERE "bookings"."activitySessionId" = "waitlistEntries"."activitySessionId"
              AND "bookings"."userId" = "waitlistEntries"."userId"
              AND "bookings"."status" = 'confirmed'
          )
      `.execute(db);
      return {
        duplicateBookings: Number(duplicateResult.numAffectedRows ?? 0),
        staleWaitlistEntries: Number(staleResult.numAffectedRows ?? 0),
      };
    },
    async close() {
      await db.destroy();
    },
  };
}
