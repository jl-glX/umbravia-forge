import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Search, ShieldCheck, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { VerifiedForm } from "../components/VerifiedForm";
import { FacilityLinksPanel } from "../components/FacilityLinksPanel";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
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
  status: string;
}
interface Message {
  id: string;
  body: string;
  authorName: string;
  authorRole: string;
  kind: string;
  createdAt: number;
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
}
interface Principles {
  neutrality: string;
  reciprocity: string;
  conductBasedModeration: string;
}

export function CommunityPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
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
  const [text, setText] = useState("");
  const [privateNote, setPrivateNote] = useState(false);
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [principles, setPrinciples] = useState<Principles | null>(null);
  const [notice, setNotice] = useState("");
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
    if (!channelId) return setMessages([]);
    void api<Message[]>(`/api/community/channels/${channelId}/messages`)
      .then(setMessages)
      .catch((error: Error) => setNotice(error.message));
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
        }),
      });
      setText("");
      setPrivateNote(false);
      setMessages(await api(`/api/community/channels/${channelId}/messages`));
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
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 p-3 text-sm"
                >
                  <span>{contact.status}</span>
                  {contact.status === "contact_requested" &&
                    contact.recipientUserId === user?.id && (
                      <Button
                        size="sm"
                        onClick={() =>
                          void updateContact(contact.id, "contact_accepted")
                        }
                      >
                        {t("community.accept")}
                      </Button>
                    )}
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
                    <p className="mt-2 whitespace-pre-wrap">{item.body}</p>
                    {item.kind === "private_justification" && (
                      <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs">
                        {t("community.private")}
                      </span>
                    )}
                  </article>
                ))}
              </div>
              {channelId &&
              channels.find((channel) => channel.id === channelId)?.status ===
                "community_active" ? (
                <VerifiedForm className="mt-3 space-y-3" onSubmit={send}>
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
