import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  Bell,
  ClipboardList,
  Clock3,
  Eye,
  EyeOff,
  FilePenLine,
  Inbox,
  LayoutGrid,
  Link2,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  approveAdministratorAccount,
  cancelScheduledMail,
  createCollaborationSpace,
  createTicket,
  fetchCapabilities,
  fetchAdministratorAccounts,
  fetchCollaborationSpaces,
  fetchMailbox,
  fetchMailDrafts,
  fetchNotificationSettings,
  fetchStaff,
  fetchSupportSession,
  fetchTicket,
  fetchTickets,
  logoutSupport,
  registerPushSubscription,
  replyTicket,
  revokePushSubscription,
  saveMailDraft,
  submitMailDraft,
  updateCollaborationSpace,
  updateStaff,
  updateTicket,
  updateNotificationSettings,
  type UmfMailboxMessage,
  type UmfSupportBrowserFamily,
  type UmfSupportAdministratorAccount,
  type UmfSupportCollaborationSpace,
  type UmfSupportMailDraft,
  type UmfSupportNotificationEvent,
  type UmfSupportNotificationSettings,
  type UmfSupportCapabilities,
  type UmfSupportStaffMember,
  type UmfSupportTicket,
  type UmfSupportTicketSummary,
  type UmfSupportSessionUser,
  type UmfTicketPriority,
  type UmfTicketCategory,
  type UmfTicketStatus,
} from "../lib/umf-support";

type View =
  | "tickets"
  | "inbox"
  | "drafts"
  | "scheduled"
  | "outbox"
  | "sent"
  | "notifications"
  | "team"
  | "collaboration";
