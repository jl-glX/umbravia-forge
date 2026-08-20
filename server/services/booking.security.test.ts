import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FACILITY_ID = "facility-booking-security";

describe("booking integrity and export security", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let booking: typeof import("./booking.js");

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), "umbravia-forge-booking-security-"),
    );
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    booking = await import("./booking.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: FACILITY_ID,
        slug: "booking-security",
        name: "Booking security",
        logoDataUrl: "",
        accentColor: "#f97316",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("users")
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          id: `concurrent-user-${index}`,
          email: `concurrent-${index}@example.com`,
          phone: null,
          name:
            index === 0
              ? '=HYPERLINK("https://evil.example")'
              : `User ${index}`,
          avatarDataUrl: "",
          password: "not-used-in-this-service-test",
          role: "member" as const,
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: Date.now(),
        })),
      )
      .execute();
    await database.db
      .insertInto("facilityMemberships")
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          id: `${FACILITY_ID}:concurrent-user-${index}`,
          facilityId: FACILITY_ID,
          userId: `concurrent-user-${index}`,
          role: "member" as const,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .execute();
    await database.initializeDatabase();
    await database.db
      .insertInto("activitySessions")
      .values({
        facilityId: FACILITY_ID,
        id: "one-place-class",
        name: "One place",
        description: "",
        trainerId: "trainer-placeholder",
        trainerName: "Trainer",
        maxCapacity: 1,
        scheduledAt: Date.now() + 86_400_000,
      })
      .execute();
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("serializes simultaneous requests so capacity is never exceeded", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        booking.bookClass(
          "one-place-class",
          `concurrent-user-${index}`,
          FACILITY_ID,
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === "confirmed"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "waitlist"),
    ).toHaveLength(4);

    const confirmed = await database.db
      .selectFrom("bookings")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("activitySessionId", "=", "one-place-class")
      .where("status", "=", "confirmed")
      .executeTakeFirstOrThrow();
    expect(Number(confirmed.count)).toBe(1);
  });

  it("neutralizes spreadsheet formulas in attendee exports", async () => {
    const csv = await booking.exportClassAttendeesCsv(
      "one-place-class",
      FACILITY_ID,
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(?:^|\n)"=HYPERLINK/);
  });

  it("enforces relational integrity for orphaned bookings", async () => {
    await expect(
      database.db
        .insertInto("bookings")
        .values({
          id: "orphan-booking",
          activitySessionId: "missing-class",
          userId: "missing-user",
          status: "confirmed",
          createdAt: Date.now(),
          cancelledAt: null,
        })
        .execute(),
    ).rejects.toThrow();
  });
});
