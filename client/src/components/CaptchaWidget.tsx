import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { turnstileLanguage } from "../lib/captchaLocalization";

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DEVELOPMENT_SITE_KEY = "1x00000000000000000000AA";
const SUCCESS_VISIBILITY_MS = 10_000;
const LOAD_TIMEOUT_MS = 10_000;
const EXECUTION_TIMEOUT_MS = 20_000;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          action: string;
          theme: "auto";
          size: "flexible";
          language: string;
          execution: "execute";
          appearance: "always";
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": (errorCode: string) => boolean;
          "timeout-callback": () => void;
          "unsupported-callback": () => void;
          retry: "auto";
          "retry-interval": number;
          "refresh-expired": "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      execute: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement;
    // A previous network or provider failure can leave an inert script element
    // behind. Reusing it would never emit another load event, so replace only
    // that runtime element before a controlled retry. No configuration or key
    // is removed by this operation.
    if (existing && !window.turnstile) existing.remove();
    const script = document.createElement("script");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadTimeout);
      if (error) {
        scriptPromise = null;
        reject(error);
        return;
      }
      resolve();
    };
    const loadTimeout = window.setTimeout(
      () => finish(new Error("Turnstile loading timed out")),
      LOAD_TIMEOUT_MS,
    );
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () =>
      finish(
        window.turnstile
          ? undefined
          : new Error("Turnstile did not initialize"),
      );
    script.onerror = () => finish(new Error("Turnstile could not be loaded"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function CaptchaWidget({
  action,
  onToken,
  resetSignal = 0,
}: {
  action: "login" | "signup" | "recovery" | "form_access" | "feedback";
  onToken: (token: string) => void;
  resetSignal?: number;
}) {
  const containerId = `turnstile-${useId().replaceAll(":", "")}`;
  const widgetId = useRef<string | null>(null);
  const executionTimeout = useRef<number | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadFailed, setLoadFailed] = useState(false);
  const [providerErrorCode, setProviderErrorCode] = useState<string | null>(
    null,
  );
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [widgetReady, setWidgetReady] = useState(false);
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [verificationSucceeded, setVerificationSucceeded] = useState(false);
  const [hideVerifiedWidget, setHideVerifiedWidget] = useState(false);
  const { i18n, t } = useTranslation();
  const language = turnstileLanguage(i18n.resolvedLanguage ?? i18n.language);
  onTokenRef.current = onToken;

  const clearExecutionTimeout = useCallback(() => {
    if (executionTimeout.current !== null) {
      window.clearTimeout(executionTimeout.current);
      executionTimeout.current = null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    widgetId.current = null;
    setWidgetReady(false);
    setLoadFailed(false);
    setProviderErrorCode(null);
    setVerificationStarted(false);
    setVerificationSucceeded(false);
    setHideVerifiedWidget(false);
    onTokenRef.current("");

    const sitekey =
      import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ||
      (import.meta.env.DEV ? DEVELOPMENT_SITE_KEY : "");
    if (!sitekey) {
      setLoadFailed(true);
      setProviderErrorCode("CONFIGURATION_MISSING");
      setWidgetReady(false);
      setVerificationStarted(false);
      setVerificationSucceeded(false);
      setHideVerifiedWidget(false);
      onTokenRef.current("");
      return;
    }

    Promise.all([
      loadTurnstile(),
      fetch("/api/auth/captcha-status", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }).then(async (response) => {
        if (!response.ok) throw new Error("CAPTCHA status unavailable");
        const status = (await response.json()) as { available?: boolean };
        if (!status.available) throw new Error("CAPTCHA is not configured");
      }),
    ])
      .then(() => {
        if (disposed || !window.turnstile) return;
        widgetId.current = window.turnstile.render(`#${containerId}`, {
          sitekey,
          action,
          theme: "auto",
          size: "flexible",
          language,
          execution: "execute",
          appearance: "always",
          callback: (token) => {
            clearExecutionTimeout();
            setLoadFailed(false);
            setVerificationStarted(false);
            setVerificationSucceeded(true);
            setHideVerifiedWidget(false);
            onTokenRef.current(token);
          },
          "expired-callback": () => {
            clearExecutionTimeout();
            setWidgetReady(true);
            setVerificationStarted(false);
            setVerificationSucceeded(false);
            setHideVerifiedWidget(false);
            onTokenRef.current("");
          },
          "error-callback": (errorCode) => {
            clearExecutionTimeout();
            console.error("[Turnstile] Widget error", { errorCode, action });
            onTokenRef.current("");
            setProviderErrorCode(errorCode || "PROVIDER_ERROR");
            setWidgetReady(false);
            setVerificationStarted(false);
            setLoadFailed(true);
            setVerificationSucceeded(false);
            setHideVerifiedWidget(false);
            return true;
          },
          "timeout-callback": () => {
            clearExecutionTimeout();
            onTokenRef.current("");
            setVerificationStarted(false);
            setVerificationSucceeded(false);
          },
          "unsupported-callback": () => {
            clearExecutionTimeout();
            onTokenRef.current("");
            setProviderErrorCode("UNSUPPORTED_BROWSER");
            setWidgetReady(false);
            setVerificationStarted(false);
            setLoadFailed(true);
            setVerificationSucceeded(false);
            setHideVerifiedWidget(false);
          },
          retry: "auto",
          "retry-interval": 8_000,
          "refresh-expired": "auto",
        });
        setWidgetReady(true);
      })
      .catch((error: unknown) => {
        console.error("[Turnstile] Initialization failed", {
          action,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        setLoadFailed(true);
        setProviderErrorCode("INITIALIZATION_FAILED");
        setWidgetReady(false);
        setVerificationStarted(false);
        setVerificationSucceeded(false);
        setHideVerifiedWidget(false);
        onTokenRef.current("");
      });

    return () => {
      disposed = true;
      clearExecutionTimeout();
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
      widgetId.current = null;
    };
  }, [
    action,
    clearExecutionTimeout,
    containerId,
    language,
    resetSignal,
    retryAttempt,
  ]);

  useEffect(() => {
    if (!verificationSucceeded) return;
    const hideTimer = window.setTimeout(
      () => setHideVerifiedWidget(true),
      SUCCESS_VISIBILITY_MS,
    );
    return () => window.clearTimeout(hideTimer);
  }, [verificationSucceeded]);

  const startVerification = () => {
    if (!widgetId.current || !window.turnstile) {
      // Loading is asynchronous. A fast click must not turn the normal
      // initialization window into a fatal CAPTCHA error.
      return;
    }
    onTokenRef.current("");
    setLoadFailed(false);
    setVerificationSucceeded(false);
    setHideVerifiedWidget(false);
    setVerificationStarted(true);
    clearExecutionTimeout();
    executionTimeout.current = window.setTimeout(() => {
      executionTimeout.current = null;
      onTokenRef.current("");
      setProviderErrorCode("EXECUTION_TIMEOUT");
      setWidgetReady(false);
      setVerificationStarted(false);
      setVerificationSucceeded(false);
      setHideVerifiedWidget(false);
      setLoadFailed(true);
    }, EXECUTION_TIMEOUT_MS);
    try {
      window.turnstile.execute(widgetId.current);
    } catch (error: unknown) {
      clearExecutionTimeout();
      console.error("[Turnstile] Execution failed", {
        action,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      onTokenRef.current("");
      setProviderErrorCode("EXECUTION_FAILED");
      setWidgetReady(false);
      setVerificationStarted(false);
      setVerificationSucceeded(false);
      setHideVerifiedWidget(false);
      setLoadFailed(true);
    }
  };

  const retryLoading = () => {
    clearExecutionTimeout();
    onTokenRef.current("");
    setLoadFailed(false);
    setProviderErrorCode(null);
    setWidgetReady(false);
    setVerificationStarted(false);
    setVerificationSucceeded(false);
    setHideVerifiedWidget(false);
    setRetryAttempt((attempt) => attempt + 1);
  };

  if (loadFailed) {
    const blockingPayload = {
      error: t("captcha.blockingError", { number: "CAPTCHA-001" }),
      code: "CAPTCHA_REQUIRED",
      errorNumber: "CAPTCHA-001",
      ...(providerErrorCode ? { providerErrorCode } : {}),
    };
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed inset-0 z-[200] flex min-h-screen items-center justify-center bg-slate-950 p-5"
      >
        <div className="w-full max-w-3xl space-y-4 rounded-2xl border border-red-400/60 bg-slate-900 p-6 shadow-2xl">
          <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap text-sm leading-7 text-red-100 sm:text-base">
            {JSON.stringify(blockingPayload, null, 2)}
          </pre>
          <button
            type="button"
            onClick={retryLoading}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-300/50 bg-red-950/40 px-4 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            {t("captcha.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-label={t("captcha.label")}>
      <div
        id={containerId}
        className={`min-h-16 w-full ${hideVerifiedWidget ? "hidden" : ""}`}
        aria-hidden={hideVerifiedWidget}
      />
      {!verificationSucceeded && (
        <button
          type="button"
          onClick={startVerification}
          disabled={!widgetReady || verificationStarted}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60"
        >
          {!widgetReady
            ? t("captcha.loading")
            : verificationStarted
              ? t("captcha.verifying")
              : t("captcha.start")}
        </button>
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        {t("captcha.help")}
      </p>
    </div>
  );
}
