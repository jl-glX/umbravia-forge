import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import type {
  AnalyticsSurveyPrivacyMode,
  AnalyticsSurveyQuestionType,
} from "../db/types.js";

const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 8;
const MAX_CAMPAIGN_DURATION_MS = 45 * 24 * 60 * 60 * 1_000;

export class AnalyticsSurveyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsSurveyError";
  }
}

export interface SurveyQuestionInput {
  prompt: string;
  questionType: AnalyticsSurveyQuestionType;
  options?: string[];
  required?: boolean;
}

export interface SurveyAnswerInput {
  questionId: string;
  value: unknown;
}

function fail(code: string, status: number, message: string): never {
  throw new AnalyticsSurveyError(code, status, message);
}

function normalizeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function seriesKeyFor(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || `survey-${randomUUID().slice(0, 12)}`;
}

function validateQuestions(input: SurveyQuestionInput[]) {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_QUESTIONS
  ) {
    fail(
      "ANALYTICS_SURVEY_QUESTIONS_INVALID",
      400,
      `A survey must contain between 1 and ${MAX_QUESTIONS} questions`,
    );
  }

  return input.map((question, index) => {
    const prompt = normalizeText(question.prompt, 200);
    if (prompt.length < 3) {
      fail(
        "ANALYTICS_SURVEY_QUESTION_INVALID",
        400,
        `Question ${index + 1} is invalid`,
      );
    }
    if (
      question.questionType !== "scale_1_5" &&
      question.questionType !== "single_choice" &&
      question.questionType !== "multiple_choice"
    ) {
      fail(
        "ANALYTICS_SURVEY_QUESTION_TYPE_INVALID",
        400,
        `Question ${index + 1} has an unsupported type`,
      );
    }

    let options: string[] = [];
    if (question.questionType !== "scale_1_5") {
      options = [
        ...new Set(
          (question.options ?? [])
            .map((item) => normalizeText(item, 80))
            .filter(Boolean),
        ),
      ];
      if (options.length < 2 || options.length > MAX_OPTIONS) {
        fail(
          "ANALYTICS_SURVEY_OPTIONS_INVALID",
          400,
          `Question ${index + 1} must contain between 2 and ${MAX_OPTIONS} unique options`,
        );
      }
    }

    return {
      prompt,
      questionType: question.questionType,
      options,
      required: question.required !== false,
    };
  });
}

function parseOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function publicQuestion(question: {
  id: string;
  position: number;
  prompt: string;
  questionType: AnalyticsSurveyQuestionType;
  optionsJson: string;
  required: number;
}) {
  return {
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    questionType: question.questionType,
    options: parseOptions(question.optionsJson),
    required: question.required === 1,
  };
}

