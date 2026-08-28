import { CheckCircle2, ClipboardList, Loader } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveIntlLocale } from "../i18n/supported-locales";
import {
  submitSurveyResponse,
  useAvailableSurveyCampaigns,
  type SurveyQuestion,
} from "../hooks/useAnalyticsSurveys";

export function AnalyticsSurveyParticipation() {
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useAvailableSurveyCampaigns();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const updateAnswer = (question: SurveyQuestion, value: string | number) => {
    if (question.questionType !== "multiple_choice") {
      setAnswers((current) => ({ ...current, [question.id]: value }));
      return;
    }
    setAnswers((current) => {
      const selected = Array.isArray(current[question.id])
        ? (current[question.id] as string[])
        : [];
      return {
        ...current,
        [question.id]: selected.includes(String(value))
          ? selected.filter((item) => item !== value)
          : [...selected, String(value)],
      };
    });
  };

  const submit = async (campaignId: string, questions: SurveyQuestion[]) => {
    const missing = questions.some(
      (question) => question.required && answers[question.id] === undefined,
    );
    if (missing) {
      setNotice(t("analytics.surveys.requiredAnswers"));
      return;
    }
    setSubmitting(campaignId);
    setNotice(null);
    try {
      await submitSurveyResponse(
        campaignId,
        questions
          .filter((question) => answers[question.id] !== undefined)
          .map((question) => ({
            questionId: question.id,
            value: answers[question.id],
          })),
      );
      setAnswers({});
      setNotice(t("analytics.surveys.responseSaved"));
      await reload();
    } catch {
      setNotice(t("analytics.surveys.saveError"));
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border bg-white p-6">
        <Loader className="animate-spin" size={18} />
        {t("common.loading")}
      </div>
    );
  }
  if (error || !data) return null;

  return (
    <section className="space-y-4" aria-labelledby="monthly-surveys-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F07A3A]">
          Forge Analytics
        </p>
        <h2
          id="monthly-surveys-title"
          className="mt-1 text-2xl font-bold text-slate-950"
        >
          {t("analytics.surveys.memberTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analytics.surveys.memberDescription")}
        </p>
      </div>
      {notice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {notice}
        </div>
      )}
      {data.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">
          <CheckCircle2 className="mb-3 text-emerald-600" />
          {t("analytics.surveys.noPending")}
        </div>
      ) : (
        data.map((campaign) => (
          <article
            key={campaign.id}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex gap-3">
              <ClipboardList className="mt-1 shrink-0 text-[#F07A3A]" />
              <div>
                <h3 className="text-lg font-bold text-slate-950">
                  {campaign.title}
                </h3>
                {campaign.description && (
                  <p className="mt-1 text-sm text-slate-600">
                    {campaign.description}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-slate-500">
                  {t(`analytics.surveys.privacy.${campaign.privacyMode}`)} ·{" "}
                  {t("analytics.surveys.closes", {
                    date: new Date(campaign.closesAt).toLocaleDateString(
                      resolveIntlLocale(i18n.language),
                    ),
                  })}
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-6">
              {campaign.questions.map((question) => (
                <fieldset key={question.id}>
                  <legend className="font-semibold text-slate-900">
                    {question.position}. {question.prompt}
                    {question.required ? " *" : ""}
                  </legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(question.questionType === "scale_1_5"
                      ? [1, 2, 3, 4, 5]
                      : question.options
                    ).map((option) => {
                      const selected =
                        question.questionType === "multiple_choice"
                          ? Array.isArray(answers[question.id]) &&
                            (answers[question.id] as string[]).includes(
                              String(option),
                            )
                          : answers[question.id] === option;
                      return (
                        <label
                          key={option}
                          className={`cursor-pointer rounded-lg border px-4 py-2 text-sm ${selected ? "border-[#F07A3A] bg-orange-50 text-slate-950" : "border-slate-200 bg-white text-slate-700"}`}
                        >
                          <input
                            className="sr-only"
                            type={
                              question.questionType === "multiple_choice"
                                ? "checkbox"
                                : "radio"
                            }
                            name={question.id}
                            checked={Boolean(selected)}
                            onChange={() => updateAnswer(question, option)}
                          />
                          {option}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            <button
              className="mt-6 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-60"
              disabled={submitting === campaign.id}
              onClick={() => void submit(campaign.id, campaign.questions)}
              type="button"
            >
              {submitting === campaign.id
                ? t("common.loading")
                : t("analytics.surveys.submit")}
            </button>
          </article>
        ))
      )}
    </section>
  );
}
