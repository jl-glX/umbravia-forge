import { authFetch } from "../api";
import type {
  DevicePublication,
  EncryptedEnvelope,
  OutboundEncryptedEnvelope,
  PrekeyBundle,
  PublishedDevice,
} from "./types";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `E2EE request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  return authFetch(`/api/e2ee${path}`, { ...init, headers });
}

export const e2eeApi = {
  publishDevice(bundle: DevicePublication) {
    return request("/devices", {
      method: "POST",
      body: JSON.stringify(bundle),
    }).then((response) => json<PublishedDevice>(response));
  },

  addPrekeys(
    deviceId: string,
    oneTimePrekeys: DevicePublication["oneTimePrekeys"],
  ) {
    return request(`/devices/${encodeURIComponent(deviceId)}/prekeys`, {
      method: "POST",
      body: JSON.stringify({ oneTimePrekeys }),
    }).then((response) => json<{ uploadedPrekeys: number }>(response));
  },

  revokeDevice(deviceId: string) {
    return request(`/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    }).then((response) => {
      if (!response.ok)
        throw new Error(`Device revocation failed (${response.status})`);
    });
  },

  claimPrekeyBundles(userId: string, requesterDeviceId: string) {
    const query = new URLSearchParams({ requesterDeviceId });
    return request(
      `/users/${encodeURIComponent(userId)}/prekey-bundles?${query}`,
    ).then((response) =>
      json<{ userId: string; bundles: PrekeyBundle[] }>(response),
    );
  },

  createConversation(targetUserId: string) {
    return request("/conversations", {
      method: "POST",
      body: JSON.stringify({ targetUserId }),
    }).then((response) => json<{ id: string }>(response));
  },

  sendEnvelope(conversationId: string, envelope: OutboundEncryptedEnvelope) {
    return request(
      `/conversations/${encodeURIComponent(conversationId)}/envelopes`,
      { method: "POST", body: JSON.stringify(envelope) },
    ).then((response) => json<EncryptedEnvelope>(response));
  },

  receiveEnvelopes(deviceId: string, after = 0, limit = 50) {
    const query = new URLSearchParams({
      after: String(after),
      limit: String(limit),
    });
    return request(
      `/devices/${encodeURIComponent(deviceId)}/envelopes?${query}`,
    ).then((response) => json<EncryptedEnvelope[]>(response));
  },

  acknowledge(
    deviceId: string,
    envelopeIds: string[],
    state: "delivered" | "read",
  ) {
    return request(`/devices/${encodeURIComponent(deviceId)}/receipts`, {
      method: "POST",
      body: JSON.stringify({ envelopeIds, state }),
    }).then((response) => json<{ updated: number; state: string }>(response));
  },
};
