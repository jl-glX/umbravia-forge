import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileUp,
  MessageCircle,
  Pencil,
  Reply,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { VerifiedForm } from "../components/VerifiedForm";
import { FacilityLinksPanel } from "../components/FacilityLinksPanel";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { getAccessRole } from "../context/auth-context";
import { useAuth } from "../hooks/useAuth";
import { authFetch } from "../lib/api";

const BASE = import.meta.env.VITE_API_URL ?? "";
interface Profile {
  username: string;
  bio: string;
  birthDate: string | null;
  displayRealName: number;
  privacy: Record<string, string>;
}
interface Channel {
  id: string;
  name: string;
  scope: string;
  scopeId: string;
  status: string;
  createdBy: string;
}
interface Message {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  parentId: string | null;
  kind: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}
interface Person {
  userId: string;
  username: string;
  bio: string;
}
interface Contact {
  id: string;
  requesterUserId: string;
  recipientUserId: string;
  status: string;
  otherUserId: string;
  otherName: string;
  otherUsername: string | null;
}
interface CommunityMember {
  userId: string;
  role: "owner" | "member";
  name: string;
  username: string | null;
}
interface CommunityAttachment {
  id: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  messageId: string | null;
}
interface Principles {
  neutrality: string;
  reciprocity: string;
  conductBasedModeration: string;
}

