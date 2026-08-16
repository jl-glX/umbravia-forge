import { BarChart3, Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getSurveyResults,
  useSurveyCampaigns,
  type SurveyResults,
} from "../hooks/useAnalyticsSurveys";

export function AnalyticsSurveyResults() {
  const { t } = useTranslation();
  const { data: campaigns, loading } = useSurveyCampaigns();
  const [results, setResults] = useState<Record<string, SurveyResults>>({});

  useEffect(() => {
    if (!campaigns) return;
    let active = true;
    void Promise.all(
      campaigns.map(
        async (campaign) =>
          [campaign.id, await getSurveyResults(campaign.id)] as const,
      ),
    )
      .then((entries) => {
        if (active) setResults(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [campaigns]);

  if (loading) return <Loader className="animate-spin" />;
  if (!campaigns || campaigns.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <BarChart3 className="text-[#F07A3A]" />
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            {t("analytics.surveys.resultsTitle")}
          </h2>
          <p className="text-sm text-slate-600">
            {t("analytics.surveys.resultsDescription")}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-5">
        {campaigns.map((campaign) => {
          const result = results[campaign.id];
          return (
            <article
              key={campaign.id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <h3 className="font-bold text-slate-900">
                {campaign.title ?? campaign.periodKey}
              </h3>
              <p className="text-xs text-slate-500">{campaign.periodKey}</p>
              {!result ? (
                <p className="mt-3 text-sm text-slate-500">
                  {t("common.loading")}
                </p>
              ) : !result.available ? (
                <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {t("analytics.surveys.thresholdPending", {
                    count: result.responseCount,
                    minimum: result.minimumResponses,
                  })}
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  <p className="text-sm font-semibold text-emerald-700">
                    {t("analytics.surveys.responseCount", {
                      count: result.responseCount,
                    })}
                  </p>
                  {result.questions.map((question) => (
                    <div key={question.id}>
                      <p className="text-sm font-semibold text-slate-900">
                        {question.prompt}
                      </p>
                      {question.average != null && (
                        <p className="mt-1 text-2xl font-bold text-slate-950">
                          {question.average.toFixed(1)} / 5
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {question.distribution.map((item) => (
                          <span
                            key={item.value}
                            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                          >
                            {item.value}: {item.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
