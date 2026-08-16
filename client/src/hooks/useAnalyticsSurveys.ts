import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/api";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "";

export type SurveyPrivacyMode = "anonymous" | "confidential" | "identified";
export type SurveyQuestionType =
  "scale_1_5" | "single_choice" | "multiple_choice";

export interface SurveyQuestion {
  id: string;
  position: number;
  prompt: string;
  questionType: SurveyQuestionType;
  options: string[];
  required: boolean;
}

export interface SurveyDefinition {
  id: string;
  title: string;
  description: string;
  version: number;
  status: "published" | "archived";
  privacyMode: SurveyPrivacyMode;
  minimumResponses: number;
  questions: SurveyQuestion[];
}

export interface SurveyCampaign {
  id: string;
  surveyId: string;
  periodKey: string;
  opensAt: number;
  closesAt: number;
  status: "scheduled" | "active" | "closed";
  title?: string;
  minimumResponses?: number;
}

export interface AvailableSurveyCampaign extends SurveyCampaign {
  title: string;
  description: string;
  privacyMode: SurveyPrivacyMode;
  questions: SurveyQuestion[];
}

export interface SurveyResultQuestion extends SurveyQuestion {
  answerCount: number;
  average?: number | null;
  distribution: Array<{ value: string | number; count: number }>;
}

export interface SurveyResults {
  campaignId: string;
  title: string;
  periodKey: string;
  available: boolean;
  responseCount: number;
  minimumResponses: number;
  questions: SurveyResultQuestion[];
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_BASE}${path}`, init);
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
  } & T;
  if (!response.ok) throw new Error(body.code ?? "ANALYTICS_SURVEY_FAILED");
  return body;
}

function useSurveyResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await readJson<T>(path));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "ANALYTICS_SURVEY_FAILED",
      );
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => void reload(), [reload]);
  return { data, loading, error, reload };
}

export function useSurveyManagement() {
  return useSurveyResource<{
    definitions: SurveyDefinition[];
    campaigns: SurveyCampaign[];
  }>("/api/analytics/surveys/manage");
}

export function useSurveyCampaigns() {
  return useSurveyResource<SurveyCampaign[]>("/api/analytics/survey-campaigns");
}

export function useAvailableSurveyCampaigns() {
  return useSurveyResource<AvailableSurveyCampaign[]>(
    "/api/analytics/survey-campaigns/available",
  );
}

export function createSurvey(input: {
  title: string;
  description: string;
  privacyMode: SurveyPrivacyMode;
  minimumResponses: number;
  questions: Array<{
    prompt: string;
    questionType: SurveyQuestionType;
    options: string[];
    required: boolean;
  }>;
}) {
  return readJson<{ id: string; version: number }>("/api/analytics/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createSurveyCampaign(input: {
  surveyId: string;
  periodKey: string;
  opensAt: number;
  closesAt: number;
}) {
  return readJson<{ id: string; status: string }>(
    "/api/analytics/survey-campaigns",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function submitSurveyResponse(
  campaignId: string,
  answers: Array<{ questionId: string; value: unknown }>,
) {
  return readJson<{ accepted: true }>(
    `/api/analytics/survey-campaigns/${encodeURIComponent(campaignId)}/responses`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
}

export function getSurveyResults(campaignId: string) {
  return readJson<SurveyResults>(
    `/api/analytics/survey-campaigns/${encodeURIComponent(campaignId)}/results`,
  );
}
