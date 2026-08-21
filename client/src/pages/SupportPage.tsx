import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  LifeBuoy,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRoundCog,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useAuth } from "../hooks/useAuth";
import { localizedApiErrorCodeMessage } from "../lib/api-error";
import {
  addSupportMessage,
  createSupportTicket,
  deleteSupportAttachment,
  fetchSupportCapabilities,
  fetchKnowledgeArticles,
  fetchSupportAgents,
  fetchSupportTicket,
  fetchSupportTickets,
  KnowledgeArticle,
  saveKnowledgeArticle,
  saveSupportAgent,
  SupportRequestError,
  SupportAgent,
  SupportCapabilities,
  supportAttachmentUrl,
  SupportTicketDetail,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketSummary,
  updateSupportTicket,
  uploadSupportAttachment,
} from "../lib/support";

type View = "tickets" | "knowledge" | "team";

const ticketStatuses: SupportTicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_user",
  "resolved",
  "closed",
];
const priorities: SupportTicketPriority[] = ["low", "normal", "high", "urgent"];
const categories = [
  "account",
  "billing",
  "reservations",
  "technical",
  "safety",
  "general",
] as const;

function formatDate(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function supportErrorMessage(
  error: unknown,
  fallback: string,
  translate: (key: string) => string,
) {
  const code = error instanceof SupportRequestError ? error.code : undefined;
  return localizedApiErrorCodeMessage(code, fallback, translate);
}

export function SupportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selected, setSelected] = useState<SupportTicketDetail | null>(null);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [agents, setAgents] = useState<SupportAgent[]>([]);
  const [capabilities, setCapabilities] = useState<SupportCapabilities | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState<SupportTicketPriority>("normal");
  const [initialMessage, setInitialMessage] = useState("");
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [articleTitle, setArticleTitle] = useState("");
  const [articleSummary, setArticleSummary] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [articleCategory, setArticleCategory] = useState("general");
  const [articleStatus, setArticleStatus] = useState<"draft" | "published">(
    "draft",
  );
  const [agentUserId, setAgentUserId] = useState("");
  const [agentRole, setAgentRole] = useState<"agent" | "manager">("agent");
  const [attachmentToDelete, setAttachmentToDelete] = useState<{
    id: string;
    fileName: string;
  } | null>(null);

  const isStaff = capabilities?.staff === true || selected?.staff === true;

  const loadTickets = useCallback(async () => {
    const result = await fetchSupportTickets({
      q: query.trim() || undefined,
      status: statusFilter || undefined,
    });
    setTickets(result);
  }, [query, statusFilter]);

  const loadArticles = useCallback(async () => {
    setArticles(await fetchKnowledgeArticles(query.trim()));
  }, [query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentCapabilities =
        capabilities ?? (await fetchSupportCapabilities());
      setCapabilities(currentCapabilities);
      await Promise.all([
        loadTickets(),
        loadArticles(),
        currentCapabilities.staff
          ? fetchSupportAgents().then(setAgents)
          : Promise.resolve(),
      ]);
      if (selected) setSelected(await fetchSupportTicket(selected.id));
    } catch (currentError) {
      setError(supportErrorMessage(currentError, t("support.errors.load"), t));
    } finally {
      setLoading(false);
    }
  }, [capabilities, loadArticles, loadTickets, selected, t]);

  useEffect(() => {
    void refresh();
    // The selected ticket is refreshed explicitly after mutations, not by this
    // initial load, to avoid a fetch loop when its object reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadArticles, loadTickets]);

  const selectTicket = async (ticketId: string) => {
    setError("");
    setWorking(true);
    try {
      setSelected(await fetchSupportTicket(ticketId));
      setShowCreate(false);
    } catch (currentError) {
      setError(supportErrorMessage(currentError, t("support.errors.load"), t));
    } finally {
      setWorking(false);
    }
  };

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const created = await createSupportTicket({
        subject,
        message: initialMessage,
        category,
        priority,
        context: {
          route: window.location.pathname,
          userAgent: navigator.userAgent.slice(0, 500),
        },
      });
      setSubject("");
      setInitialMessage("");
      setCategory("general");
      setPriority("normal");
      setNotice(t("support.notices.created", { id: created.publicId }));
      await loadTickets();
      await selectTicket(created.id);
    } catch (currentError) {
      setError(
        supportErrorMessage(currentError, t("support.errors.create"), t),
      );
    } finally {
      setWorking(false);
    }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setWorking(true);
    setError("");
    try {
      await addSupportMessage(
        selected.id,
        reply,
        internalNote ? "internal" : "requester",
      );
      setReply("");
      setInternalNote(false);
      setSelected(await fetchSupportTicket(selected.id));
      await loadTickets();
      setNotice(t("support.notices.replySaved"));
    } catch (currentError) {
      setError(supportErrorMessage(currentError, t("support.errors.reply"), t));
    } finally {
      setWorking(false);
    }
  };

  const changeTicket = async (input: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    assigneeUserId?: string | null;
  }) => {
    if (!selected) return;
    setWorking(true);
    setError("");
    try {
      setSelected(await updateSupportTicket(selected.id, input));
      await loadTickets();
    } catch (currentError) {
      setError(
        supportErrorMessage(currentError, t("support.errors.update"), t),
      );
    } finally {
      setWorking(false);
    }
  };

  const attachFile = async (file: File | undefined) => {
    if (!selected || !file) return;
    setWorking(true);
    setError("");
    try {
      await uploadSupportAttachment(selected.id, file);
      setSelected(await fetchSupportTicket(selected.id));
      setNotice(t("support.notices.attachmentSaved"));
    } catch (currentError) {
      setError(
        supportErrorMessage(currentError, t("support.errors.attachment"), t),
      );
    } finally {
      setWorking(false);
    }
  };

  const removeAttachment = async () => {
    if (!selected || !attachmentToDelete) return;
    setWorking(true);
    setError("");
    try {
      await deleteSupportAttachment(selected.id, attachmentToDelete.id);
      setSelected(await fetchSupportTicket(selected.id));
      setNotice(t("support.notices.attachmentRemoved"));
      setAttachmentToDelete(null);
    } catch (currentError) {
      setError(
        supportErrorMessage(
          currentError,
          t("support.errors.attachmentDelete"),
          t,
        ),
      );
    } finally {
      setWorking(false);
    }
  };

  const submitArticle = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await saveKnowledgeArticle({
        title: articleTitle,
        summary: articleSummary,
        body: articleBody,
        category: articleCategory,
        status: articleStatus,
      });
      setArticleTitle("");
      setArticleSummary("");
      setArticleBody("");
      setArticleCategory("general");
      setArticleStatus("draft");
      await loadArticles();
      setNotice(t("support.notices.articleSaved"));
    } catch (currentError) {
      setError(
        supportErrorMessage(currentError, t("support.errors.article"), t),
      );
    } finally {
      setWorking(false);
    }
  };

  const submitAgent = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await saveSupportAgent({
        userId: agentUserId,
        role: agentRole,
        active: true,
      });
      setAgentUserId("");
      setAgents(await fetchSupportAgents());
      setNotice(t("support.notices.agentSaved"));
    } catch (currentError) {
      setError(supportErrorMessage(currentError, t("support.errors.agent"), t));
    } finally {
      setWorking(false);
    }
  };

  const overdue = useMemo(() => {
    if (!selected || ["resolved", "closed"].includes(selected.status))
      return false;
    return selected.resolutionDueAt < Date.now();
  }, [selected]);

  return (
    <main className="min-h-[calc(100vh-4.5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[104rem]">
        <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-orange-600">
              {t("support.eyebrow")}
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              Forge Support
            </h1>
            <p className="mt-3 max-w-3xl text-lg text-slate-600">
              {t("support.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setView("tickets")}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${view === "tickets" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              <MessageSquareText className="mr-2 inline" size={17} />
              {t("support.tabs.tickets")}
            </button>
            <button
              type="button"
              onClick={() => setView("knowledge")}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${view === "knowledge" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              <BookOpen className="mr-2 inline" size={17} />
              {t("support.tabs.knowledge")}
            </button>
            {capabilities?.canManageTeam && (
              <button
                type="button"
                onClick={() => setView("team")}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${view === "team" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
              >
                <UserRoundCog className="mr-2 inline" size={17} />
                {t("support.tabs.team")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading || working}
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              aria-label={t("common.refresh")}
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-800">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
            <CheckCircle2 size={20} /> {notice}
          </div>
        )}

        <section className="mb-5 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
          <label className="relative flex-1">
            <Search
              className="absolute left-4 top-3.5 text-slate-400"
              size={19}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void refresh();
              }}
              placeholder={t("support.searchPlaceholder")}
              className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          {view === "tickets" && (
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="">{t("support.allStatuses")}</option>
              {ticketStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`support.status.${status}`)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-2xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700"
          >
            {t("support.search")}
          </button>
        </section>

        {view === "tickets" && (
          <div className="grid gap-5 xl:grid-cols-[25rem_minmax(0,1fr)]">
            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    {isStaff ? t("support.queue") : t("support.myTickets")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {t("support.ticketCount", { count: tickets.length })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setShowCreate(true);
                  }}
                  className="rounded-xl bg-blue-600 p-2.5 text-white hover:bg-blue-700"
                  aria-label={t("support.newTicket")}
                >
                  <Plus size={19} />
                </button>
              </div>
              <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                {!loading && tickets.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">
                    {t("support.emptyTickets")}
                  </p>
                )}
                {tickets.map((ticket) => (
                  <button
                    type="button"
                    key={ticket.id}
                    onClick={() => void selectTicket(ticket.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === ticket.id ? "border-orange-300 bg-orange-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-bold text-orange-700">
                        {ticket.publicId}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                        {t(`support.status.${ticket.status}`)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 font-semibold text-slate-900">
                      {ticket.subject}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatDate(ticket.updatedAt, i18n.language)}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="min-h-[34rem] rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              {showCreate ? (
                <form
                  onSubmit={submitTicket}
                  className="mx-auto max-w-3xl space-y-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-2xl bg-orange-100 p-3 text-orange-700">
                      <LifeBuoy size={24} />
                    </span>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-950">
                        {t("support.createTitle")}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {t("support.createDescription")}
                      </p>
                    </div>
                  </div>
                  <label className="block font-semibold text-slate-800">
                    {t("support.subject")}
                    <input
                      required
                      maxLength={160}
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="font-semibold text-slate-800">
                      {t("support.categoryLabel")}
                      <select
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal"
                      >
                        {categories.map((value) => (
                          <option value={value} key={value}>
                            {t(`support.category.${value}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="font-semibold text-slate-800">
                      {t("support.priorityLabel")}
                      <select
                        value={priority}
                        onChange={(event) =>
                          setPriority(
                            event.target.value as SupportTicketPriority,
                          )
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal"
                      >
                        {priorities.map((value) => (
                          <option value={value} key={value}>
                            {t(`support.priority.${value}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block font-semibold text-slate-800">
                    {t("support.message")}
                    <textarea
                      required
                      minLength={8}
                      maxLength={10000}
                      rows={8}
                      value={initialMessage}
                      onChange={(event) =>
                        setInitialMessage(event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-normal"
                    />
                  </label>
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="rounded-xl border border-slate-200 px-5 py-3 font-semibold text-slate-700"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      disabled={working}
                      className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      {t("support.createAction")}
                    </button>
                  </div>
                </form>
              ) : selected ? (
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-bold text-orange-700">
                        {selected.publicId}
                      </p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-950">
                        {selected.subject}
                      </h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {t(`support.category.${selected.category}`)} ·{" "}
                        {formatDate(selected.createdAt, i18n.language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                        {t(`support.status.${selected.status}`)}
                      </span>
                      <span className="rounded-full bg-orange-100 px-3 py-1.5 text-xs font-semibold text-orange-800">
                        {t(`support.priority.${selected.priority}`)}
                      </span>
                      {overdue && (
                        <span className="rounded-full bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800">
                          {t("support.slaOverdue")}
                        </span>
                      )}
                    </div>
                  </div>

                  {isStaff && (
                    <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:grid-cols-3">
                      <label className="text-xs font-bold uppercase tracking-wide text-blue-900">
                        {t("support.statusLabel")}
                        <select
                          value={selected.status}
                          disabled={working}
                          onChange={(event) =>
                            void changeTicket({
                              status: event.target.value as SupportTicketStatus,
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800"
                        >
                          {ticketStatuses.map((status) => (
                            <option key={status} value={status}>
                              {t(`support.status.${status}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-bold uppercase tracking-wide text-blue-900">
                        {t("support.priorityLabel")}
                        <select
                          value={selected.priority}
                          disabled={working}
                          onChange={(event) =>
                            void changeTicket({
                              priority: event.target
                                .value as SupportTicketPriority,
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800"
                        >
                          {priorities.map((value) => (
                            <option key={value} value={value}>
                              {t(`support.priority.${value}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-bold uppercase tracking-wide text-blue-900">
                        {t("support.assignee")}
                        <select
                          value={selected.assigneeUserId ?? ""}
                          disabled={working}
                          onChange={(event) =>
                            void changeTicket({
                              assigneeUserId: event.target.value || null,
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800"
                        >
                          <option value="">{t("support.unassigned")}</option>
                          {capabilities?.administrator && user && (
                            <option value={user.id}>{user.name}</option>
                          )}
                          {agents
                            .filter(
                              (agent) =>
                                agent.active === 1 && agent.userId !== user?.id,
                            )
                            .map((agent) => (
                              <option key={agent.userId} value={agent.userId}>
                                {agent.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="space-y-3">
                    {selected.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`rounded-2xl border p-4 ${message.visibility === "internal" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-900">
                            {message.authorName || t("support.systemAuthor")}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {message.visibility === "internal" && (
                              <span className="rounded-full bg-amber-200 px-2 py-1 font-semibold text-amber-900">
                                {t("support.internalNote")}
                              </span>
                            )}
                            {formatDate(message.createdAt, i18n.language)}
                          </div>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-slate-700">
                          {message.body}
                        </p>
                      </article>
                    ))}
                  </div>

                  {selected.attachments.length > 0 && (
                    <div>
                      <h3 className="mb-3 font-bold text-slate-900">
                        {t("support.attachments")}
                      </h3>
                      <div className="space-y-2">
                        {selected.attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                          >
                            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                              <FileText className="shrink-0" size={17} />
                              <span className="truncate">
                                {attachment.fileName} (
                                {formatBytes(attachment.sizeBytes)})
                              </span>
                            </span>
                            <span className="flex items-center gap-1">
                              <a
                                href={supportAttachmentUrl(
                                  selected.id,
                                  attachment.id,
                                )}
                                className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"
                                aria-label={t("support.downloadAttachment", {
                                  name: attachment.fileName,
                                })}
                              >
                                <Download size={17} />
                              </a>
                              {(isStaff ||
                                attachment.uploadedByUserId === user?.id) && (
                                <button
                                  type="button"
                                  className="rounded-lg p-2 text-red-700 hover:bg-red-50"
                                  aria-label={t("support.removeAttachment", {
                                    name: attachment.fileName,
                                  })}
                                  onClick={() =>
                                    setAttachmentToDelete({
                                      id: attachment.id,
                                      fileName: attachment.fileName,
                                    })
                                  }
                                >
                                  <Trash2 size={17} />
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={submitReply}
                    className="rounded-2xl bg-slate-50 p-4"
                  >
                    <label className="font-semibold text-slate-800">
                      {t("support.reply")}
                      <textarea
                        required
                        rows={5}
                        maxLength={10000}
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-normal"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                          <Paperclip className="mr-2 inline" size={17} />
                          {t("support.addAttachment")}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                            className="sr-only"
                            onChange={(event) =>
                              void attachFile(event.target.files?.[0])
                            }
                          />
                        </label>
                        {isStaff && (
                          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                              type="checkbox"
                              checked={internalNote}
                              onChange={(event) =>
                                setInternalNote(event.target.checked)
                              }
                            />
                            {t("support.internalNote")}
                          </label>
                        )}
                      </div>
                      <button
                        disabled={working}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
                      >
                        <Send className="mr-2 inline" size={17} />
                        {t("support.sendReply")}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="flex min-h-[28rem] flex-col items-center justify-center text-center">
                  <span className="rounded-3xl bg-orange-100 p-5 text-orange-700">
                    <LifeBuoy size={38} />
                  </span>
                  <h2 className="mt-5 text-2xl font-bold text-slate-950">
                    {t("support.welcomeTitle")}
                  </h2>
                  <p className="mt-2 max-w-xl text-slate-500">
                    {t("support.welcomeDescription")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="mt-6 rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white"
                  >
                    <Plus className="mr-2 inline" size={18} />{" "}
                    {t("support.newTicket")}
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {view === "knowledge" && (
          <div
            className={`grid gap-5 ${isStaff ? "xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}
          >
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="text-2xl font-bold text-slate-950">
                {t("support.knowledgeTitle")}
              </h2>
              <p className="mt-2 text-slate-500">
                {t("support.knowledgeDescription")}
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {articles.map((article) => (
                  <article
                    key={article.id}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wide text-orange-700">
                        {article.category}
                      </span>
                      {isStaff && (
                        <span className="text-xs text-slate-500">
                          {article.status}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-xl font-bold text-slate-950">
                      {article.title}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      {article.summary}
                    </p>
                    <p className="mt-4 whitespace-pre-wrap text-slate-700">
                      {article.body}
                    </p>
                  </article>
                ))}
                {!loading && articles.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 p-6 text-slate-500">
                    {t("support.emptyKnowledge")}
                  </p>
                )}
              </div>
            </section>
            {isStaff && (
              <form
                onSubmit={submitArticle}
                className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-xl font-bold text-slate-950">
                  {t("support.articleCreate")}
                </h2>
                <div className="mt-5 space-y-4">
                  <input
                    required
                    maxLength={180}
                    value={articleTitle}
                    onChange={(event) => setArticleTitle(event.target.value)}
                    placeholder={t("support.articleTitle")}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3"
                  />
                  <textarea
                    required
                    maxLength={500}
                    rows={3}
                    value={articleSummary}
                    onChange={(event) => setArticleSummary(event.target.value)}
                    placeholder={t("support.articleSummary")}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3"
                  />
                  <textarea
                    required
                    maxLength={50000}
                    rows={9}
                    value={articleBody}
                    onChange={(event) => setArticleBody(event.target.value)}
                    placeholder={t("support.articleBody")}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3"
                  />
                  <input
                    required
                    maxLength={64}
                    value={articleCategory}
                    onChange={(event) => setArticleCategory(event.target.value)}
                    placeholder={t("support.categoryLabel")}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3"
                  />
                  <select
                    value={articleStatus}
                    onChange={(event) =>
                      setArticleStatus(
                        event.target.value as "draft" | "published",
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <option value="draft">{t("support.articleDraft")}</option>
                    <option value="published">
                      {t("support.articlePublished")}
                    </option>
                  </select>
                  <button
                    disabled={working}
                    className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    {t("support.articleSave")}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {view === "team" && capabilities?.canManageTeam && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_28rem]">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-blue-700" />
                <div>
                  <h2 className="text-2xl font-bold text-slate-950">
                    {t("support.teamTitle")}
                  </h2>
                  <p className="text-slate-500">
                    {t("support.teamDescription")}
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 p-4"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {agent.name}
                      </p>
                      <p className="text-sm text-slate-500">{agent.email}</p>
                    </div>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                      {agent.role}
                    </span>
                  </div>
                ))}
                {agents.length === 0 && (
                  <p className="rounded-2xl bg-slate-50 p-5 text-slate-500">
                    {t("support.emptyTeam")}
                  </p>
                )}
              </div>
            </section>
            <form
              onSubmit={submitAgent}
              className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-xl font-bold text-slate-950">
                {t("support.addAgent")}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {t("support.addAgentDescription")}
              </p>
              <input
                required
                value={agentUserId}
                onChange={(event) => setAgentUserId(event.target.value)}
                placeholder={t("support.userId")}
                className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              <select
                value={agentRole}
                onChange={(event) =>
                  setAgentRole(event.target.value as "agent" | "manager")
                }
                className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3"
              >
                <option value="agent">{t("support.agentRole")}</option>
                <option value="manager">{t("support.managerRole")}</option>
              </select>
              <button
                disabled={working}
                className="mt-4 w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                {t("support.addAgent")}
              </button>
            </form>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(attachmentToDelete)}
        title={t("support.removeAttachmentTitle")}
        description={t("support.removeAttachmentDescription", {
          name: attachmentToDelete?.fileName ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={working}
        onConfirm={() => void removeAttachment()}
        onCancel={() => setAttachmentToDelete(null)}
      />
    </main>
  );
}