const notificationEvents: UmfSupportNotificationEvent[] = [
  "ticket_created",
  "conversation_received",
  "inbound_email",
  "feedback_received",
  "problem_reported",
];
const statuses: UmfTicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_requester",
  "resolved",
  "closed",
];
const priorities: UmfTicketPriority[] = ["low", "normal", "high", "urgent"];
const categories: UmfTicketCategory[] = [
  "general",
  "account",
  "billing",
  "privacy",
  "technical",
  "security",
];
function formatDate(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function recipients(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function browserFamily(): Promise<UmfSupportBrowserFamily | null> {
  const userAgent = navigator.userAgent;
  const braveNavigator = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> };
  };
  if (/Edg\//.test(userAgent)) return "edge";
  if (/DuckDuckGo|Ddg/i.test(userAgent)) return "duckduckgo";
  if (/LibreWolf/i.test(userAgent)) return "librewolf";
  if (await braveNavigator.brave?.isBrave?.().catch(() => false))
    return "brave";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/(?:Chrome|CriOS)\//.test(userAgent)) return "chrome";
  return null;
}

export function UmfSupportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState<UmfSupportSessionUser | null | undefined>(
    undefined,
  );
  const [capabilities, setCapabilities] =
    useState<UmfSupportCapabilities | null>(null);
  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<UmfSupportTicketSummary[]>([]);
  const [selected, setSelected] = useState<UmfSupportTicket | null>(null);
  const [mail, setMail] = useState<UmfMailboxMessage[]>([]);
  const [mailDrafts, setMailDrafts] = useState<UmfSupportMailDraft[]>([]);
  const [notificationSettings, setNotificationSettings] =
    useState<UmfSupportNotificationSettings | null>(null);
  const [staff, setStaff] = useState<UmfSupportStaffMember[]>([]);
  const [administratorAccounts, setAdministratorAccounts] = useState<
    UmfSupportAdministratorAccount[]
  >([]);
  const [collaborationSpaces, setCollaborationSpaces] = useState<
    UmfSupportCollaborationSpace[]
  >([]);
  const [newSpace, setNewSpace] = useState({ name: "", description: "" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | undefined>();
  const [showCopyFields, setShowCopyFields] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [linkEditor, setLinkEditor] = useState({ label: "", url: "" });
  const [mailComposer, setMailComposer] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
  });
  const [newTicket, setNewTicket] = useState({
    requesterEmail: "",
    requesterName: "",
    organizationName: "",
    subject: "",
    message: "",
    category: "general" as UmfTicketCategory,
    priority: "normal" as UmfTicketPriority,
  });
  const normalizedError = useCallback(
    (
      cause: unknown,
      fallbackKey: "umfSupport.errors.load" | "umfSupport.errors.save",
    ) => {
      const fallback = t(fallbackKey);
      return cause instanceof Error
        ? t(`umfSupport.errors.codes.${cause.message}`, {
            defaultValue: fallback,
          })
        : fallback;
    },
    [t],
  );

  const refreshTickets = useCallback(async () => {
    setTickets(
      await fetchTickets({
        q: query.trim() || undefined,
        status: status || undefined,
      }),
    );
  }, [query, status]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = capabilities ?? (await fetchCapabilities());
      setCapabilities(current);
      if (view === "tickets") {
        const [, currentStaff] = await Promise.all([
          refreshTickets(),
          fetchStaff(),
        ]);
        setStaff(currentStaff);
        if (selected) setSelected(await fetchTicket(selected.id));
      } else if (view === "inbox") {
        setMail(await fetchMailbox("inbound"));
      } else if (["drafts", "scheduled", "outbox", "sent"].includes(view)) {
        const [drafts, sentMessages] = await Promise.all([
          fetchMailDrafts(),
          view === "sent" ? fetchMailbox("outbound") : Promise.resolve([]),
        ]);
        setMailDrafts(drafts);
        setMail(sentMessages);
      } else if (view === "notifications") {
        setNotificationSettings(await fetchNotificationSettings());
      } else if (view === "team") {
        const [currentStaff, accounts] = await Promise.all([
          fetchStaff(),
          current.canManageAdministrators
            ? fetchAdministratorAccounts()
            : Promise.resolve([]),
        ]);
        setStaff(currentStaff);
        setAdministratorAccounts(accounts);
      } else if (view === "collaboration") {
        setCollaborationSpaces(await fetchCollaborationSpaces());
      }
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [capabilities, normalizedError, refreshTickets, selected, view]);

  useEffect(() => {
    void fetchSupportSession()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) void refresh();
    // Selected tickets are refreshed explicitly after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view, query, status]);

  const selectTicket = async (ticketId: string) => {
    setWorking(true);
    setError("");
    try {
      setSelected(await fetchTicket(ticketId));
      setShowCreate(false);
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.load"));
    } finally {
      setWorking(false);
    }
  };

  const submitNewTicket = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try {
      const created = await createTicket(newTicket);
      setNewTicket({
        requesterEmail: "",
        requesterName: "",
        organizationName: "",
        subject: "",
        message: "",
        category: "general",
        priority: "normal",
      });
      await refreshTickets();
      await selectTicket(created.id);
      setNotice(
        t("umfSupport.notices.ticketCreated", { id: created.publicId }),
      );
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setWorking(true);
    try {
      setSelected(
        await replyTicket(selected.id, {
          body: reply,
          internal,
          sendEmail: internal ? false : sendEmail,
        }),
      );
      setReply("");
      setInternal(false);
      await refreshTickets();
      setNotice(t("umfSupport.notices.replySaved"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const changeTicket = async (input: {
    status?: UmfTicketStatus;
    priority?: UmfTicketPriority;
    assigneeUserId?: string | null;
    category?: UmfTicketCategory;
  }) => {
    if (!selected) return;
    setWorking(true);
    try {
      setSelected(await updateTicket(selected.id, input));
      await refreshTickets();
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const queueCounts = useMemo(
    () => ({
      active: tickets.filter(
        (ticket) => !["resolved", "closed"].includes(ticket.status),
      ).length,
      urgent: tickets.filter(
        (ticket) =>
          ticket.priority === "urgent" &&
          !["resolved", "closed"].includes(ticket.status),
      ).length,
    }),
    [tickets],
  );

  const approveAdministrator = async (userId: string) => {
    setWorking(true);
    setError("");
    try {
      await approveAdministratorAccount(userId);
      const [accounts, currentStaff] = await Promise.all([
        fetchAdministratorAccounts(),
        fetchStaff(),
      ]);
      setAdministratorAccounts(accounts);
      setStaff(currentStaff);
      setNotice(t("umfSupport.notices.administratorApproved"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const submitCollaborationSpace = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await createCollaborationSpace(newSpace);
      setNewSpace({ name: "", description: "" });
      setCollaborationSpaces(await fetchCollaborationSpaces());
      setNotice(t("umfSupport.notices.collaborationDraftCreated"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const changeCollaborationVisibility = async (
    space: UmfSupportCollaborationSpace,
  ) => {
    setWorking(true);
    setError("");
    try {
      const publishing =
        space.status !== "published" || space.visibility !== "staff";
      await updateCollaborationSpace(space.id, {
        visibility: publishing ? "staff" : "hidden",
        status: publishing ? "published" : "draft",
      });
      setCollaborationSpaces(await fetchCollaborationSpaces());
      setNotice(
        t(
          publishing
            ? "umfSupport.notices.collaborationPublished"
            : "umfSupport.notices.collaborationHidden",
        ),
      );
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const draftInput = () => ({
    to: recipients(mailComposer.to),
    cc: recipients(mailComposer.cc),
    bcc: recipients(mailComposer.bcc),
    subject: mailComposer.subject,
    body: mailComposer.body,
  });

  const resetComposer = () => {
    setMailComposer({ to: "", cc: "", bcc: "", subject: "", body: "" });
    setEditingDraftId(undefined);
    setScheduleAt("");
    setShowCopyFields(false);
    setLinkEditor({ label: "", url: "" });
  };

  const openDraft = (draft: UmfSupportMailDraft) => {
    if (draft.status !== "draft") return;
    setMailComposer({
      to: draft.to.join("; "),
      cc: draft.cc.join("; "),
      bcc: draft.bcc.join("; "),
      subject: draft.subject,
      body: draft.body,
    });
    setEditingDraftId(draft.id);
    setShowCopyFields(draft.cc.length > 0 || draft.bcc.length > 0);
    setShowCompose(true);
  };

  const saveComposerDraft = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await saveMailDraft(draftInput(), editingDraftId);
      setEditingDraftId(result.draft.id);
      setMailDrafts(await fetchMailDrafts());
      setNotice(t("umfSupport.notices.mailDraftSaved"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const dispatchComposer = async (scheduled: boolean) => {
    setWorking(true);
    setError("");
    try {
      const result = await saveMailDraft(draftInput(), editingDraftId);
      const scheduledAt = scheduled
        ? new Date(scheduleAt).getTime()
        : undefined;
      if (scheduled && (!scheduleAt || !Number.isFinite(scheduledAt))) {
        throw new Error(t("umfSupport.errors.invalidSchedule"));
      }
      await submitMailDraft(result.draft.id, scheduledAt);
      resetComposer();
      setShowCompose(false);
      setMailDrafts(await fetchMailDrafts());
      setView(scheduled ? "scheduled" : "outbox");
      setNotice(
        t(
          scheduled
            ? "umfSupport.notices.mailScheduled"
            : "umfSupport.notices.mailQueued",
        ),
      );
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  const insertControlledLink = () => {
    const label = linkEditor.label.trim();
    const url = linkEditor.url.trim();
    if (!label || !/^(?:https:\/\/|mailto:)/i.test(url)) {
      setError(t("umfSupport.errors.invalidLink"));
      return;
    }
    setMailComposer((current) => ({
      ...current,
      body: `${current.body}${current.body && !current.body.endsWith("\n") ? "\n" : ""}[${label}](${url})`,
    }));
    setLinkEditor({ label: "", url: "" });
  };

  const saveNotificationPreferences = async (
    next: UmfSupportNotificationSettings,
  ) => {
    setNotificationSettings(next);
    try {
      await updateNotificationSettings({
        enabled: next.enabled,
        preferences: next.preferences,
      });
      setNotice(t("umfSupport.notices.notificationSettingsSaved"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
      setNotificationSettings(await fetchNotificationSettings());
    }
  };

  const enablePushForThisDevice = async () => {
    if (!notificationSettings?.push.publicKey) return;
    setWorking(true);
    setError("");
    try {
      const family = await browserFamily();
      if (!family) throw new Error(t("umfSupport.errors.browserNotAllowed"));
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error(t("umfSupport.errors.pushUnsupported"));
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(t("umfSupport.errors.pushPermissionDenied"));
      }
      const registration = await navigator.serviceWorker.register(
        "/umf-support-sw.js",
        { scope: "/" },
      );
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(
            notificationSettings.push.publicKey,
          ),
        }));
      await registerPushSubscription({
        subscription: subscription.toJSON(),
        browserFamily: family,
        deviceName: `${t(`umfSupport.browser.${family}`)} · ${navigator.platform || t("umfSupport.thisDevice")}`,
      });
      setNotificationSettings(await fetchNotificationSettings());
      setNotice(t("umfSupport.notices.pushEnabled"));
    } catch (cause) {
      setError(normalizedError(cause, "umfSupport.errors.save"));
    } finally {
      setWorking(false);
    }
  };

  if (user === undefined)
    return <p className="p-8 text-slate-600">{t("common.loading")}</p>;
  if (!user) return <Navigate to="/umf-support/access" replace />;

  const tabs: Array<{ id: View; icon: typeof Inbox; hidden?: boolean }> = [
    { id: "tickets", icon: ClipboardList },
    { id: "inbox", icon: Inbox },
    { id: "drafts", icon: FilePenLine },
    { id: "scheduled", icon: Clock3 },
    { id: "outbox", icon: Send },
    { id: "sent", icon: Mail },
    { id: "notifications", icon: Bell },
    { id: "team", icon: Users },
    { id: "collaboration", icon: LayoutGrid },
  ];

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-300 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[112rem] items-center gap-4 px-4 py-3 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white p-1">
            <img
              src="/brand/umf-support-mark.png"
              alt=""
              className="h-full w-full object-contain"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold tracking-tight">UMF Support</p>
            <p className="truncate text-xs text-slate-400">
              {t("umfSupport.corporateOperations")}
            </p>
          </div>
          <span className="hidden rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 sm:inline">
            {capabilities ? t(`umfSupport.role.${capabilities.role}`) : "—"}
          </span>
          <LanguageSwitcher />
          <Link
            to="/umf-support/account"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            <ShieldCheck size={17} />
            <span className="hidden sm:inline">
              {t("umfCorporateAccount.shortTitle")}
            </span>
          </Link>
          <Button
            variant="ghost"
            className="text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() =>
              void logoutSupport().then(() => navigate("/umf-support/access"))
            }
          >
            <LogOut size={17} />{" "}
            <span className="hidden sm:inline">{t("umfSupport.logout")}</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[112rem] gap-0 px-0 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-6 lg:py-6">
        <aside className="border-b border-slate-300 bg-white p-3 lg:rounded-l-xl lg:border lg:border-r-0">
          <nav
            className="flex gap-1 overflow-x-auto lg:flex-col"
            aria-label={t("umfSupport.navigation")}
          >
            {tabs
              .filter((tab) => !tab.hidden)
              .map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setView(tab.id);
                      setSelected(null);
                      setError("");
                      setNotice("");
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold ${view === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
                  >
                    <Icon size={17} /> {t(`umfSupport.tabs.${tab.id}`)}
                  </button>
                );
              })}
          </nav>
          <div className="mt-5 hidden space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500 lg:block">
            <p>
              {t("umfSupport.activeTickets", { count: queueCounts.active })}
            </p>
            <p>
              {t("umfSupport.urgentTickets", { count: queueCounts.urgent })}
            </p>
          </div>
        </aside>

        <section className="min-w-0 border-slate-300 bg-white p-4 sm:p-6 lg:min-h-[calc(100vh-8rem)] lg:rounded-r-xl lg:border">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-5">
            <div>
              <h1 className="text-xl font-bold">
                {t(`umfSupport.headings.${view}`)}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {t(`umfSupport.descriptions.${view}`)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {["inbox", "drafts", "scheduled", "outbox", "sent"].includes(
                view,
              ) && (
                <Button
                  className="bg-slate-900 hover:bg-slate-800"
                  onClick={() => {
                    resetComposer();
                    setShowCompose(true);
                  }}
                >
                  <FilePenLine size={16} /> {t("umfSupport.compose")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw
                  className={loading ? "animate-spin" : ""}
                  size={16}
                />{" "}
                {t("umfSupport.refresh")}
              </Button>
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {notice}
            </p>
          )}
          {view === "tickets" && (
            <>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    className="absolute left-3 top-2.5 text-slate-400"
                    size={17}
                  />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="pl-9"
                    placeholder={t("umfSupport.search")}
                  />
                </div>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">{t("umfSupport.allStatuses")}</option>
                  {statuses.map((item) => (
                    <option key={item} value={item}>
                      {t(`umfSupport.status.${item}`)}
                    </option>
                  ))}
                </select>
                <Button
                  className="bg-slate-900 hover:bg-slate-800"
                  onClick={() => {
                    setShowCreate(true);
                    setSelected(null);
                  }}
                >
                  <Plus size={16} /> {t("umfSupport.newTicket")}
                </Button>
              </div>
              <div className="grid min-h-[35rem] gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
                <div className="max-h-[42rem] overflow-y-auto rounded-lg border border-slate-200">
                  {tickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => void selectTicket(ticket.id)}
                      className={`block w-full border-b border-slate-200 p-3 text-left last:border-0 ${selected?.id === ticket.id ? "bg-slate-100" : "hover:bg-slate-50"}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono">{ticket.publicId}</span>
                        <span>
                          {t(`umfSupport.priority.${ticket.priority}`)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">
                        {ticket.subject}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {ticket.requesterName} ·{" "}
                        {ticket.organizationName || ticket.requesterEmail}
                      </p>
                    </button>
                  ))}
                  {!loading && tickets.length === 0 && (
                    <p className="p-6 text-center text-sm text-slate-500">
                      {t("umfSupport.emptyTickets")}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  {showCreate ? (
                    <form onSubmit={submitNewTicket} className="space-y-4">
                      <h2 className="font-bold">
                        {t("umfSupport.createTitle")}
                      </h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="requester-name">
                            {t("umfSupport.requesterName")}
                          </Label>
                          <Input
                            id="requester-name"
                            value={newTicket.requesterName}
                            onChange={(e) =>
                              setNewTicket({
                                ...newTicket,
                                requesterName: e.target.value,
                              })
                            }
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="requester-email">
                            {t("common.email")}
                          </Label>
                          <Input
                            id="requester-email"
                            type="email"
                            value={newTicket.requesterEmail}
                            onChange={(e) =>
                              setNewTicket({
                                ...newTicket,
                                requesterEmail: e.target.value,
                              })
                            }
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="organization">
                          {t("umfSupport.organization")}
                        </Label>
                        <Input
                          id="organization"
                          value={newTicket.organizationName}
                          onChange={(e) =>
                            setNewTicket({
                              ...newTicket,
                              organizationName: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="subject">
                          {t("umfSupport.subject")}
                        </Label>
                        <Input
                          id="subject"
                          value={newTicket.subject}
                          onChange={(e) =>
                            setNewTicket({
                              ...newTicket,
                              subject: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="new-ticket-category">
                            {t("umfSupport.category")}
                          </Label>
                          <select
                            id="new-ticket-category"
                            value={newTicket.category}
                            onChange={(e) =>
                              setNewTicket({
                                ...newTicket,
                                category: e.target.value as UmfTicketCategory,
                              })
                            }
                            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                          >
                            {categories.map((item) => (
                              <option key={item} value={item}>
                                {t(`umfSupport.categoryValue.${item}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="new-ticket-priority">
                            {t("umfSupport.priorityLabel")}
                          </Label>
                          <select
                            id="new-ticket-priority"
                            value={newTicket.priority}
                            onChange={(e) =>
                              setNewTicket({
                                ...newTicket,
                                priority: e.target.value as UmfTicketPriority,
                              })
                            }
                            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                          >
                            {priorities.map((item) => (
                              <option key={item} value={item}>
                                {t(`umfSupport.priority.${item}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="message">
                          {t("umfSupport.message")}
                        </Label>
                        <textarea
                          id="message"
                          value={newTicket.message}
                          onChange={(e) =>
                            setNewTicket({
                              ...newTicket,
                              message: e.target.value,
                            })
                          }
                          className="mt-1 min-h-36 w-full rounded-md border border-slate-300 p-3 text-sm"
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={working}
                        className="bg-slate-900 hover:bg-slate-800"
                      >
                        <Plus size={16} /> {t("umfSupport.createAction")}
                      </Button>
                    </form>
                  ) : selected ? (
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                        <div>
                          <p className="font-mono text-xs text-slate-500">
                            {selected.publicId}
                          </p>
                          <h2 className="mt-1 text-lg font-bold">
                            {selected.subject}
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">
                            {selected.requesterName} · {selected.requesterEmail}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            aria-label={t("umfSupport.assignee")}
                            value={selected.assigneeUserId ?? ""}
                            onChange={(e) =>
                              void changeTicket({
                                assigneeUserId: e.target.value || null,
                              })
                            }
                            className="rounded-md border border-slate-300 px-2 text-xs"
                          >
                            <option value="">
                              {t("umfSupport.unassigned")}
                            </option>
                            {staff
                              .filter((member) => member.status === "active")
                              .map((member) => (
                                <option
                                  key={member.userId}
                                  value={member.userId}
                                >
                                  {member.name} {member.lastName}
                                </option>
                              ))}
                          </select>
                          <select
                            aria-label={t("umfSupport.category")}
                            value={selected.category}
                            onChange={(e) =>
                              void changeTicket({
                                category: e.target.value as UmfTicketCategory,
                              })
                            }
                            className="rounded-md border border-slate-300 px-2 text-xs"
                          >
                            {categories.map((item) => (
                              <option key={item} value={item}>
                                {t(`umfSupport.categoryValue.${item}`)}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={t("umfSupport.statusLabel")}
                            value={selected.status}
                            onChange={(e) =>
                              void changeTicket({
                                status: e.target.value as UmfTicketStatus,
                              })
                            }
                            className="rounded-md border border-slate-300 px-2 text-xs"
                          >
                            {statuses.map((item) => (
                              <option key={item} value={item}>
                                {t(`umfSupport.status.${item}`)}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={t("umfSupport.priorityLabel")}
                            value={selected.priority}
                            onChange={(e) =>
                              void changeTicket({
                                priority: e.target.value as UmfTicketPriority,
                              })
                            }
                            className="rounded-md border border-slate-300 px-2 text-xs"
                          >
                            {priorities.map((item) => (
                              <option key={item} value={item}>
                                {t(`umfSupport.priority.${item}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="max-h-96 space-y-3 overflow-y-auto py-4">
                        {selected.messages.map((message) => (
                          <article
                            key={message.id}
                            className={`rounded-lg border p-3 ${message.direction === "internal" ? "border-amber-200 bg-amber-50" : message.direction === "outbound" ? "border-slate-300 bg-slate-100" : "border-slate-200 bg-white"}`}
                          >
                            <div className="flex justify-between gap-3 text-xs text-slate-500">
                              <span>
                                {message.direction === "internal"
                                  ? t("umfSupport.internal")
                                  : message.sender}
                              </span>
                              <span>
                                {formatDate(message.createdAt, i18n.language)}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                              {message.body}
                            </p>
                            {message.deliveryStatus && (
                              <p className="mt-2 text-xs text-slate-500">
                                {t("umfSupport.delivery")}:{" "}
                                {message.deliveryStatus}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                      <form
                        onSubmit={submitReply}
                        className="border-t border-slate-200 pt-4"
                      >
                        <Label htmlFor="reply">{t("umfSupport.reply")}</Label>
                        <textarea
                          id="reply"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          className="mt-1 min-h-28 w-full rounded-md border border-slate-300 p-3 text-sm"
                          required
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={internal}
                              onChange={(e) => setInternal(e.target.checked)}
                            />{" "}
                            {t("umfSupport.internalNote")}
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={sendEmail && !internal}
                              disabled={internal}
                              onChange={(e) => setSendEmail(e.target.checked)}
                            />{" "}
                            {t("umfSupport.sendEmail")}
                          </label>
                          <Button
                            type="submit"
                            disabled={working}
                            className="ml-auto bg-slate-900 hover:bg-slate-800"
                          >
                            <MessageSquare size={16} />{" "}
                            {t("umfSupport.saveReply")}
                          </Button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <div className="flex min-h-80 flex-col items-center justify-center text-center text-slate-500">
                      <MessageSquare size={28} />
                      <p className="mt-3 text-sm">
                        {t("umfSupport.selectTicket")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {["inbox", "drafts", "scheduled", "outbox", "sent"].includes(
            view,
          ) && (
            <div className="space-y-5">
              {showCompose && (
                <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <h2 className="font-bold">{t("umfSupport.compose")}</h2>
                      <p className="text-xs text-slate-500">
                        {t("umfSupport.composeHint")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        resetComposer();
                        setShowCompose(false);
                      }}
                    >
                      {t("common.close")}
                    </Button>
                  </div>
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center">
                      <Label htmlFor="mail-to">{t("umfSupport.mail.to")}</Label>
                      <Input
                        id="mail-to"
                        type="text"
                        value={mailComposer.to}
                        onChange={(event) =>
                          setMailComposer({
                            ...mailComposer,
                            to: event.target.value,
                          })
                        }
                        placeholder={t("umfSupport.mail.recipientPlaceholder")}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => setShowCopyFields(!showCopyFields)}
                      >
                        {t("umfSupport.mail.showCopies")}
                      </Button>
                    </div>
                    {showCopyFields && (
                      <div className="grid gap-3">
                        <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
                          <Label htmlFor="mail-cc">
                            {t("umfSupport.mail.cc")}
                          </Label>
                          <Input
                            id="mail-cc"
                            value={mailComposer.cc}
                            onChange={(event) =>
                              setMailComposer({
                                ...mailComposer,
                                cc: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
                          <Label htmlFor="mail-bcc">
                            {t("umfSupport.mail.bcc")}
                          </Label>
                          <Input
                            id="mail-bcc"
                            value={mailComposer.bcc}
                            onChange={(event) =>
                              setMailComposer({
                                ...mailComposer,
                                bcc: event.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
                      <Label htmlFor="mail-subject">
                        {t("umfSupport.subject")}
                      </Label>
                      <Input
                        id="mail-subject"
                        maxLength={200}
                        value={mailComposer.subject}
                        onChange={(event) =>
                          setMailComposer({
                            ...mailComposer,
                            subject: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                        <Input
                          aria-label={t("umfSupport.mail.linkText")}
                          placeholder={t("umfSupport.mail.linkText")}
                          value={linkEditor.label}
                          onChange={(event) =>
                            setLinkEditor({
                              ...linkEditor,
                              label: event.target.value,
                            })
                          }
                        />
                        <Input
                          aria-label={t("umfSupport.mail.linkUrl")}
                          placeholder="https://"
                          value={linkEditor.url}
                          onChange={(event) =>
                            setLinkEditor({
                              ...linkEditor,
                              url: event.target.value,
                            })
                          }
                        />
                        <Button
                          variant="outline"
                          onClick={insertControlledLink}
                        >
                          <Link2 size={16} /> {t("umfSupport.mail.insertLink")}
                        </Button>
                      </div>
                    </div>
                    <textarea
                      aria-label={t("umfSupport.message")}
                      value={mailComposer.body}
                      onChange={(event) =>
                        setMailComposer({
                          ...mailComposer,
                          body: event.target.value,
                        })
                      }
                      className="min-h-72 w-full resize-y rounded-lg border border-slate-300 p-4 text-sm leading-6"
                      maxLength={20000}
                    />
                    <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
                      <Button
                        variant="outline"
                        disabled={working}
                        onClick={() => void saveComposerDraft()}
                      >
                        <FilePenLine size={16} />{" "}
                        {t("umfSupport.mail.saveDraft")}
                      </Button>
                      <div>
                        <Label htmlFor="mail-schedule">
                          {t("umfSupport.mail.scheduleAt")}
                        </Label>
                        <Input
                          id="mail-schedule"
                          type="datetime-local"
                          value={scheduleAt}
                          onChange={(event) =>
                            setScheduleAt(event.target.value)
                          }
                        />
                      </div>
                      <Button
                        variant="outline"
                        disabled={working || !scheduleAt}
                        onClick={() => void dispatchComposer(true)}
                      >
                        <Clock3 size={16} /> {t("umfSupport.mail.schedule")}
                      </Button>
                      <Button
                        className="ml-auto bg-slate-900 hover:bg-slate-800"
                        disabled={working}
                        onClick={() => void dispatchComposer(false)}
                      >
                        <Send size={16} /> {t("umfSupport.mail.sendNow")}
                      </Button>
                    </div>
                  </div>
                </section>
              )}

              {view === "inbox" || view === "sent" ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  {mail.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => {
                        setView("tickets");
                        void selectTicket(message.ticketId);
                      }}
                      className="grid w-full gap-2 border-b border-slate-200 p-4 text-left last:border-0 hover:bg-slate-50 sm:grid-cols-[10rem_minmax(0,1fr)_10rem]"
                    >
                      <div>
                        <p className="font-mono text-xs text-slate-500">
                          {message.publicId}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold">
                          {view === "inbox"
                            ? message.sender
                            : message.recipient}
                        </p>
                      </div>
                      <div>
                        <p className="truncate text-sm font-semibold">
                          {message.subject}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {message.body}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 sm:text-right">
                        <p>{formatDate(message.createdAt, i18n.language)}</p>
                        {message.deliveryStatus && (
                          <p className="mt-1">
                            {t(
                              `umfSupport.deliveryStatus.${message.deliveryStatus}`,
                              { defaultValue: message.deliveryStatus },
                            )}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                  {!loading && mail.length === 0 && view === "inbox" && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      {t("umfSupport.emptyMailbox")}
                    </p>
                  )}
                </div>
              ) : null}

              {view !== "inbox" && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  {mailDrafts
                    .filter((draft) =>
                      view === "drafts"
                        ? draft.status === "draft"
                        : view === "scheduled"
                          ? draft.status === "scheduled"
                          : view === "outbox"
                            ? [
                                "outbox",
                                "failed",
                                "partially_failed",
                                "cancelled",
                              ].includes(draft.status)
                            : draft.status === "sent",
                    )
                    .map((draft) => (
                      <article
                        key={draft.id}
                        className="grid gap-3 border-b border-slate-200 p-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center"
                      >
                        <button
                          type="button"
                          disabled={draft.status !== "draft"}
                          onClick={() => openDraft(draft)}
                          className="min-w-0 text-left disabled:cursor-default"
                        >
                          <p className="truncate font-semibold">
                            {draft.subject}
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {draft.to.join("; ") ||
                              t("umfSupport.mail.noRecipient")}
                            {draft.cc.length > 0
                              ? ` · ${t("umfSupport.mail.ccCount", { count: draft.cc.length })}`
                              : ""}
                            {draft.bcc.length > 0
                              ? ` · ${t("umfSupport.mail.bccCount", { count: draft.bcc.length })}`
                              : ""}
                          </p>
                        </button>
                        <div className="text-xs text-slate-500">
                          <p>{t(`umfSupport.mailStatus.${draft.status}`)}</p>
                          <p className="mt-1">
                            {formatDate(
                              draft.scheduledAt ??
                                draft.sentAt ??
                                draft.updatedAt,
                              i18n.language,
                            )}
                          </p>
                          {draft.deliveryIssueCount > 0 && (
                            <p className="mt-1 font-semibold text-red-700">
                              {t("umfSupport.mail.deliveryIssues", {
                                count: draft.deliveryIssueCount,
                              })}
                            </p>
                          )}
                        </div>
                        {draft.status === "scheduled" && (
                          <Button
                            variant="outline"
                            disabled={working}
                            onClick={() =>
                              void cancelScheduledMail(draft.id).then(refresh)
                            }
                          >
                            {t("umfSupport.mail.cancelSchedule")}
                          </Button>
                        )}
                      </article>
                    ))}
                  {!loading &&
                    mailDrafts.filter((draft) =>
                      view === "drafts"
                        ? draft.status === "draft"
                        : view === "scheduled"
                          ? draft.status === "scheduled"
                          : view === "outbox"
                            ? [
                                "outbox",
                                "failed",
                                "partially_failed",
                                "cancelled",
                              ].includes(draft.status)
                            : draft.status === "sent",
                    ).length === 0 &&
                    (view !== "sent" || mail.length === 0) && (
                      <p className="p-8 text-center text-sm text-slate-500">
                        {t("umfSupport.mail.emptyFolder")}
                      </p>
                    )}
                </div>
              )}
            </div>
          )}

          {view === "notifications" && notificationSettings && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-bold">
                      {t("umfSupport.notifications.masterTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t("umfSupport.notifications.masterHint")}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={notificationSettings.enabled}
                      onChange={(event) =>
                        void saveNotificationPreferences({
                          ...notificationSettings,
                          enabled: event.target.checked,
                        })
                      }
                    />
                    {t("umfSupport.notifications.enabled")}
                  </label>
                </div>
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200">
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span>{t("umfSupport.notifications.event")}</span>
                  <span className="text-center">
                    {t("umfSupport.notifications.email")}
                  </span>
                  <span className="text-center">
                    {t("umfSupport.notifications.push")}
                  </span>
                </div>
                {notificationEvents.map((event) => (
                  <div
                    key={event}
                    className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-3 border-b border-slate-200 px-4 py-4 last:border-0"
                  >
                    <div>
                      <p className="font-semibold">
                        {t(`umfSupport.notifications.events.${event}.title`)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {t(`umfSupport.notifications.events.${event}.hint`)}
                      </p>
                    </div>
                    {(["email", "push"] as const).map((channel) => (
                      <label
                        key={channel}
                        className="grid place-items-center"
                        aria-label={t(
                          `umfSupport.notifications.events.${event}.${channel}`,
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={
                            notificationSettings.preferences[event][channel]
                          }
                          disabled={
                            !notificationSettings.enabled ||
                            (channel === "push" &&
                              !notificationSettings.push.available)
                          }
                          onChange={(change) =>
                            void saveNotificationPreferences({
                              ...notificationSettings,
                              preferences: {
                                ...notificationSettings.preferences,
                                [event]: {
                                  ...notificationSettings.preferences[event],
                                  [channel]: change.target.checked,
                                },
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </section>

              <section className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-bold">
                      {t("umfSupport.notifications.pushDevices")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {notificationSettings.push.available
                        ? t("umfSupport.notifications.pushHint")
                        : t("umfSupport.notifications.pushUnavailable")}
                    </p>
                  </div>
                  {notificationSettings.push.available && (
                    <Button
                      variant="outline"
                      disabled={working}
                      onClick={() => void enablePushForThisDevice()}
                    >
                      <Bell size={16} />
                      {t("umfSupport.notifications.enableDevice")}
                    </Button>
                  )}
                </div>
                <div className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {notificationSettings.push.devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex flex-wrap items-center gap-3 p-3"
                    >
                      <Bell className="text-slate-400" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {device.deviceName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t(`umfSupport.browser.${device.browserFamily}`)} ·{" "}
                          {t(
                            `umfSupport.notifications.deviceStatus.${device.status}`,
                          )}
                        </p>
                      </div>
                      {device.status === "active" && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            void revokePushSubscription(device.id).then(
                              async () =>
                                setNotificationSettings(
                                  await fetchNotificationSettings(),
                                ),
                            )
                          }
                        >
                          {t("umfSupport.notifications.revokeDevice")}
                        </Button>
                      )}
                    </div>
                  ))}
                  {notificationSettings.push.devices.length === 0 && (
                    <p className="p-5 text-center text-sm text-slate-500">
                      {t("umfSupport.notifications.noDevices")}
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {view === "team" && (
            <div className="space-y-5">
              {capabilities?.canManageAdministrators && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <h2 className="font-semibold">
                      {t("umfSupport.pendingAdministratorAccounts")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("umfSupport.pendingAdministratorAccountsHint")}
                    </p>
                  </div>
                  {administratorAccounts
                    .filter(
                      (account) =>
                        account.emailVerifiedAt !== null &&
                        account.accountStatus === "active" &&
                        account.staffStatus !== "active",
                    )
                    .map((account) => (
                      <div
                        key={account.userId}
                        className="flex flex-col gap-3 border-b border-slate-200 p-4 last:border-0 sm:flex-row sm:items-center"
                      >
                        <UserPlus className="text-slate-400" size={20} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {account.name} {account.lastName}
                          </p>
                          <p className="truncate text-sm text-slate-500">
                            {account.email}
                          </p>
                        </div>
                        <Button
                          disabled={working}
                          className="bg-slate-900 hover:bg-slate-800"
                          onClick={() =>
                            void approveAdministrator(account.userId)
                          }
                        >
                          {t("umfSupport.approveAdministrator")}
                        </Button>
                      </div>
                    ))}
                  {!loading &&
                    !administratorAccounts.some(
                      (account) =>
                        account.emailVerifiedAt !== null &&
                        account.accountStatus === "active" &&
                        account.staffStatus !== "active",
                    ) && (
                      <p className="p-6 text-center text-sm text-slate-500">
                        {t("umfSupport.emptyPendingAdministrators")}
                      </p>
                    )}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                {staff.map((member) => (
                  <div
                    key={member.userId}
                    className="flex flex-col gap-3 border-b border-slate-200 p-4 last:border-0 sm:flex-row sm:items-center"
                  >
                    <ShieldCheck className="text-slate-400" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {member.name} {member.lastName}
                      </p>
                      <p className="truncate text-sm text-slate-500">
                        {member.email}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">
                      {t(`umfSupport.role.${member.role}`)} ·{" "}
                      {t(`umfSupport.staffStatus.${member.status}`)}
                    </span>
                    {capabilities?.canManageAdministrators &&
                      member.userId !== user.id && (
                        <Button
                          variant="outline"
                          disabled={working}
                          onClick={() =>
                            void updateStaff(member.userId, {
                              role: member.role,
                              status:
                                member.status === "active"
                                  ? "revoked"
                                  : "active",
                            }).then(refresh)
                          }
                        >
                          {member.status === "active"
                            ? t("umfSupport.revoke")
                            : t("umfSupport.restore")}
                        </Button>
                      )}
                  </div>
                ))}
                {!loading && staff.length === 0 && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    {t("umfSupport.emptyAdministrators")}
                  </p>
                )}
              </div>
            </div>
          )}

          {view === "collaboration" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
                {t("umfSupport.collaborationDraftNotice")}
              </div>
              {capabilities?.canManageCollaborationSpaces && (
                <form
                  onSubmit={submitCollaborationSpace}
                  className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end"
                >
                  <div>
                    <Label htmlFor="collaboration-name">
                      {t("umfSupport.collaborationName")}
                    </Label>
                    <Input
                      id="collaboration-name"
                      required
                      maxLength={100}
                      value={newSpace.name}
                      onChange={(event) =>
                        setNewSpace((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="collaboration-description">
                      {t("umfSupport.collaborationDescription")}
                    </Label>
                    <Input
                      id="collaboration-description"
                      required
                      maxLength={500}
                      value={newSpace.description}
                      onChange={(event) =>
                        setNewSpace((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={working}
                    className="bg-slate-900 hover:bg-slate-800"
                  >
                    {t("umfSupport.createCollaborationDraft")}
                  </Button>
                </form>
              )}

              <div className="overflow-hidden rounded-lg border border-slate-200">
                {collaborationSpaces.map((space) => (
                  <div
                    key={space.id}
                    className="flex flex-col gap-3 border-b border-slate-200 p-4 last:border-0 sm:flex-row sm:items-center"
                  >
                    <LayoutGrid className="text-slate-400" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{space.name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {space.description}
                      </p>
                    </div>
                    {capabilities?.canManageCollaborationSpaces && (
                      <Button
                        variant="outline"
                        disabled={working}
                        onClick={() =>
                          void changeCollaborationVisibility(space)
                        }
                      >
                        {space.status === "published" &&
                        space.visibility === "staff" ? (
                          <>
                            <EyeOff size={16} />
                            {t("umfSupport.hideCollaboration")}
                          </>
                        ) : (
                          <>
                            <Eye size={16} />
                            {t("umfSupport.showCollaboration")}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ))}
                {!loading && collaborationSpaces.length === 0 && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    {t("umfSupport.emptyCollaborationSpaces")}
                  </p>
                )}
              </div>
            </div>
          )}

          {capabilities &&
            (!capabilities.email.inbound || !capabilities.email.outbound) && (
              <p className="mt-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <Mail className="mt-0.5 shrink-0" size={16} />{" "}
                {t("umfSupport.emailPending")}
              </p>
            )}
        </section>
      </div>
    </main>
  );
}
