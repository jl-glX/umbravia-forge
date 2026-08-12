import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { lazy, Suspense } from "react";
import { useAuth } from "./hooks/useAuth";
import { Navigation } from "./components/Navigation";
import { useTranslation } from "react-i18next";
import { getAccessRole, type UserRole } from "./context/auth-context";

function lazyPage<TModule, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as React.ComponentType };
  });
}

const HomePage = lazyPage(() => import("./pages/HomePage"), "HomePage");
const ClassesPage = lazyPage(
  () => import("./pages/ClassesPage"),
  "ClassesPage",
);
const MyBookingsPage = lazyPage(
  () => import("./pages/MyBookingsPage"),
  "MyBookingsPage",
);
const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
const SignupPage = lazyPage(() => import("./pages/SignupPage"), "SignupPage");
const RecoverAccountPage = lazyPage(
  () => import("./pages/RecoverAccountPage"),
  "RecoverAccountPage",
);
const VerifyEmailPage = lazyPage(
  () => import("./pages/VerifyEmailPage"),
  "VerifyEmailPage",
);
const TrainerDashboardPage = lazyPage(
  () => import("./pages/TrainerDashboardPage"),
  "TrainerDashboardPage",
);
const AdminDashboardPage = lazyPage(
  () => import("./pages/AdminDashboardPage"),
  "AdminDashboardPage",
);
const ActivityDashboardPage = lazyPage(
  () => import("./pages/ActivityDashboardPage"),
  "ActivityDashboardPage",
);
const TrainerAnalyticsDashboardPage = lazyPage(
  () => import("./pages/TrainerAnalyticsDashboardPage"),
  "TrainerAnalyticsDashboardPage",
);
const AdminAnalyticsDashboardPage = lazyPage(
  () => import("./pages/AdminAnalyticsDashboardPage"),
  "AdminAnalyticsDashboardPage",
);
const UnauthorizedPage = lazyPage(
  () => import("./pages/UnauthorizedPage"),
  "UnauthorizedPage",
);
const LegalNoticePage = lazyPage(
  () => import("./pages/LegalPage"),
  "LegalNoticePage",
);
const TermsAndConditionsPage = lazyPage(
  () => import("./pages/LegalPage"),
  "TermsAndConditionsPage",
);
const ConditionsOfUsePage = lazyPage(
  () => import("./pages/LegalPage"),
  "ConditionsOfUsePage",
);
const AccountSecurityPage = lazyPage(
  () => import("./pages/AccountSecurityPage"),
  "AccountSecurityPage",
);
const FeedbackPage = lazyPage(
  () => import("./pages/FeedbackPage"),
  "FeedbackPage",
);
const MemberPaymentsPage = lazyPage(
  () => import("./pages/MemberPaymentsPage"),
  "MemberPaymentsPage",
);
const AccountControlPage = lazyPage(
  () => import("./pages/AccountControlPage"),
  "AccountControlPage",
);
const AccountLifecyclePage = lazyPage(
  () => import("./pages/AccountLifecyclePage"),
  "AccountLifecyclePage",
);
const AccountContinuityPage = lazyPage(
  () => import("./pages/AccountContinuityPage"),
  "AccountContinuityPage",
);
const AccountDataDeletionPage = lazyPage(
  () => import("./pages/AccountDataDeletionPage"),
  "AccountDataDeletionPage",
);
const WorkoutTimerPage = lazyPage(
  () => import("./pages/WorkoutTimerPage"),
  "WorkoutTimerPage",
);
const DownloadsPage = lazyPage(
  () => import("./pages/DownloadsPage"),
  "DownloadsPage",
);
const ResourceManagerPage = lazyPage(
  () => import("./pages/ResourceManagerPage"),
  "ResourceManagerPage",
);
const SecurityManagerPage = lazyPage(
  () => import("./pages/SecurityManagerPage"),
  "SecurityManagerPage",
);
const EnvironmentManagerPage = lazyPage(
  () => import("./pages/EnvironmentManagerPage"),
  "EnvironmentManagerPage",
);
const EmailManagerPage = lazyPage(
  () => import("./pages/EmailManagerPage"),
  "EmailManagerPage",
);
const CapabilityRoadmapPage = lazyPage(
  () => import("./pages/CapabilityRoadmapPage"),
  "CapabilityRoadmapPage",
);
const BillingPage = lazyPage(
  () => import("./pages/BillingPage"),
  "BillingPage",
);
const DataRetentionPage = lazyPage(
  () => import("./pages/DataRetentionPage"),
  "DataRetentionPage",
);
const CommercialPage = lazyPage(
  () => import("./pages/CommercialPage"),
  "CommercialPage",
);
const CommercialTrialPage = lazyPage(
  () => import("./pages/CommercialTrialPage"),
  "CommercialTrialPage",
);
const SessionContentPage = lazyPage(
  () => import("./pages/SessionContentPage"),
  "SessionContentPage",
);
const CommunityPage = lazyPage(
  () => import("./pages/CommunityPage"),
  "CommunityPage",
);
const ModerationPage = lazyPage(
  () => import("./pages/ModerationPage"),
  "ModerationPage",
);
const SupportPage = lazyPage(
  () => import("./pages/SupportPage"),
  "SupportPage",
);

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole | UserRole[];
  allowPending?: boolean;
  platformOperatorOnly?: boolean;
}

