import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FACILITY_ID = "facility-booking-config";

describe("editable booking configuration", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let classes: typeof import("./classes.js");

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-forge-booking-config-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    await database.initializeDatabase();
    const now = Date.now();
    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: FACILITY_ID,
        slug: "booking-config",
        name: "Booking config",
        logoDataUrl: "",
        accentColor: "#f97316",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    classes = await import("./classes.js");
  });

  afterAll(async () => {
    database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps existing class creation compatible and stores rules separately", async () => {
    const activitySession = await classes.createClass(
      {
        name: "WOD tarde",
        description: "Sesión de prueba",
        trainerId: "trainer-demo",
        trainerName: "Ana",
        maxCapacity: 14,
        scheduledAt: Date.now() + 86_400_000,
      },
      FACILITY_ID,
    );
    expect(activitySession.lifecycleState).toBe("active");
    expect(activitySession.bookingConfiguration.durationMinutes).toBe(60);

    const configured = await classes.saveActivitySessionBookingConfiguration(
      activitySession.id,
      {
        configuration: {
          room: "Box principal",
          durationMinutes: 75,
          waitlistEnabled: true,
          onTimeCancellationMinutes: 240,
        },
        seriesId: "series-wod-tarde",
      },
      FACILITY_ID,
    );

    expect(configured).toMatchObject({
      lifecycleState: "active",
      seriesId: "series-wod-tarde",
      bookingConfiguration: {
        room: "Box principal",
        durationMinutes: 75,
        waitlistEnabled: true,
        onTimeCancellationMinutes: 240,
      },
    });
  });

  it("rejects contradictory cancellation windows", async () => {
    await expect(
      classes.saveActivitySessionBookingConfiguration(
        "missing-class",
        {
          configuration: {
            onTimeCancellationMinutes: 60,
            lateCancellationMinutes: 180,
          },
        },
        FACILITY_ID,
      ),
    ).rejects.toThrow("Class not found");

    const activitySession = await classes.createClass(
      {
        name: "Invalid rules",
        description: "",
        trainerId: "trainer-demo",
        trainerName: "Ana",
        maxCapacity: 10,
        scheduledAt: Date.now() + 86_400_000,
      },
      FACILITY_ID,
    );
    await expect(
      classes.saveActivitySessionBookingConfiguration(
        activitySession.id,
        {
          configuration: {
            onTimeCancellationMinutes: 60,
            lateCancellationMinutes: 180,
          },
        },
        FACILITY_ID,
      ),
    ).rejects.toThrow("late cancellation window");
  });

  it("creates independent multi-day sessions with a shared opening rule", async () => {
    const first = Date.now() + 3 * 86_400_000;
    const second = Date.now() + 4 * 86_400_000 + 3_600_000;
    const created = await classes.createClassSeries(
      {
        name: "Entrenamiento multidía",
        description: "Dos sesiones con horarios distintos",
        trainerId: "trainer-demo",
        trainerName: "Ana",
        maxCapacity: 12,
        occurrences: [second, first],
        bookingOpensMinutesBefore: 24 * 60,
      },
      FACILITY_ID,
    );

    expect(created).toHaveLength(2);
    expect(created.map((item) => item.scheduledAt)).toEqual([first, second]);
    expect(created[0].id).not.toBe(created[1].id);
    expect(created[0].seriesId).toBeTruthy();
    expect(created[1].seriesId).toBe(created[0].seriesId);
    expect(created[0].bookingConfiguration.bookingOpensAt).toBe(
      first - 24 * 60 * 60_000,
    );
    expect(created[1].bookingConfiguration.bookingOpensAt).toBe(
      second - 24 * 60 * 60_000,
    );
  });
});
