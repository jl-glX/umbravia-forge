import { createHash, randomUUID } from "node:crypto";
import webPush, { type PushSubscription } from "web-push";
import { db } from "../db/client.js";
import type { UmfSupportNotificationEvent } from "../db/types.js";
import {
  protectPrivateText,
  revealPrivateText,
} from "../lib/private-content-crypto.js";
import type { AuthenticatedUser } from "../middleware/authorization.js";
import {
  deliverQueuedEmail,
  queueUmfSupportComposedEmail,
} from "./email-delivery.js";
import { publishManagerSignal } from "./manager-coordinator.js";
import { getUmfSupportRole } from "./umf-support.js";

const notificationEvents: UmfSupportNotificationEvent[] = [
  "ticket_created",
  "conversation_received",
  "inbound_email",
  "feedback_received",
  "problem_reported",
];
const allowedBrowserFamilies = new Set([
  "edge",
  "firefox",
  "brave",
  "duckduckgo",
  "chrome",
  "librewolf",
] as const);
type AllowedBrowserFamily =
  "edge" | "firefox" | "brave" | "duckduckgo" | "chrome" | "librewolf";

type NotificationChannels = { email: boolean; push: boolean };
type NotificationPreferences = Record<
  UmfSupportNotificationEvent,
  NotificationChannels
>;

const disabledChannels = (): NotificationChannels => ({
  email: false,
  push: false,
});

function defaultPreferences(): NotificationPreferences {
  return Object.fromEntries(
    notificationEvents.map((event) => [event, disabledChannels()]),
  ) as NotificationPreferences;
}

function parsePreferences(value: string | null): NotificationPreferences {
  const defaults = defaultPreferences();
  if (!value) return defaults;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const event of notificationEvents) {
      const channels = parsed[event];
      if (
        channels &&
        typeof channels === "object" &&
        !Array.isArray(channels)
      ) {
        const candidate = channels as Record<string, unknown>;
        defaults[event] = {
          email: candidate.email === true,
          push: candidate.push === true,
        };
      }
    }
  } catch {
    // Corrupt preferences fail closed instead of enabling a notification channel.
  }
  return defaults;
}

function validatedPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notification preferences are invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(
      (key) => !notificationEvents.includes(key as UmfSupportNotificationEvent),
    )
  ) {
    throw new Error("Unknown notification event");
  }
  const preferences = defaultPreferences();
  for (const event of notificationEvents) {
    const channels = candidate[event];
    if (!channels || typeof channels !== "object" || Array.isArray(channels)) {
      throw new Error("Every notification event must declare its channels");
    }
    const channel = channels as Record<string, unknown>;
    if (
      typeof channel.email !== "boolean" ||
      typeof channel.push !== "boolean" ||
      Object.keys(channel).some((key) => key !== "email" && key !== "push")
    ) {
      throw new Error("Notification channels are invalid");
    }
    preferences[event] = { email: channel.email, push: channel.push };
  }
  return preferences;
}

function pushConfiguration(): {
  subject: string;
  publicKey: string;
  privateKey: string;
} | null {
  const subject = process.env.UMF_SUPPORT_PUSH_VAPID_SUBJECT?.trim();
  const publicKey = process.env.UMF_SUPPORT_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.UMF_SUPPORT_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!subject && !publicKey && !privateKey) return null;
  if (
    !subject ||
    !publicKey ||
    !privateKey ||
    !/^(?:mailto:|https:\/\/)/.test(subject)
  ) {
    throw new Error("UMF Support push configuration is incomplete");
  }
  return { subject, publicKey, privateKey };
}

async function requireSupportStaff(auth: AuthenticatedUser): Promise<void> {
  if (
    auth.identityRealm !== "corporate_support" ||
    !(await getUmfSupportRole(auth.userId))
  ) {
    throw new Error("UMF Support access is required");
  }
}

export async function getUmfSupportNotificationSettings(
  auth: AuthenticatedUser,
) {
  await requireSupportStaff(auth);
  const [row, subscriptions] = await Promise.all([
    db
      .selectFrom("umfSupportNotificationPreferences")
      .selectAll()
      .where("userId", "=", auth.userId)
      .executeTakeFirst(),
    db
      .selectFrom("umfSupportPushSubscriptions")
      .select([
        "id",
        "browserFamily",
        "deviceName",
        "status",
        "createdAt",
        "updatedAt",
      ])
      .where("userId", "=", auth.userId)
      .orderBy("updatedAt", "desc")
      .execute(),
  ]);
  let configuration: ReturnType<typeof pushConfiguration> = null;
  let configurationValid = true;
  try {
    configuration = pushConfiguration();
  } catch {
    configurationValid = false;
  }
  return {
    enabled: row?.enabled === 1,
    preferences: parsePreferences(row?.eventPreferences ?? null),
    push: {
      available: Boolean(configuration) && configurationValid,
      publicKey: configurationValid ? (configuration?.publicKey ?? null) : null,
      devices: subscriptions,
    },
  };
}

