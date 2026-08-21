import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Loader,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAccessRole } from "../context/auth-context";
import {
  type CrmFollowUpKind,
  type CrmMember,
  type CrmMemberSegment,
  useCrmWorkspace,
} from "../hooks/useCrm";
import { useCurrentUser } from "../hooks/useCurrentUser";

const SEGMENTS: CrmMemberSegment[] = [
  "onboarding",
  "engaged",
  "attention",
  "reengagement",
];
const FOLLOW_UP_KINDS: CrmFollowUpKind[] = [
  "onboarding",
  "check_in",
  "retention",
  "service",
];

function dateInputValue(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function timestampFromDate(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(`${value}T12:00:00`).getTime();
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function memberLabel(member: CrmMember): string {
  return member.name || member.email;
}

export function AdminCrmPage() {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const {
    data,
    loading,
    saving,
    error,
    refresh,
    updateMember,
    createFollowUp,
    updateFollowUp,
  } = useCrmWorkspace();
  const [segmentFilter, setSegmentFilter] = useState<CrmMemberSegment | "all">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [followUpMemberId, setFollowUpMemberId] = useState("");
  const [followUpAssigneeId, setFollowUpAssigneeId] = useState("");
  const [followUpKind, setFollowUpKind] = useState<CrmFollowUpKind>("check_in");
  const [followUpDate, setFollowUpDate] = useState("");

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
      }),
    [i18n.language],
  );
  const filteredMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return (data?.members ?? []).filter(
      (member) =>
        (segmentFilter === "all" ||
          member.effectiveSegment === segmentFilter) &&
        (!normalizedSearch ||
          member.name.toLocaleLowerCase().includes(normalizedSearch) ||
          member.email.toLocaleLowerCase().includes(normalizedSearch)),
    );
  }, [data?.members, search, segmentFilter]);
  const memberNames = useMemo(
    () =>
      new Map(
        data?.members.map((member) => [member.userId, memberLabel(member)]),
      ),
    [data?.members],
  );
  const assigneeNames = useMemo(
    () =>
      new Map(
        data?.assignees.map((assignee) => [assignee.userId, assignee.name]),
      ),
    [data?.assignees],
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="mr-2 animate-spin" />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  if (getAccessRole(user) !== "admin") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <AlertCircle className="mb-3" size={36} />
          <h1 className="text-xl font-bold">{t("unauthorized.title")}</h1>
          <p className="mt-2">{t("crm.adminOnly")}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-slate-50 via-white to-orange-50/40">
      <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 2xl:px-8">
        <header className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-ember">
              Forge CRM
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950">
              {t("crm.title")}
            </h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              {t("crm.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-semibold text-slate-700 shadow-sm transition hover:border-brand-path/40 hover:text-brand-path disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            {t("common.refresh")}
          </button>
        </header>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
            <p className="font-semibold">{t("crm.requestError")}</p>
            <p className="mt-1 text-sm">
              {t("crm.requestErrorDetail", { code: error })}
            </p>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20 text-slate-600">
            <Loader className="mr-2 animate-spin" />
            {t("crm.loading")}
          </div>
        ) : !data ? null : (
          <div className="space-y-8">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {(
                [
                  ["totalMembers", data.summary.totalMembers],
                  ["onboarding", data.summary.onboarding],
                  ["engaged", data.summary.engaged],
                  ["attention", data.summary.attention],
                  ["reengagement", data.summary.reengagement],
                  ["overdue", data.summary.overdueFollowUps],
                ] as const
              ).map(([key, value]) => (
                <article
                  key={key}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <p className="text-sm font-medium text-slate-600">
                    {t(`crm.summary.${key}`)}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {value}
                  </p>
                </article>
              ))}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-start gap-3">
                <span className="rounded-xl bg-brand-ember/10 p-2.5 text-brand-ember">
                  <CalendarPlus size={22} />
                </span>
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    {t("crm.followUps.newTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("crm.followUps.newDescription")}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-4">
                <label className="text-sm font-semibold text-slate-700">
                  {t("crm.member")}
                  <select
                    value={followUpMemberId}
                    onChange={(event) =>
                      setFollowUpMemberId(event.target.value)
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                  >
                    <option value="">{t("crm.chooseMember")}</option>
                    {data.members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {memberLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  {t("crm.followUps.kindLabel")}
                  <select
                    value={followUpKind}
                    onChange={(event) =>
                      setFollowUpKind(event.target.value as CrmFollowUpKind)
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                  >
                    {FOLLOW_UP_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`crm.followUps.kinds.${kind}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  {t("crm.assignee")}
                  <select
                    value={followUpAssigneeId}
                    onChange={(event) =>
                      setFollowUpAssigneeId(event.target.value)
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                  >
                    <option value="">{t("crm.unassigned")}</option>
                    {data.assignees.map((assignee) => (
                      <option key={assignee.userId} value={assignee.userId}>
                        {assignee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  {t("crm.followUps.dueAt")}
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(event) => setFollowUpDate(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={
                  saving ||
                  !followUpMemberId ||
                  timestampFromDate(followUpDate) === null
                }
                onClick={() => {
                  const dueAt = timestampFromDate(followUpDate);
                  if (dueAt === null) return;
                  void createFollowUp({
                    memberUserId: followUpMemberId,
                    assignedToUserId: followUpAssigneeId || null,
                    kind: followUpKind,
                    dueAt,
                  }).then(() => {
                    setFollowUpMemberId("");
                    setFollowUpDate("");
                  });
                }}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-ember px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CalendarPlus size={18} />
                {t("crm.followUps.create")}
              </button>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5 sm:p-6">
                <h2 className="text-xl font-bold text-slate-950">
                  {t("crm.membersTitle")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("crm.membersDescription")}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_15rem]">
                  <input
                    type="search"
                    aria-label={t("crm.searchPlaceholder")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("crm.searchPlaceholder")}
                    className="rounded-xl border border-slate-200 px-3 py-2.5"
                  />
                  <select
                    aria-label={t("crm.segment")}
                    value={segmentFilter}
                    onChange={(event) =>
                      setSegmentFilter(
                        event.target.value as CrmMemberSegment | "all",
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <option value="all">{t("crm.segments.all")}</option>
                    {SEGMENTS.map((segment) => (
                      <option key={segment} value={segment}>
                        {t(`crm.segments.${segment}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {filteredMembers.length === 0 ? (
                  <p className="p-8 text-center text-slate-500">
                    {t("crm.noMembers")}
                  </p>
                ) : (
                  filteredMembers.map((member) => (
                    <article
                      key={member.userId}
                      className="grid gap-5 p-5 lg:grid-cols-[minmax(13rem,1fr)_minmax(18rem,1.3fr)_minmax(18rem,1.2fr)] lg:items-center sm:p-6"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <UserRoundCheck
                            className="text-brand-path"
                            size={20}
                          />
                          <h3 className="font-bold text-slate-950">
                            {memberLabel(member)}
                          </h3>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {member.email}
                        </p>
                        <p className="mt-3 text-sm text-slate-600">
                          {t("crm.metrics.last30Days", {
                            bookings: member.bookingsLast30Days,
                            attended: member.attendedLast30Days,
                            absent: member.absentLast30Days,
                          })}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {member.lastActivityAt === null
                            ? t("crm.metrics.noActivity")
                            : t("crm.metrics.lastActivity", {
                                date: dateFormatter.format(
                                  new Date(member.lastActivityAt),
                                ),
                              })}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("crm.segment")}
                          <select
                            value={member.manualSegment ?? "automatic"}
                            disabled={saving}
                            onChange={(event) =>
                              void updateMember(member.userId, {
                                manualSegment:
                                  event.target.value === "automatic"
                                    ? null
                                    : (event.target.value as CrmMemberSegment),
                                assignedToUserId: member.assignedToUserId,
                                nextFollowUpAt: member.nextFollowUpAt,
                              })
                            }
                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-800"
                          >
                            <option value="automatic">
                              {t("crm.automaticSegment", {
                                segment: t(
                                  `crm.segments.${member.suggestedSegment}`,
                                ),
                              })}
                            </option>
                            {SEGMENTS.map((segment) => (
                              <option key={segment} value={segment}>
                                {t(`crm.segments.${segment}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("crm.assignee")}
                          <select
                            value={member.assignedToUserId ?? ""}
                            disabled={saving}
                            onChange={(event) =>
                              void updateMember(member.userId, {
                                manualSegment: member.manualSegment,
                                assignedToUserId: event.target.value || null,
                                nextFollowUpAt: member.nextFollowUpAt,
                              })
                            }
                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-800"
                          >
                            <option value="">{t("crm.unassigned")}</option>
                            {data.assignees.map((assignee) => (
                              <option
                                key={assignee.userId}
                                value={assignee.userId}
                              >
                                {assignee.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">
                          {t("crm.nextFollowUp")}
                          <input
                            type="date"
                            value={dateInputValue(member.nextFollowUpAt)}
                            disabled={saving}
                            onChange={(event) =>
                              void updateMember(member.userId, {
                                manualSegment: member.manualSegment,
                                assignedToUserId: member.assignedToUserId,
                                nextFollowUpAt: timestampFromDate(
                                  event.target.value,
                                ),
                              })
                            }
                            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-slate-800"
                          />
                        </label>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                        <p>
                          <span className="font-semibold">
                            {t("crm.effectiveSegment")}:
                          </span>{" "}
                          {t(`crm.segments.${member.effectiveSegment}`)}
                        </p>
                        <p className="mt-2">
                          <span className="font-semibold">
                            {t("crm.openFollowUps")}:
                          </span>{" "}
                          {member.openFollowUps}
                        </p>
                        <p className="mt-2">
                          <span className="font-semibold">
                            {t("crm.assignee")}:
                          </span>{" "}
                          {member.assignedToUserId
                            ? (assigneeNames.get(member.assignedToUserId) ??
                              t("crm.unknownAssignee"))
                            : t("crm.unassigned")}
                        </p>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-xl font-bold text-slate-950">
                {t("crm.followUps.title")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t("crm.followUps.description")}
              </p>
              <div className="mt-5 space-y-3">
                {data.followUps.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-5 text-center text-slate-500">
                    {t("crm.followUps.empty")}
                  </p>
                ) : (
                  data.followUps.map((followUp) => (
                    <article
                      key={followUp.id}
                      className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 p-4 md:flex-row md:items-center"
                    >
                      <div>
                        <p className="font-semibold text-slate-950">
                          {memberNames.get(followUp.memberUserId) ??
                            t("crm.unknownMember")}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {t(`crm.followUps.kinds.${followUp.kind}`)} ·{" "}
                          {dateFormatter.format(new Date(followUp.dueAt))} ·{" "}
                          {followUp.assignedToUserId
                            ? (assigneeNames.get(followUp.assignedToUserId) ??
                              t("crm.unknownAssignee"))
                            : t("crm.unassigned")}
                        </p>
                      </div>
                      {followUp.status === "open" ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void updateFollowUp(followUp.id, {
                              assignedToUserId: followUp.assignedToUserId,
                              status: "completed",
                              dueAt: followUp.dueAt,
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <CheckCircle2 size={18} />
                          {t("crm.followUps.complete")}
                        </button>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                          {t(`crm.followUps.statuses.${followUp.status}`)}
                        </span>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>

            <aside className="rounded-2xl border border-teal-200 bg-teal-50 p-5 text-sm text-teal-950">
              <p className="font-bold">{t("crm.privacyTitle")}</p>
              <p className="mt-1">{t("crm.privacyDescription")}</p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

export default AdminCrmPage;
