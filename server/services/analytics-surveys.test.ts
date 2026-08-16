import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("monthly analytics surveys", () => {
  let directory: string;
  let database: typeof import("../db/client.js");
  let surveys: typeof import("./analytics-surveys.js");
  let now: number;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "umbravia-analytics-surveys-"));
    vi.stubEnv("DATA_DIRECTORY", directory);
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    database = await import("../db/client.js");
    surveys = await import("./analytics-surveys.js");
    await database.initializeDatabase();
    now = Date.now();

    await database.db
      .insertInto("facilityProfiles")
      .values({
        id: "survey-secondary",
        slug: "survey-secondary",
        name: "Survey Secondary",
        logoDataUrl: "",
        accentColor: "#334155",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database.db
      .insertInto("users")
      .values(
        [
          "survey-admin",
          "survey-member-1",
          "survey-member-2",
          "survey-member-3",
          "survey-member-4",
          "survey-member-5",
        ].map((id, index) => ({
          id,
          email: `${id}@example.com`,
          phone: null,
          name: `Survey user ${index}`,
          avatarDataUrl: "",
          password: "not-used",
          role:
            id === "survey-admin" ? ("admin" as const) : ("member" as const),
          accountStatus: "active" as const,
          emailVerifiedAt: now,
          sessionIdleTimeoutMinutes: 10_080,
          createdAt: now,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    await database.closeDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("versions definitions and archives the superseded version", async () => {
    const first = await surveys.createSurveyDefinition({
      facilityId: "survey-secondary",
      createdByUserId: "survey-admin",
      title: "Pulso mensual",
      privacyMode: "anonymous",
      questions: [
        { prompt: "¿Cómo valoras las clases?", questionType: "scale_1_5" },
      ],
    });
    const second = await surveys.createSurveyDefinition({
      facilityId: "survey-secondary",
      createdByUserId: "survey-admin",
      title: "Pulso mensual",
      privacyMode: "anonymous",
      questions: [
        {
          prompt: "¿Cómo valoras las clases este mes?",
          questionType: "scale_1_5",
        },
      ],
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(
      await database.db
        .selectFrom("analyticsSurveyDefinitions")
        .select(["version", "status"])
        .where("facilityId", "=", "survey-secondary")
        .orderBy("version", "asc")
        .execute(),
    ).toEqual([
      { version: 1, status: "archived" },
      { version: 2, status: "published" },
    ]);
  });

  it("rejects a campaign that tries to cross the tenant boundary", async () => {
    const definition = await database.db
      .selectFrom("analyticsSurveyDefinitions")
      .select("id")
      .where("facilityId", "=", "survey-secondary")
      .where("status", "=", "published")
      .executeTakeFirstOrThrow();

    await expect(
      surveys.createSurveyCampaign({
        facilityId: "primary",
        surveyId: definition.id,
        periodKey: "2026-08",
        opensAt: now - 1_000,
        closesAt: now + 86_400_000,
        createdByUserId: "survey-admin",
      }),
    ).rejects.toMatchObject({
      code: "ANALYTICS_SURVEY_NOT_FOUND",
      status: 404,
    });
  });

  it("keeps anonymous answers unlinkable and withholds results until five responses", async () => {
    const definition = await database.db
      .selectFrom("analyticsSurveyDefinitions")
      .select("id")
      .where("facilityId", "=", "survey-secondary")
      .where("status", "=", "published")
      .executeTakeFirstOrThrow();
    const campaign = await surveys.createSurveyCampaign({
      facilityId: "survey-secondary",
      surveyId: definition.id,
      periodKey: "2026-08",
      opensAt: now - 1_000,
      closesAt: now + 86_400_000,
      createdByUserId: "survey-admin",
    });
    const question = await database.db
      .selectFrom("analyticsSurveyQuestions")
      .select("id")
      .where("surveyId", "=", definition.id)
      .executeTakeFirstOrThrow();

    await surveys.submitSurveyResponse({
      facilityId: "survey-secondary",
      campaignId: campaign.id,
      userId: "survey-member-1",
      answers: [{ questionId: question.id, value: 4 }],
      now,
    });
    expect(
      await surveys.getSurveyCampaignResults("survey-secondary", campaign.id),
    ).toMatchObject({
      available: false,
      responseCount: 1,
      minimumResponses: 5,
    });
    await expect(
      surveys.submitSurveyResponse({
        facilityId: "survey-secondary",
        campaignId: campaign.id,
        userId: "survey-member-1",
        answers: [{ questionId: question.id, value: 5 }],
        now,
      }),
    ).rejects.toMatchObject({
      code: "ANALYTICS_SURVEY_ALREADY_COMPLETED",
      status: 409,
    });

    for (const [index, userId] of [
      "survey-member-2",
      "survey-member-3",
      "survey-member-4",
      "survey-member-5",
    ].entries()) {
      await surveys.submitSurveyResponse({
        facilityId: "survey-secondary",
        campaignId: campaign.id,
        userId,
        answers: [{ questionId: question.id, value: index + 1 }],
        now,
      });
    }

    expect(
      await database.db
        .selectFrom("analyticsSurveyResponses")
        .select("respondentUserId")
        .where("campaignId", "=", campaign.id)
        .execute(),
    ).toEqual(Array.from({ length: 5 }, () => ({ respondentUserId: null })));
    expect(
      await surveys.getSurveyCampaignResults("survey-secondary", campaign.id),
    ).toMatchObject({
      available: true,
      responseCount: 5,
      questions: [
        {
          answerCount: 5,
          average: 2.8,
          distribution: [
            { value: 1, count: 1 },
            { value: 2, count: 1 },
            { value: 3, count: 1 },
            { value: 4, count: 2 },
            { value: 5, count: 0 },
          ],
        },
      ],
    });
  });
});