export async function updateUmfSupportNotificationSettings(
  auth: AuthenticatedUser,
  input: { enabled?: unknown; preferences?: unknown },
) {
  await requireSupportStaff(auth);
  if (typeof input.enabled !== "boolean") {
    throw new Error("Notification master switch is invalid");
  }
  const preferences = validatedPreferences(input.preferences);
  await db
    .insertInto("umfSupportNotificationPreferences")
    .values({
      userId: auth.userId,
      enabled: input.enabled ? 1 : 0,
      eventPreferences: JSON.stringify(preferences),
      updatedAt: Date.now(),
    })
    .onConflict((conflict) =>
      conflict.column("userId").doUpdateSet({
        enabled: input.enabled ? 1 : 0,
        eventPreferences: JSON.stringify(preferences),
        updatedAt: Date.now(),
      }),
    )
    .execute();
  return { updated: true };
}

function validatedSubscription(value: unknown): PushSubscription {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Push subscription is invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.endpoint !== "string" ||
    !candidate.endpoint.startsWith("https://") ||
    candidate.endpoint.length > 2_048 ||
    !candidate.keys ||
    typeof candidate.keys !== "object" ||
    Array.isArray(candidate.keys)
  ) {
    throw new Error("Push subscription is invalid");
  }
  const keys = candidate.keys as Record<string, unknown>;
  if (
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    keys.p256dh.length > 256 ||
    keys.auth.length > 128
  ) {
    throw new Error("Push subscription keys are invalid");
  }
  return {
    endpoint: candidate.endpoint,
    expirationTime:
      candidate.expirationTime === null ||
      typeof candidate.expirationTime === "number"
        ? candidate.expirationTime
        : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

export async function registerUmfSupportPushSubscription(
  auth: AuthenticatedUser,
  input: {
    subscription?: unknown;
    deviceName?: unknown;
    browserFamily?: unknown;
  },
) {
  await requireSupportStaff(auth);
  if (!pushConfiguration())
    throw new Error("Push notifications are unavailable");
  const subscription = validatedSubscription(input.subscription);
  if (
    typeof input.browserFamily !== "string" ||
    !allowedBrowserFamilies.has(input.browserFamily as AllowedBrowserFamily)
  ) {
    throw new Error("This browser is not enabled for UMF Support push alerts");
  }
  const browserFamily = input.browserFamily as AllowedBrowserFamily;
  const deviceName =
    typeof input.deviceName === "string" && input.deviceName.trim()
      ? input.deviceName.trim().slice(0, 100)
      : "Navegador autorizado";
  const endpointHash = createHash("sha256")
    .update(subscription.endpoint)
    .digest("hex");
  const existing = await db
    .selectFrom("umfSupportPushSubscriptions")
    .select("id")
    .where("endpointHash", "=", endpointHash)
    .executeTakeFirst();
  const id = existing?.id ?? `umf-support-push-${randomUUID()}`;
  const now = Date.now();
  const subscriptionProtected = protectPrivateText(
    JSON.stringify(subscription),
    `umf-support:push-subscription:${id}`,
  );
  await db
    .insertInto("umfSupportPushSubscriptions")
    .values({
      id,
      userId: auth.userId,
      endpointHash,
      subscriptionProtected,
      browserFamily,
      deviceName,
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .onConflict((conflict) =>
      conflict.column("endpointHash").doUpdateSet({
        userId: auth.userId,
        subscriptionProtected,
        browserFamily,
        deviceName,
        status: "active",
        updatedAt: now,
        revokedAt: null,
      }),
    )
    .execute();
  return { id };
}

export async function revokeUmfSupportPushSubscription(
  auth: AuthenticatedUser,
  subscriptionId: string,
) {
  await requireSupportStaff(auth);
  await db
    .updateTable("umfSupportPushSubscriptions")
    .set({ status: "revoked", revokedAt: Date.now(), updatedAt: Date.now() })
    .where("id", "=", subscriptionId)
    .where("userId", "=", auth.userId)
    .execute();
  return { revoked: true };
}

type SupportNotification = {
  event: UmfSupportNotificationEvent;
  title: string;
  message: string;
  url?: string;
  excludeUserId?: string;
};

function controlledSupportEmailUrl(value?: string): string | undefined {
  if (!value?.startsWith("/umf-support")) return undefined;
  const configuredOrigin = process.env.CLIENT_ORIGIN?.split(",")[0]?.trim();
  if (!configuredOrigin) return undefined;
  try {
    const origin = new URL(configuredOrigin);
    const destination = new URL(value, origin);
    return destination.origin === origin.origin
      ? destination.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function sendPush(
  subscriptionRow: {
    id: string;
    subscriptionProtected: string;
  },
  notification: SupportNotification,
): Promise<void> {
  const configuration = pushConfiguration();
  if (!configuration) return;
  webPush.setVapidDetails(
    configuration.subject,
    configuration.publicKey,
    configuration.privateKey,
  );
  try {
    const subscription = JSON.parse(
      revealPrivateText(
        subscriptionRow.subscriptionProtected,
        `umf-support:push-subscription:${subscriptionRow.id}`,
      ),
    ) as PushSubscription;
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        title: notification.title,
        body: notification.message,
        url: notification.url ?? "/umf-support",
        event: notification.event,
      }),
      { TTL: 60 * 60, urgency: "normal" },
    );
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
    if (statusCode === 404 || statusCode === 410) {
      await db
        .updateTable("umfSupportPushSubscriptions")
        .set({
          status: "revoked",
          revokedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where("id", "=", subscriptionRow.id)
        .execute();
      return;
    }
    publishManagerSignal(
      "notification",
      "support",
      "warning",
      "UMF_SUPPORT_PUSH_FAILED",
      "An UMF Support push notification could not be delivered.",
    );
  }
}

export async function notifyUmfSupportAdministrators(
  notification: SupportNotification,
): Promise<void> {
  const staff = await db
    .selectFrom("umfSupportStaff")
    .innerJoin("users", "users.id", "umfSupportStaff.userId")
    .leftJoin(
      "umfSupportNotificationPreferences",
      "umfSupportNotificationPreferences.userId",
      "umfSupportStaff.userId",
    )
    .select([
      "users.id",
      "users.email",
      "users.locale",
      "umfSupportNotificationPreferences.enabled",
      "umfSupportNotificationPreferences.eventPreferences",
    ])
    .where("umfSupportStaff.status", "=", "active")
    .where("users.identityRealm", "=", "corporate_support")
    .where("users.accountStatus", "=", "active")
    .where("users.emailVerifiedAt", "is not", null)
    .execute();
  for (const member of staff) {
    if (member.id === notification.excludeUserId || member.enabled !== 1) {
      continue;
    }
    const channels = parsePreferences(member.eventPreferences)[
      notification.event
    ];
    if (channels.email) {
      try {
        const supportUrl = controlledSupportEmailUrl(notification.url);
        const deliveryId = await queueUmfSupportComposedEmail({
          email: member.email,
          locale: ["es", "en", "de", "de-CH"].includes(member.locale)
            ? (member.locale as "es" | "en" | "de" | "de-CH")
            : "es",
          subject: notification.title,
          message: `${notification.message}${supportUrl ? `\n\n[Abre UMF Support](${supportUrl})` : ""}`,
        });
        void deliverQueuedEmail(deliveryId).catch(() => undefined);
      } catch {
        publishManagerSignal(
          "notification",
          "support",
          "warning",
          "UMF_SUPPORT_NOTIFICATION_EMAIL_FAILED",
          "An UMF Support alert email could not be queued.",
        );
      }
    }
    if (channels.push) {
      const configurationAvailable = (() => {
        try {
          return Boolean(pushConfiguration());
        } catch {
          return false;
        }
      })();
      if (configurationAvailable) {
        const subscriptions = await db
          .selectFrom("umfSupportPushSubscriptions")
          .select(["id", "subscriptionProtected"])
          .where("userId", "=", member.id)
          .where("status", "=", "active")
          .execute();
        await Promise.all(
          subscriptions.map((subscription) =>
            sendPush(subscription, notification),
          ),
        );
      }
    }
  }
}

export const umfSupportNotificationEventTypes = notificationEvents;