export async function createSurveyDefinition(input: {
  facilityId: string;
  createdByUserId: string;
  title: string;
  description?: string;
  privacyMode: AnalyticsSurveyPrivacyMode;
  minimumResponses?: number;
  questions: SurveyQuestionInput[];
}) {
  const title = normalizeText(input.title, 120);
  const description = normalizeText(input.description, 500);
  if (title.length < 3) {
    fail("ANALYTICS_SURVEY_TITLE_INVALID", 400, "The survey title is invalid");
  }
  if (
    !(["anonymous", "confidential", "identified"] as const).includes(
      input.privacyMode,
    )
  ) {
    fail(
      "ANALYTICS_SURVEY_PRIVACY_INVALID",
      400,
      "The survey privacy mode is invalid",
    );
  }
  const minimumResponses = input.minimumResponses ?? 5;
  if (
    !Number.isInteger(minimumResponses) ||
    minimumResponses < 5 ||
    minimumResponses > 50
  ) {
    fail(
      "ANALYTICS_SURVEY_THRESHOLD_INVALID",
      400,
      "The reporting threshold must be between 5 and 50 responses",
    );
  }
  const questions = validateQuestions(input.questions);
  const seriesKey = seriesKeyFor(title);
  const now = Date.now();
  const surveyId = `analytics-survey-${randomUUID()}`;

  return db.transaction().execute(async (transaction) => {
    const existingVersions = await transaction
      .selectFrom("analyticsSurveyDefinitions")
      .select(["id", "version"])
      .where("facilityId", "=", input.facilityId)
      .where("seriesKey", "=", seriesKey)
      .execute();
    const version =
      existingVersions.reduce(
        (highest, row) => Math.max(highest, row.version),
        0,
      ) + 1;

    if (existingVersions.length > 0) {
      await transaction
        .updateTable("analyticsSurveyDefinitions")
        .set({ status: "archived", updatedAt: now })
        .where("facilityId", "=", input.facilityId)
        .where("seriesKey", "=", seriesKey)
        .where("status", "=", "published")
        .execute();
    }

    await transaction
      .insertInto("analyticsSurveyDefinitions")
      .values({
        id: surveyId,
        facilityId: input.facilityId,
        seriesKey,
        version,
        title,
        description,
        privacyMode: input.privacyMode,
        minimumResponses,
        status: "published",
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await transaction
      .insertInto("analyticsSurveyQuestions")
      .values(
        questions.map((question, index) => ({
          id: `analytics-question-${randomUUID()}`,
          surveyId,
          position: index + 1,
          prompt: question.prompt,
          questionType: question.questionType,
          optionsJson: JSON.stringify(question.options),
          required: question.required ? 1 : 0,
          createdAt: now,
        })),
      )
      .execute();

    return { id: surveyId, seriesKey, version, status: "published" as const };
  });
}

export async function createSurveyCampaign(input: {
  facilityId: string;
  surveyId: string;
  periodKey: string;
  opensAt: number;
  closesAt: number;
  createdByUserId: string;
}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodKey)) {
    fail(
      "ANALYTICS_SURVEY_PERIOD_INVALID",
      400,
      "The campaign period must use YYYY-MM",
    );
  }
  if (
    !Number.isSafeInteger(input.opensAt) ||
    !Number.isSafeInteger(input.closesAt) ||
    input.closesAt <= input.opensAt ||
    input.closesAt - input.opensAt > MAX_CAMPAIGN_DURATION_MS
  ) {
    fail(
      "ANALYTICS_SURVEY_WINDOW_INVALID",
      400,
      "The campaign window is invalid",
    );
  }

  const definition = await db
    .selectFrom("analyticsSurveyDefinitions")
    .select(["id", "status"])
    .where("id", "=", input.surveyId)
    .where("facilityId", "=", input.facilityId)
    .executeTakeFirst();
  if (!definition || definition.status !== "published") {
    fail(
      "ANALYTICS_SURVEY_NOT_FOUND",
      404,
      "The published survey was not found for this facility",
    );
  }

  const existing = await db
    .selectFrom("analyticsSurveyCampaigns")
    .select("id")
    .where("facilityId", "=", input.facilityId)
    .where("periodKey", "=", input.periodKey)
    .executeTakeFirst();
  if (existing) {
    fail(
      "ANALYTICS_SURVEY_PERIOD_CONFLICT",
      409,
      "This facility already has a survey campaign for the period",
    );
  }

  const now = Date.now();
  const status =
    now < input.opensAt
      ? "scheduled"
      : now >= input.closesAt
        ? "closed"
        : "active";
  const id = `analytics-campaign-${randomUUID()}`;
  await db
    .insertInto("analyticsSurveyCampaigns")
    .values({
      id,
      facilityId: input.facilityId,
      surveyId: input.surveyId,
      periodKey: input.periodKey,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      status,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return { id, status };
}

export async function listSurveyManagement(facilityId: string) {
  const [definitions, questions, campaigns] = await Promise.all([
    db
      .selectFrom("analyticsSurveyDefinitions")
      .selectAll()
      .where("facilityId", "=", facilityId)
      .orderBy("createdAt", "desc")
      .execute(),
    db
      .selectFrom("analyticsSurveyQuestions")
      .innerJoin(
        "analyticsSurveyDefinitions",
        "analyticsSurveyDefinitions.id",
        "analyticsSurveyQuestions.surveyId",
      )
      .select([
        "analyticsSurveyQuestions.id",
        "analyticsSurveyQuestions.surveyId",
        "analyticsSurveyQuestions.position",
        "analyticsSurveyQuestions.prompt",
        "analyticsSurveyQuestions.questionType",
        "analyticsSurveyQuestions.optionsJson",
        "analyticsSurveyQuestions.required",
      ])
      .where("analyticsSurveyDefinitions.facilityId", "=", facilityId)
      .orderBy("analyticsSurveyQuestions.position", "asc")
      .execute(),
    db
      .selectFrom("analyticsSurveyCampaigns")
      .selectAll()
      .where("facilityId", "=", facilityId)
      .orderBy("opensAt", "desc")
      .execute(),
  ]);

  return {
    definitions: definitions.map((definition) => ({
      ...definition,
      questions: questions
        .filter((question) => question.surveyId === definition.id)
        .map(publicQuestion),
    })),
    campaigns,
  };
}

export async function listSurveyCampaigns(facilityId: string) {
  return db
    .selectFrom("analyticsSurveyCampaigns")
    .innerJoin(
      "analyticsSurveyDefinitions",
      "analyticsSurveyDefinitions.id",
      "analyticsSurveyCampaigns.surveyId",
    )
    .select([
      "analyticsSurveyCampaigns.id",
      "analyticsSurveyCampaigns.surveyId",
      "analyticsSurveyCampaigns.periodKey",
      "analyticsSurveyCampaigns.opensAt",
      "analyticsSurveyCampaigns.closesAt",
      "analyticsSurveyCampaigns.status",
      "analyticsSurveyDefinitions.title",
      "analyticsSurveyDefinitions.minimumResponses",
    ])
    .where("analyticsSurveyCampaigns.facilityId", "=", facilityId)
    .orderBy("analyticsSurveyCampaigns.opensAt", "desc")
    .execute();
}

export async function listAvailableSurveyCampaigns(
  facilityId: string,
  userId: string,
  now = Date.now(),
) {
  const campaigns = await db
    .selectFrom("analyticsSurveyCampaigns")
    .innerJoin(
      "analyticsSurveyDefinitions",
      "analyticsSurveyDefinitions.id",
      "analyticsSurveyCampaigns.surveyId",
    )
    .leftJoin("analyticsSurveyParticipations", (join) =>
      join
        .onRef(
          "analyticsSurveyParticipations.campaignId",
          "=",
          "analyticsSurveyCampaigns.id",
        )
        .on("analyticsSurveyParticipations.userId", "=", userId),
    )
    .select([
      "analyticsSurveyCampaigns.id",
      "analyticsSurveyCampaigns.periodKey",
      "analyticsSurveyCampaigns.opensAt",
      "analyticsSurveyCampaigns.closesAt",
      "analyticsSurveyDefinitions.id as surveyId",
      "analyticsSurveyDefinitions.title",
      "analyticsSurveyDefinitions.description",
      "analyticsSurveyDefinitions.privacyMode",
      "analyticsSurveyParticipations.completedAt",
    ])
    .where("analyticsSurveyCampaigns.facilityId", "=", facilityId)
    .where("analyticsSurveyCampaigns.opensAt", "<=", now)
    .where("analyticsSurveyCampaigns.closesAt", ">", now)
    .where("analyticsSurveyParticipations.completedAt", "is", null)
    .orderBy("analyticsSurveyCampaigns.closesAt", "asc")
    .execute();

  if (campaigns.length === 0) return [];
  const surveyIds = [
    ...new Set(campaigns.map((campaign) => campaign.surveyId)),
  ];
  const questions = await db
    .selectFrom("analyticsSurveyQuestions")
    .select([
      "id",
      "surveyId",
      "position",
      "prompt",
      "questionType",
      "optionsJson",
      "required",
    ])
    .where("surveyId", "in", surveyIds)
    .orderBy("position", "asc")
    .execute();

  return campaigns.map(({ completedAt: _completedAt, ...campaign }) => ({
    ...campaign,
    questions: questions
      .filter((question) => question.surveyId === campaign.surveyId)
      .map(publicQuestion),
  }));
}

function validateAnswer(
  question: {
    id: string;
    questionType: AnalyticsSurveyQuestionType;
    optionsJson: string;
  },
  value: unknown,
): unknown {
  if (question.questionType === "scale_1_5") {
    if (
      !Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > 5
    ) {
      fail(
        "ANALYTICS_SURVEY_ANSWER_INVALID",
        400,
        "A scale answer must be an integer from 1 to 5",
      );
    }
    return value;
  }

  const options = parseOptions(question.optionsJson);
  if (question.questionType === "single_choice") {
    if (typeof value !== "string" || !options.includes(value)) {
      fail(
        "ANALYTICS_SURVEY_ANSWER_INVALID",
        400,
        "A choice answer is invalid",
      );
    }
    return value;
  }

  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    !value.every((item) => typeof item === "string" && options.includes(item))
  ) {
    fail(
      "ANALYTICS_SURVEY_ANSWER_INVALID",
      400,
      "A multiple-choice answer is invalid",
    );
  }
  return [...new Set(value as string[])];
}

export async function submitSurveyResponse(input: {
  facilityId: string;
  campaignId: string;
  userId: string;
  answers: SurveyAnswerInput[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  return db.transaction().execute(async (transaction) => {
    const campaign = await transaction
      .selectFrom("analyticsSurveyCampaigns")
      .innerJoin(
        "analyticsSurveyDefinitions",
        "analyticsSurveyDefinitions.id",
        "analyticsSurveyCampaigns.surveyId",
      )
      .select([
        "analyticsSurveyCampaigns.surveyId",
        "analyticsSurveyCampaigns.opensAt",
        "analyticsSurveyCampaigns.closesAt",
        "analyticsSurveyDefinitions.privacyMode",
      ])
      .where("analyticsSurveyCampaigns.id", "=", input.campaignId)
      .where("analyticsSurveyCampaigns.facilityId", "=", input.facilityId)
      .executeTakeFirst();
    if (!campaign)
      fail(
        "ANALYTICS_SURVEY_CAMPAIGN_NOT_FOUND",
        404,
        "The survey campaign was not found",
      );
    if (campaign.opensAt > now || campaign.closesAt <= now) {
      fail(
        "ANALYTICS_SURVEY_CAMPAIGN_CLOSED",
        409,
        "The survey campaign is not open",
      );
    }

    const priorParticipation = await transaction
      .selectFrom("analyticsSurveyParticipations")
      .select("campaignId")
      .where("campaignId", "=", input.campaignId)
      .where("userId", "=", input.userId)
      .executeTakeFirst();
    if (priorParticipation) {
      fail(
        "ANALYTICS_SURVEY_ALREADY_COMPLETED",
        409,
        "The survey was already completed",
      );
    }

    const questions = await transaction
      .selectFrom("analyticsSurveyQuestions")
      .select(["id", "questionType", "optionsJson", "required"])
      .where("surveyId", "=", campaign.surveyId)
      .orderBy("position", "asc")
      .execute();
    const answerMap = new Map(
      input.answers.map((answer) => [answer.questionId, answer.value]),
    );
    if (
      answerMap.size !== input.answers.length ||
      input.answers.some(
        (answer) =>
          !questions.some((question) => question.id === answer.questionId),
      )
    ) {
      fail(
        "ANALYTICS_SURVEY_ANSWERS_INVALID",
        400,
        "The answer set contains unknown or duplicate questions",
      );
    }
    const validatedAnswers = questions.flatMap((question) => {
      if (!answerMap.has(question.id)) {
        if (question.required === 1) {
          fail(
            "ANALYTICS_SURVEY_REQUIRED_ANSWER_MISSING",
            400,
            "A required survey answer is missing",
          );
        }
        return [];
      }
      return [
        {
          questionId: question.id,
          value: validateAnswer(question, answerMap.get(question.id)),
        },
      ];
    });

    const responseId = `analytics-response-${randomUUID()}`;
    // Anonymous answers use the campaign opening time instead of the exact
    // submission instant. The separate participation ledger may retain the
    // completion time to prevent duplicates, but it cannot be correlated with
    // an anonymous response through a shared timestamp.
    const responseTimestamp =
      campaign.privacyMode === "anonymous" ? campaign.opensAt : now;
    await transaction
      .insertInto("analyticsSurveyResponses")
      .values({
        id: responseId,
        facilityId: input.facilityId,
        campaignId: input.campaignId,
        respondentUserId:
          campaign.privacyMode === "anonymous" ? null : input.userId,
        submittedAt: responseTimestamp,
      })
      .execute();
    if (validatedAnswers.length > 0) {
      await transaction
        .insertInto("analyticsSurveyAnswers")
        .values(
          validatedAnswers.map((answer) => ({
            id: `analytics-answer-${randomUUID()}`,
            responseId,
            questionId: answer.questionId,
            valueJson: JSON.stringify(answer.value),
            createdAt: responseTimestamp,
          })),
        )
        .execute();
    }
    await transaction
      .insertInto("analyticsSurveyParticipations")
      .values({
        campaignId: input.campaignId,
        userId: input.userId,
        completedAt: now,
      })
      .execute();
    return { responseId, accepted: true as const };
  });
}

export async function getSurveyCampaignResults(
  facilityId: string,
  campaignId: string,
) {
  const campaign = await db
    .selectFrom("analyticsSurveyCampaigns")
    .innerJoin(
      "analyticsSurveyDefinitions",
      "analyticsSurveyDefinitions.id",
      "analyticsSurveyCampaigns.surveyId",
    )
    .select([
      "analyticsSurveyCampaigns.surveyId",
      "analyticsSurveyCampaigns.periodKey",
      "analyticsSurveyDefinitions.title",
      "analyticsSurveyDefinitions.minimumResponses",
    ])
    .where("analyticsSurveyCampaigns.id", "=", campaignId)
    .where("analyticsSurveyCampaigns.facilityId", "=", facilityId)
    .executeTakeFirst();
  if (!campaign)
    fail(
      "ANALYTICS_SURVEY_CAMPAIGN_NOT_FOUND",
      404,
      "The survey campaign was not found",
    );

  const responses = await db
    .selectFrom("analyticsSurveyResponses")
    .select("id")
    .where("campaignId", "=", campaignId)
    .where("facilityId", "=", facilityId)
    .execute();
  if (responses.length < campaign.minimumResponses) {
    return {
      campaignId,
      title: campaign.title,
      periodKey: campaign.periodKey,
      available: false as const,
      responseCount: responses.length,
      minimumResponses: campaign.minimumResponses,
      questions: [],
    };
  }

  const questions = await db
    .selectFrom("analyticsSurveyQuestions")
    .select([
      "id",
      "position",
      "prompt",
      "questionType",
      "optionsJson",
      "required",
    ])
    .where("surveyId", "=", campaign.surveyId)
    .orderBy("position", "asc")
    .execute();
  const responseIds = responses.map((response) => response.id);
  const answers = await db
    .selectFrom("analyticsSurveyAnswers")
    .select(["questionId", "valueJson"])
    .where("responseId", "in", responseIds)
    .execute();

  return {
    campaignId,
    title: campaign.title,
    periodKey: campaign.periodKey,
    available: true as const,
    responseCount: responses.length,
    minimumResponses: campaign.minimumResponses,
    questions: questions.map((question) => {
      const values = answers
        .filter((answer) => answer.questionId === question.id)
        .flatMap((answer) => {
          try {
            return [JSON.parse(answer.valueJson) as unknown];
          } catch {
            return [];
          }
        });
      if (question.questionType === "scale_1_5") {
        const numericValues = values.filter(
          (value): value is number => typeof value === "number",
        );
        return {
          ...publicQuestion(question),
          answerCount: numericValues.length,
          average:
            numericValues.length === 0
              ? null
              : numericValues.reduce((sum, value) => sum + value, 0) /
                numericValues.length,
          distribution: [1, 2, 3, 4, 5].map((value) => ({
            value,
            count: numericValues.filter((answer) => answer === value).length,
          })),
        };
      }
      const optionCounts = new Map(
        parseOptions(question.optionsJson).map((option) => [option, 0]),
      );
      for (const value of values) {
        const selected = Array.isArray(value) ? value : [value];
        for (const option of selected) {
          if (typeof option === "string" && optionCounts.has(option)) {
            optionCounts.set(option, (optionCounts.get(option) ?? 0) + 1);
          }
        }
      }
      return {
        ...publicQuestion(question),
        answerCount: values.length,
        distribution: [...optionCounts].map(([value, count]) => ({
          value,
          count,
        })),
      };
    }),
  };
}
