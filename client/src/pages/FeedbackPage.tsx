import { useState } from "react";
import { ArrowLeft, MessageSquareHeart, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { authFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { LegalFooter } from "../components/LegalFooter";
import { CaptchaWidget } from "../components/CaptchaWidget";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function FeedbackPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const isAccountClosureSurvey =
    searchParams.get("context") === "account-closure";
  const [category, setCategory] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    try {
      const response = await authFetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, captchaToken }),
      });
      if (!response.ok) throw new Error("Feedback submission failed");
      setMessage("");
      setCaptchaToken("");
      setCaptchaResetSignal((value) => value + 1);
      setStatus("sent");
    } catch {
      setCaptchaToken("");
      setCaptchaResetSignal((value) => value + 1);
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] flex-col bg-slate-50">
      <main className="flex-1 px-4 py-10">
        <Card className="mx-auto max-w-2xl rounded-3xl border-slate-200 p-6 shadow-sm sm:p-10">
          <span className="inline-flex rounded-2xl bg-blue-100 p-3 text-blue-700">
            <MessageSquareHeart size={28} />
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">
            {t(
              isAccountClosureSurvey
                ? "feedback.accountClosure.title"
                : "feedback.title",
            )}
          </h1>
          <p className="mt-2 text-slate-600">
            {t(
              isAccountClosureSurvey
                ? "feedback.accountClosure.description"
                : "feedback.description",
            )}
          </p>
          {!captchaToken && (
            <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <p className="mb-4 text-sm font-medium text-blue-950">
                {t("auth.verificationRequired")}
              </p>
              <CaptchaWidget
                action="feedback"
                onToken={setCaptchaToken}
                resetSignal={captchaResetSignal}
              />
            </div>
          )}
          {captchaToken && (
            <form onSubmit={submit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="feedback-category">
                  {t("feedback.category")}
                </Label>
                <select
                  id="feedback-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(
                    ["suggestion", "problem", "accessibility", "other"] as const
                  ).map((item) => (
                    <option key={item} value={item}>
                      {t(`feedback.categories.${item}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-message">
                  {t("feedback.message")}
                </Label>
                <textarea
                  id="feedback-message"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={7}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t(
                    isAccountClosureSurvey
                      ? "feedback.accountClosure.placeholder"
                      : "feedback.placeholder",
                  )}
                />
                <p className="text-right text-xs text-slate-500">
                  {message.length}/2000
                </p>
              </div>
              {status === "sent" && (
                <p
                  role="status"
                  className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"
                >
                  {t("feedback.sent")}
                </p>
              )}
              {status === "error" && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
                >
                  {t("feedback.error")}
                </p>
              )}
              <Button
                type="submit"
                disabled={status === "sending" || message.trim().length < 10}
              >
                <Send />{" "}
                {status === "sending"
                  ? t("feedback.sending")
                  : t("feedback.submit")}
              </Button>
            </form>
          )}
          <div className="mt-6 border-t border-slate-200 pt-6">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link
                to={isAccountClosureSurvey ? "/account/lifecycle" : "/login"}
              >
                <ArrowLeft />
                {t(
                  isAccountClosureSurvey
                    ? "feedback.accountClosure.returnToAccount"
                    : "feedback.returnToLogin",
                )}
              </Link>
            </Button>
          </div>
        </Card>
      </main>
      <LegalFooter variant="light" />
    </div>
  );
}