export function CommunityPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const accessRole = getAccessRole(user);
  const [profile, setProfile] = useState<Profile>({
    username: "",
    bio: "",
    birthDate: null,
    displayRealName: 0,
    privacy: {
      bio: "contacts",
      realName: "private",
      birthYear: "authorized_staff",
    },
  });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [attachments, setAttachments] = useState<CommunityAttachment[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<Message | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] =
    useState<CommunityAttachment | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<CommunityMember | null>(
    null,
  );
  const [busyMessageId, setBusyMessageId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelStatus, setChannelStatus] = useState("");
  const [privateNote, setPrivateNote] = useState(false);
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [principles, setPrinciples] = useState<Principles | null>(null);
  const [notice, setNotice] = useState("");
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const canManageSelectedChannel = Boolean(
    selectedChannel &&
    (selectedChannel.createdBy === user?.id ||
      (selectedChannel.scope !== "community" && accessRole === "admin")),
  );
  const api = async <T,>(path: string, init?: RequestInit) => {
    const response = await authFetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Request failed");
    return body as T;
  };
  const load = useCallback(async () => {
    try {
      const [saved, channelList, contactList, policy] = await Promise.all([
        api<Profile | null>("/api/community/profile"),
        api<Channel[]>("/api/community/channels"),
        api<Contact[]>("/api/community/contacts"),
        api<Principles>("/api/community/principles"),
      ]);
      if (saved)
        setProfile({
          ...saved,
          privacy:
            typeof saved.privacy === "string"
              ? JSON.parse(saved.privacy)
              : saved.privacy,
        });
      setChannels(channelList);
      setContacts(contactList);
      setPrinciples(policy);
      setChannelId((current) =>
        channelList.some((channel) => channel.id === current)
          ? current
          : channelList[0]?.id || "",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setPrivateNote(false);
    setReplyTo(null);
    setEditingMessage(null);
    if (!channelId) {
      setMessages([]);
      setMembers([]);
      setAttachments([]);
      return;
    }
    const channel = channels.find((item) => item.id === channelId);
    setChannelName(channel?.name ?? "");
    setChannelStatus(channel?.status ?? "");
    void Promise.all([
      api<Message[]>(`/api/community/channels/${channelId}/messages`),
      channel?.scope === "community"
        ? api<CommunityMember[]>(`/api/community/channels/${channelId}/members`)
        : Promise.resolve([]),
      channel?.scope === "community"
        ? api<CommunityAttachment[]>(
            `/api/community/channels/${channelId}/attachments`,
          )
        : Promise.resolve([]),
    ])
      .then(([nextMessages, nextMembers, nextAttachments]) => {
        setMessages(nextMessages);
        setMembers(nextMembers);
        setAttachments(nextAttachments);
      })
      .catch((error: Error) => setNotice(error.message));
  }, [channelId, channels]);
  useEffect(() => {
    if (!channelId) return;
    const refresh = window.setInterval(() => {
      void api<Message[]>(`/api/community/channels/${channelId}/messages`)
        .then(setMessages)
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(refresh);
  }, [channelId]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const saved = await api<Profile>("/api/community/profile", {
        method: "PATCH",
        body: JSON.stringify({
          ...profile,
          displayRealName: Boolean(profile.displayRealName),
        }),
      });
      setProfile({
        ...saved,
        privacy:
          typeof saved.privacy === "string"
            ? JSON.parse(saved.privacy)
            : saved.privacy,
      });
      setNotice(t("community.profileSaved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const search = async () => {
    try {
      setPeople(
        await api<Person[]>(
          `/api/community/people?query=${encodeURIComponent(query)}`,
        ),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const requestContact = async (recipientUserId: string) => {
    try {
      await api("/api/community/contacts", {
        method: "POST",
        body: JSON.stringify({ recipientUserId }),
      });
      setPeople([]);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const updateContact = async (id: string, status: string) => {
    try {
      await api(`/api/community/contacts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const createGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/community/channels", {
        method: "POST",
        body: JSON.stringify({
          scope: "community",
          scopeId: "personal",
          name: groupName,
        }),
      });
      setGroupName("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/community/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: text,
          kind: privateNote ? "private_justification" : "public",
          parentId: replyTo?.id ?? null,
        }),
      });
      setText("");
      setPrivateNote(false);
      setReplyTo(null);
      setMessages(await api(`/api/community/channels/${channelId}/messages`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const saveEditedMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingMessage) return;
    setBusyMessageId(editingMessage.id);
    try {
      await api(
        `/api/community/channels/${channelId}/messages/${editingMessage.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ body: editingMessage.body }),
        },
      );
      setEditingMessage(null);
      setMessages(await api(`/api/community/channels/${channelId}/messages`));
      setNotice(t("community.messageEdited"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessageId("");
    }
  };
  const removeMessage = async () => {
    if (!deleteMessage) return;
    setBusyMessageId(deleteMessage.id);
    try {
      await api(
        `/api/community/channels/${channelId}/messages/${deleteMessage.id}`,
        { method: "DELETE" },
      );
      setDeleteMessage(null);
      setMessages(await api(`/api/community/channels/${channelId}/messages`));
      setAttachments((current) =>
        current.filter((item) => item.messageId !== deleteMessage.id),
      );
      setNotice(t("community.messageRemoved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMessageId("");
    }
  };
  const saveChannel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedChannel) return;
    try {
      const saved = await api<Channel>(
        `/api/community/channels/${selectedChannel.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: channelName,
            status: channelStatus,
          }),
        },
      );
      setChannels((current) =>
        current.map((channel) =>
          channel.id === saved.id ? { ...channel, ...saved } : channel,
        ),
      );
      setNotice(t("community.channelSaved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const addMember = async (userId: string) => {
    try {
      await api(`/api/community/channels/${channelId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      setMembers(await api(`/api/community/channels/${channelId}/members`));
      setNotice(t("community.memberAdded"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const removeMember = async (userId: string) => {
    try {
      await api(
        `/api/community/channels/${channelId}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      if (userId === user?.id) {
        setChannelId("");
        await load();
      } else {
        setMembers((current) =>
          current.filter((member) => member.userId !== userId),
        );
      }
      setNotice(t("community.memberRemoved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const uploadAttachment = async (file: File) => {
    if (!channelId) return;
    try {
      const response = await authFetch(
        `${BASE}/api/community/channels/${channelId}/attachments`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": file.name,
            ...(replyTo ? { "X-Message-Id": replyTo.id } : {}),
          },
          body: file,
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Upload failed");
      setAttachments(
        await api(`/api/community/channels/${channelId}/attachments`),
      );
      setNotice(t("community.attachmentUploaded"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const removeAttachment = async (attachmentId: string) => {
    try {
      await api(
        `/api/community/channels/${channelId}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      setAttachments((current) =>
        current.filter((item) => item.id !== attachmentId),
      );
      setNotice(t("community.attachmentRemoved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(240,122,58,0.10),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(42,157,143,0.10),transparent_32%)] bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.18em] text-blue-600">
              {t("community.eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-bold">{t("community.title")}</h1>
            <p className="mt-2 text-slate-600">{t("community.description")}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/moderation">{t("community.moderation")}</Link>
          </Button>
        </div>
        {notice && (
          <div className="mt-4 rounded-xl bg-blue-50 p-3 text-blue-800">
            {notice}
          </div>
        )}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="rounded-3xl p-6">
            <h2 className="font-bold">{t("community.identity")}</h2>
            <VerifiedForm className="mt-4 space-y-4" onSubmit={save}>
              <Field label={t("community.username")}>
                <Input
                  required
                  pattern="[a-z0-9][a-z0-9_.]{2,31}"
                  value={profile.username}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      username: e.target.value.toLowerCase(),
                    }))
                  }
                />
              </Field>
              <Field label={t("community.bio")}>
                <textarea
                  maxLength={300}
                  className="min-h-24 w-full rounded-xl border p-3"
                  value={profile.bio}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, bio: e.target.value }))
                  }
                />
              </Field>
              <Field label={t("community.birthDate")}>
                <Input
                  type="date"
                  value={profile.birthDate ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      birthDate: e.target.value || null,
                    }))
                  }
                />
              </Field>
              <Field label={t("community.bioVisibility")}>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  value={profile.privacy.bio ?? "contacts"}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      privacy: { ...p.privacy, bio: e.target.value },
                    }))
                  }
                >
                  {[
                    "public",
                    "contacts",
                    "facility",
                    "authorized_staff",
                    "private",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {t(`community.visibility.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit">{t("common.save")}</Button>
            </VerifiedForm>
          </Card>
          <Card className="rounded-3xl p-6">
            <h2 className="flex items-center gap-2 font-bold">
              <UserPlus />
              {t("community.contacts")}
            </h2>
            <div className="mt-4 flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="@usuario"
              />
              <Button
                variant="outline"
                onClick={() => void search()}
                disabled={query.length < 2}
              >
                <Search />
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {people.map((person) => (
                <div
                  key={person.userId}
                  className="flex justify-between rounded-xl border p-3"
                >
                  <div>
                    <strong>@{person.username}</strong>
                    <p className="text-sm text-slate-500">{person.bio}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void requestContact(person.userId)}
                  >
                    {t("community.request")}
                  </Button>
                </div>
              ))}
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100 p-3 text-sm"
                >
                  <div>
                    <strong>
                      {contact.otherUsername
                        ? `@${contact.otherUsername}`
                        : contact.otherName}
                    </strong>
                    <span className="block text-xs text-slate-500">
                      {t(`community.contactStatus.${contact.status}`)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {contact.status === "contact_requested" &&
                      contact.recipientUserId === user?.id && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void updateContact(contact.id, "contact_accepted")
                            }
                          >
                            {t("community.accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void updateContact(contact.id, "contact_rejected")
                            }
                          >
                            {t("community.reject")}
                          </Button>
                        </>
                      )}
                    {contact.status === "contact_requested" &&
                      contact.requesterUserId === user?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void updateContact(contact.id, "contact_removed")
                          }
                        >
                          {t("common.cancel")}
                        </Button>
                      )}
                    {contact.status === "contact_accepted" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void updateContact(contact.id, "contact_removed")
                        }
                      >
                        {t("community.removeContact")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <VerifiedForm className="mt-5 flex gap-2" onSubmit={createGroup}>
              <Input
                required
                minLength={2}
                maxLength={80}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={t("community.newGroup")}
              />
              <Button type="submit">{t("community.create")}</Button>
            </VerifiedForm>
          </Card>
        </div>
        <Card className="mt-6 rounded-3xl p-6">
          <h2 className="flex items-center gap-2 font-bold">
            <MessageCircle />
            {t("community.channels")}
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-[15rem_1fr]">
            <div className="space-y-2">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => setChannelId(channel.id)}
                  className={`w-full rounded-xl border p-3 text-left ${channel.id === channelId ? "border-blue-400 bg-blue-50" : ""}`}
                >
                  <strong>{channel.name}</strong>
                  <span className="block text-xs text-slate-500">
                    {channel.scope}
                  </span>
                </button>
              ))}
            </div>
            <div>
              {selectedChannel && canManageSelectedChannel && (
                <VerifiedForm
                  className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
                  onSubmit={saveChannel}
                >
                  <Field label={t("community.channelName")}>
                    <Input
                      required
                      minLength={2}
                      maxLength={80}
                      value={channelName}
                      onChange={(event) => setChannelName(event.target.value)}
                    />
                  </Field>
                  <Field label={t("community.channelStatus")}>
                    <select
                      className="h-10 w-full rounded-md border px-3"
                      value={channelStatus}
                      onChange={(event) => setChannelStatus(event.target.value)}
                    >
                      {[
                        "community_active",
                        "community_read_only",
                        "community_suspended",
                        "community_closed",
                      ].map((status) => (
                        <option key={status} value={status}>
                          {t(`community.channelStatuses.${status}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit">{t("common.save")}</Button>
                </VerifiedForm>
              )}
              <div className="max-h-96 space-y-3 overflow-auto rounded-2xl bg-slate-100 p-4">
                {messages.map((item) => (
                  <article key={item.id} className="rounded-xl bg-white p-3">
                    <div className="flex justify-between text-xs text-slate-500">
                      <strong>
                        {item.authorName} · {item.authorRole}
                      </strong>
                      <span>
                        {new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(item.createdAt)}
                      </span>
                    </div>
                    {item.parentId && (
                      <p className="mt-2 border-l-2 border-brand-path pl-3 text-xs text-slate-500">
                        {t("community.replyingToMessage")}
                      </p>
                    )}
                    {editingMessage?.id === item.id ? (
                      <VerifiedForm
                        className="mt-3 space-y-2"
                        onSubmit={saveEditedMessage}
                      >
                        <textarea
                          required
                          maxLength={4000}
                          className="min-h-24 w-full rounded-xl border p-3"
                          value={editingMessage.body}
                          onChange={(event) =>
                            setEditingMessage({
                              ...editingMessage,
                              body: event.target.value,
                            })
                          }
                        />
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={busyMessageId === item.id}
                          >
                            {t("common.save")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingMessage(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                        </div>
                      </VerifiedForm>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap">{item.body}</p>
                    )}
                    {item.kind === "private_justification" && (
                      <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs">
                        {t("community.private")}
                      </span>
                    )}
                    {item.status === "active" &&
                      editingMessage?.id !== item.id && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setReplyTo(item)}
                          >
                            <Reply aria-hidden="true" />
                            {t("community.reply")}
                          </Button>
                          {item.authorUserId === user?.id && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingMessage(item)}
                            >
                              <Pencil aria-hidden="true" />
                              {t("community.edit")}
                            </Button>
                          )}
                          {(item.authorUserId === user?.id ||
                            canManageSelectedChannel) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteMessage(item)}
                            >
                              <Trash2 aria-hidden="true" />
                              {t("common.delete")}
                            </Button>
                          )}
                        </div>
                      )}
                  </article>
                ))}
              </div>
              {channelId &&
              channels.find((channel) => channel.id === channelId)?.status ===
                "community_active" ? (
                <VerifiedForm className="mt-3 space-y-3" onSubmit={send}>
                  {replyTo && (
                    <div className="flex items-center justify-between rounded-xl bg-brand-path/10 p-3 text-sm text-brand-slate">
                      <span>
                        {t("community.replyingTo", {
                          author: replyTo.authorName,
                        })}
                      </span>
                      <button
                        type="button"
                        aria-label={t("common.cancel")}
                        onClick={() => setReplyTo(null)}
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    </div>
                  )}
                  <textarea
                    required
                    maxLength={4000}
                    className="min-h-24 w-full rounded-xl border p-3"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  {channels.find((channel) => channel.id === channelId)
                    ?.scope === "class" && (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={privateNote}
                        onChange={(event) =>
                          setPrivateNote(event.target.checked)
                        }
                      />
                      {t("community.privateJustification")}
                    </label>
                  )}
                  <Button type="submit">{t("community.send")}</Button>
                </VerifiedForm>
              ) : channelId ? (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  {t("community.channelUnavailable")}
                </p>
              ) : null}
              {selectedChannel?.scope === "community" && (
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="font-semibold text-brand-night">
                      {t("community.members")}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {members.map((member) => (
                        <div
                          key={member.userId}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
                        >
                          <span>
                            <strong>
                              {member.username
                                ? `@${member.username}`
                                : member.name}
                            </strong>
                            <span className="block text-xs text-slate-500">
                              {t(`community.memberRoles.${member.role}`)}
                            </span>
                          </span>
                          {member.role !== "owner" &&
                            (canManageSelectedChannel ||
                              member.userId === user?.id) && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setMemberToRemove(member)}
                              >
                                <UserMinus aria-hidden="true" />
                                {member.userId === user?.id
                                  ? t("community.leave")
                                  : t("community.removeMember")}
                              </Button>
                            )}
                        </div>
                      ))}
                    </div>
                    {canManageSelectedChannel && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("community.addAcceptedContact")}
                        </p>
                        {contacts
                          .filter(
                            (contact) =>
                              contact.status === "contact_accepted" &&
                              !members.some(
                                (member) =>
                                  member.userId === contact.otherUserId,
                              ),
                          )
                          .map((contact) => (
                            <Button
                              key={contact.id}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void addMember(contact.otherUserId)
                              }
                            >
                              <UserPlus aria-hidden="true" />
                              {contact.otherUsername
                                ? `@${contact.otherUsername}`
                                : contact.otherName}
                            </Button>
                          ))}
                      </div>
                    )}
                  </section>
                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="font-semibold text-brand-night">
                      {t("community.attachments")}
                    </h3>
                    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-slate hover:bg-slate-50">
                      <FileUp aria-hidden="true" size={17} />
                      {t("community.uploadAttachment")}
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadAttachment(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <p className="mt-2 text-xs text-slate-500">
                      {t("community.attachmentLimits")}
                    </p>
                    <div className="mt-3 space-y-2">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
                        >
                          <a
                            className="min-w-0 truncate text-blue-700 underline"
                            href={`${BASE}/api/community/channels/${channelId}/attachments/${attachment.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download
                              className="mr-1 inline"
                              aria-hidden="true"
                              size={15}
                            />
                            {attachment.fileName}
                          </a>
                          {(attachment.uploadedByUserId === user?.id ||
                            canManageSelectedChannel) && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={t("common.delete")}
                              onClick={() => setAttachmentToDelete(attachment)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </Card>
        {principles && (
          <Card className="mt-6 rounded-3xl border-emerald-200 bg-emerald-50 p-6">
            <h2 className="flex items-center gap-2 font-bold">
              <ShieldCheck />
              {t("community.principles")}
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>{principles.neutrality}</li>
              <li>{principles.reciprocity}</li>
              <li>{principles.conductBasedModeration}</li>
            </ul>
          </Card>
        )}
        <FacilityLinksPanel />
      </div>
      <ConfirmDialog
        open={Boolean(deleteMessage)}
        title={t("community.removeMessageTitle")}
        description={t("community.removeMessageDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={Boolean(deleteMessage && busyMessageId === deleteMessage.id)}
        onConfirm={() => void removeMessage()}
        onCancel={() => setDeleteMessage(null)}
      />
      <ConfirmDialog
        open={Boolean(attachmentToDelete)}
        title={t("community.removeAttachmentTitle")}
        description={t("community.removeAttachmentDescription", {
          name: attachmentToDelete?.fileName ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          const attachmentId = attachmentToDelete?.id;
          setAttachmentToDelete(null);
          if (attachmentId) void removeAttachment(attachmentId);
        }}
        onCancel={() => setAttachmentToDelete(null)}
      />
      <ConfirmDialog
        open={Boolean(memberToRemove)}
        title={
          memberToRemove?.userId === user?.id
            ? t("community.leaveTitle")
            : t("community.removeMemberTitle")
        }
        description={
          memberToRemove?.userId === user?.id
            ? t("community.leaveDescription")
            : t("community.removeMemberDescription", {
                name: memberToRemove?.username
                  ? `@${memberToRemove.username}`
                  : (memberToRemove?.name ?? ""),
              })
        }
        confirmLabel={
          memberToRemove?.userId === user?.id
            ? t("community.leave")
            : t("community.removeMember")
        }
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          const userId = memberToRemove?.userId;
          setMemberToRemove(null);
          if (userId) void removeMember(userId);
        }}
        onCancel={() => setMemberToRemove(null)}
      />
    </main>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
