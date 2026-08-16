import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createSurvey,
  createSurveyCampaign,
  useSurveyManagement,
  type SurveyPrivacyMode,
  type SurveyQuestionType,
} from "../hooks/useAnalyticsSurveys";

interface QuestionDraft {
  prompt: string;
  questionType: SurveyQuestionType;
  optionsText: string;
  required: boolean;
}

const emptyQuestion = (): QuestionDraft => ({
  prompt: "",
  questionType: "scale_1_5",
  optionsText: "",
  required: true,
});

export function AnalyticsSurveyManagement() {
  const { t } = useTranslation();
  const { data, reload } = useSurveyManagement();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyMode, setPrivacyMode] =
    useState<SurveyPrivacyMode>("anonymous");
  const [minimumResponses, setMinimumResponses] = useState(5);
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    emptyQuestion(),
  ]);
  const [periodKey, setPeriodKey] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [selectedSurveyId, setSelectedSurveyId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const published = useMemo(
    () =>
      data?.definitions.filter(
        (definition) => definition.status === "published",
      ) ?? [],
    [data],
  );

  const patchQuestion = (index: number, patch: Partial<QuestionDraft>) => {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const created = await createSurvey({
        title,
        description,
        privacyMode,
        minimumResponses,
        questions: questions.map((question) => ({
          prompt: question.prompt,
          questionType: question.questionType,
          options: question.optionsText
            .split("\n")
            .map((option) => option.trim())
            .filter(Boolean),
          required: question.required,
        })),
      });
      setSelectedSurveyId(created.id);
      setTitle("");
      setDescription("");
      setQuestions([emptyQuestion()]);
      setNotice(t("analytics.surveys.published", { version: created.version }));
      await reload();
    } catch {
      setNotice(t("analytics.surveys.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!selectedSurveyId || !periodKey) return;
    const [year, month] = periodKey.split("-").map(Number);
    const opensAt = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
    const closesAt = new Date(year, month, 1, 0, 0, 0, 0).getTime();
    setBusy(true);
    setNotice(null);
    try {
      await createSurveyCampaign({
        surveyId: selectedSurveyId,
        periodKey,
        opensAt,
        closesAt,
      });
      setNotice(t("analytics.surveys.campaignCreated"));
      await reload();
    } catch {
      setNotice(t("analytics.surveys.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F07A3A]">
          Forge Analytics
        </p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">
          {t("analytics.surveys.managementTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t("analytics.surveys.managementDescription")}
        </p>
      </div>
      {notice && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {notice}
        </div>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold text-slate-800">
          {t("analytics.surveys.title")}
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-slate-800">
          {t("analytics.surveys.privacyLabel")}
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            value={privacyMode}
            onChange={(event) =>
              setPrivacyMode(event.target.value as SurveyPrivacyMode)
            }
          >
            <option value="anonymous">
              {t("analytics.surveys.privacy.anonymous")}
            </option>
            <option value="confidential">
              {t("analytics.surveys.privacy.confidential")}
            </option>
            <option value="identified">
              {t("analytics.surveys.privacy.identified")}
            </option>
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-800 lg:col-span-2">
          {t("analytics.surveys.description")}
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-slate-800">
          {t("analytics.surveys.minimumResponses")}
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            min={5}
            max={50}
            type="number"
            value={minimumResponses}
            onChange={(event) =>
              setMinimumResponses(Number(event.target.value))
            }
          />
        </label>
      </div>
      <div className="mt-6 space-y-4">
        {questions.map((question, index) => (
          <div key={index} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <label className="flex-1 text-sm font-semibold text-slate-800">
                {t("analytics.surveys.question", { number: index + 1 })}
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  value={question.prompt}
                  onChange={(event) =>
                    patchQuestion(index, { prompt: event.target.value })
                  }
                />
              </label>
              {questions.length > 1 && (
                <button
                  className="mt-6 rounded-lg p-2 text-red-600"
                  type="button"
                  aria-label={t("common.delete")}
                  onClick={() =>
                    setQuestions((current) =>
                      current.filter(
                        (_, questionIndex) => questionIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={question.questionType}
                onChange={(event) =>
                  patchQuestion(index, {
                    questionType: event.target.value as SurveyQuestionType,
                  })
                }
              >
                <option value="scale_1_5">
                  {t("analytics.surveys.types.scale")}
                </option>
                <option value="single_choice">
                  {t("analytics.surveys.types.single")}
                </option>
                <option value="multiple_choice">
                  {t("analytics.surveys.types.multiple")}
                </option>
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) =>
                    patchQuestion(index, { required: event.target.checked })
                  }
                />
                {t("analytics.surveys.required")}
              </label>
            </div>
            {question.questionType !== "scale_1_5" && (
              <textarea
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                placeholder={t("analytics.surveys.optionsHint")}
                value={question.optionsText}
                onChange={(event) =>
                  patchQuestion(index, { optionsText: event.target.value })
                }
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
          disabled={questions.length >= 10}
          type="button"
          onClick={() =>
            setQuestions((current) => [...current, emptyQuestion()])
          }
        >
          <Plus size={16} />
          {t("analytics.surveys.addQuestion")}
        </button>
        <button
          className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={
            busy ||
            title.trim().length < 3 ||
            questions.some((question) => question.prompt.trim().length < 3)
          }
          type="button"
          onClick={() => void publish()}
        >
          {t("analytics.surveys.publish")}
        </button>
      </div>
      <div className="mt-8 border-t border-slate-200 pt-6">
        <h3 className="font-bold text-slate-950">
          {t("analytics.surveys.scheduleTitle")}
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={selectedSurveyId}
            onChange={(event) => setSelectedSurveyId(event.target.value)}
          >
            <option value="">{t("analytics.surveys.selectSurvey")}</option>
            {published.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.title} · v{definition.version}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2"
            type="month"
            value={periodKey}
            onChange={(event) => setPeriodKey(event.target.value)}
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F07A3A] px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy || !selectedSurveyId}
            type="button"
            onClick={() => void schedule()}
          >
            <CalendarPlus size={17} />
            {t("analytics.surveys.schedule")}
          </button>
        </div>
        {data && data.campaigns.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {t("analytics.surveys.campaignCount", {
              count: data.campaigns.length,
            })}
          </p>
        )}
      </div>
    </section>
  );
}