function ProtectedRoute({
  children,
  requiredRole,
  allowPending = false,
  platformOperatorOnly = false,
}: ProtectedRouteProps) {
  const { t } = useTranslation();
  const { user, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowPending && user.accountStatus !== "active") {
    return (
      <Navigate
        to={
          user.accountStatus === "pending_verification"
            ? "/verify-email"
            : "/recover-account"
        }
        replace
      />
    );
  }

  if (platformOperatorOnly && user.platformOperator !== true) {
    return <UnauthorizedPage />;
  }

  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    const accessRole = getAccessRole(user);
    if (!accessRole || !roles.includes(accessRole)) {
      return <UnauthorizedPage />;
    }
  }

  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const { user, isInitializing } = useAuth();
  const { pathname } = useLocation();
  const isShelllessPage =
    (pathname === "/" && !user) ||
    [
      "/login",
      "/signup",
      "/recover-account",
      "/verify-email",
      "/unauthorized",
      "/commercial",
      "/legal-notice",
      "/terms-and-conditions",
      "/conditions-of-use",
    ].includes(pathname);

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <>
      {user?.accountStatus === "active" && !isShelllessPage && <Navigation />}
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center text-slate-600">
            {t("common.loading")}
          </div>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              user ? (
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              ) : (
                <CommercialPage />
              )
            }
          />
          <Route
            path="/classes"
            element={
              <ProtectedRoute>
                <ClassesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute>
                <MyBookingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/classes/:id/session-content"
            element={
              <ProtectedRoute>
                <SessionContentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/community"
            element={
              <ProtectedRoute>
                <CommunityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedRoute>
                <SupportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/moderation"
            element={
              <ProtectedRoute>
                <ModerationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountControlPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account/security"
            element={
              <ProtectedRoute>
                <AccountSecurityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account/lifecycle"
            element={
              <ProtectedRoute>
                <AccountLifecyclePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account/continuity"
            element={
              <ProtectedRoute>
                <AccountContinuityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account/delete-data"
            element={
              <ProtectedRoute>
                <AccountDataDeletionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-payments"
            element={
              <ProtectedRoute requiredRole="member">
                <MemberPaymentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workout-timer"
            element={
              <ProtectedRoute requiredRole="member">
                <WorkoutTimerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/downloads"
            element={
              <ProtectedRoute>
                <DownloadsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/resource-manager"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <ResourceManagerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/security-manager"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <SecurityManagerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/environment-manager"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <EnvironmentManagerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/email-manager"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <EmailManagerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/capability-roadmap"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <CapabilityRoadmapPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute requiredRole="admin">
                <BillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/data-retention"
            element={
              <ProtectedRoute requiredRole="admin" platformOperatorOnly>
                <DataRetentionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/commercial-trial"
            element={
              <ProtectedRoute requiredRole="admin">
                <CommercialTrialPage />
              </ProtectedRoute>
            }
          />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route
            path="/trainer-dashboard"
            element={
              <ProtectedRoute requiredRole="trainer">
                <TrainerDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin-dashboard"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity-dashboard"
            element={
              <ProtectedRoute requiredRole="member">
                <ActivityDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trainer-analytics"
            element={
              <ProtectedRoute requiredRole="trainer">
                <TrainerAnalyticsDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin-analytics"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminAnalyticsDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={
              user?.accountStatus === "active" ? (
                <Navigate to="/" replace />
              ) : (
                <LoginPage />
              )
            }
          />
          <Route path="/commercial" element={<CommercialPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/recover-account" element={<RecoverAccountPage />} />
          <Route
            path="/verify-email"
            element={
              <ProtectedRoute allowPending>
                <VerifyEmailPage />
              </ProtectedRoute>
            }
          />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/legal-notice" element={<LegalNoticePage />} />
          <Route
            path="/terms-and-conditions"
            element={<TermsAndConditionsPage />}
          />
          <Route path="/conditions-of-use" element={<ConditionsOfUsePage />} />
          <Route
            path="*"
            element={<Navigate to={user ? "/" : "/login"} replace />}
          />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
