import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Check,
  ClipboardList,
  Inbox,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../hooks/useAuth";
import {
  approveAccess,
  createTicket,
  fetchAccessRequests,
  fetchCapabilities,
  fetchMailbox,
  fetchStaff,
  fetchTicket,
  fetchTickets,
  rejectAccess,
  replyTicket,
  updateStaff,
  updateTicket,
  type UmfMailboxMessage,
  type UmfSupportAccessRequest,
  type UmfSupportCapabilities,
  type UmfSupportStaffMember,
  type UmfSupportTicket,
  type UmfSupportTicketSummary,
  type UmfTicketPriority,
  type UmfTicketCategory,
  type UmfTicketStatus,
} from "../lib/umf-support";

type View = "tickets" | "inbox" | "outbox" | "access" | "team";
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

export function UmfSupportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isInitializing, logout } = useAuth();
  const [capabilities, setCapabilities] =
    useState<UmfSupportCapabilities | null>(null);
  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<UmfSupportTicketSummary[]>([]);
  const [selected, setSelected] = useState<UmfSupportTicket | null>(null);
  const [mail, setMail] = useState<UmfMailboxMessage[]>([]);
  const [requests, setRequests] = useState<UmfSupportAccessRequest[]>([]);
  const [staff, setStaff] = useState<UmfSupportStaffMember[]>([]);
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
  const [activationCode, setActivationCode] = useState("");
  const [newTicket, setNewTicket] = useState({
    requesterEmail: "",
    requesterName: "",
    organizationName: "",
    subject: "",
    message: "",
    category: "general" as UmfTicketCategory,
    priority: "normal" as UmfTicketPriority,
  });

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
      } else if (view === "inbox" || view === "outbox") {
        setMail(await fetchMailbox(view === "inbox" ? "inbound" : "outbound"));
      } else if (view === "access" && current.canReviewAccess) {
        setRequests(await fetchAccessRequests());
      } else if (view === "team") {
        setStaff(await fetchStaff());
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [capabilities, refreshTickets, selected, t, view]);

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
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.load"),
      );
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
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.save"),
      );
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
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.save"),
      );
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
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.save"),
      );
    } finally {
      setWorking(false);
    }
  };

  const reviewRequest = async (
    request: UmfSupportAccessRequest,
    approve: boolean,
  ) => {
    setWorking(true);
    setActivationCode("");
    try {
      if (approve) {
        const result = await approveAccess(request.id);
        setActivationCode(result.code);
        setNotice(
          result.delivered
            ? t("umfSupport.notices.accessApprovedSent")
            : t("umfSupport.notices.accessApprovedManual"),
        );
      } else {
        await rejectAccess(request.id);
        setNotice(t("umfSupport.notices.accessRejected"));
      }
      setRequests(await fetchAccessRequests());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("umfSupport.errors.save"),
      );
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

  if (isInitializing)
    return <p className="p-8 text-slate-600">{t("common.loading")}</p>;
  if (!user) return <Navigate to="/umf-support/access" replace />;

  const tabs: Array<{ id: View; icon: typeof Inbox; hidden?: boolean }> = [
    { id: "tickets", icon: ClipboardList },
    { id: "inbox", icon: Inbox },
    { id: "outbox", icon: Send },
    {
      id: "access",
      icon: UserRoundCheck,
      hidden: !capabilities?.canReviewAccess,
    },
    { id: "team", icon: Users },
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
          <Button
            variant="ghost"
            className="text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() =>
              void logout().then(() => navigate("/umf-support/access"))
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
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} size={16} />{" "}
              {t("umfSupport.refresh")}
            </Button>
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
          {activationCode && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                {t("umfSupport.activationCode")}
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-[0.25em] text-slate-950">
                {activationCode}
              </p>
              <p className="mt-2 text-xs text-amber-800">
                {t("umfSupport.activationCodeOnce")}
              </p>
            </div>
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

          {(view === "inbox" || view === "outbox") && (
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
                      {view === "inbox" ? message.sender : message.recipient}
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
                      <p className="mt-1">{message.deliveryStatus}</p>
                    )}
                  </div>
                </button>
              ))}
              {!loading && mail.length === 0 && (
                <p className="p-8 text-center text-sm text-slate-500">
                  {t("umfSupport.emptyMailbox")}
                </p>
              )}
            </div>
          )}

          {view === "access" && capabilities?.canReviewAccess && (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col gap-3 border-b border-slate-200 p-4 last:border-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {request.name} {request.lastName}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {request.email}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDate(request.createdAt, i18n.language)} ·{" "}
                      {t(`umfSupport.accessStatus.${request.status}`)}
                    </p>
                  </div>
                  {request.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void reviewRequest(request, false)}
                        disabled={working}
                      >
                        <X size={16} /> {t("umfSupport.reject")}
                      </Button>
                      <Button
                        className="bg-slate-900 hover:bg-slate-800"
                        onClick={() => void reviewRequest(request, true)}
                        disabled={working}
                      >
                        <Check size={16} /> {t("umfSupport.approve")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {!loading && requests.length === 0 && (
                <p className="p-8 text-center text-sm text-slate-500">
                  {t("umfSupport.emptyRequests")}
                </p>
              )}
            </div>
          )}

          {view === "team" && (
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
                  {capabilities?.canManageTeam && member.userId !== user.id && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void updateStaff(member.userId, {
                          role: member.role,
                          status:
                            member.status === "active" ? "revoked" : "active",
                        }).then(refresh)
                      }
                      disabled={working}
                    >
                      {member.status === "active"
                        ? t("umfSupport.revoke")
                        : t("umfSupport.restore")}
                    </Button>
                  )}
                </div>
              ))}
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
