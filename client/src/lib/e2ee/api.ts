import { authFetch } from "../api";
import type {
  DevicePublication,
  DownloadedOpaqueE2eeAttachment,
  EncryptedEnvelope,
  OpaqueE2eeAttachment,
  OutboundOpaqueE2eeAttachment,
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

function rawRequest(path: string, init: RequestInit = {}) {
  return authFetch(`/api/e2ee${path}`, init);
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

  uploadAttachment(
    conversationId: string,
    attachment: OutboundOpaqueE2eeAttachment,
  ) {
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "X-Sender-Device-Id": attachment.senderDeviceId,
      "X-Recipient-Device-Id": attachment.recipientDeviceId,
      "X-Client-Attachment-Id": attachment.clientAttachmentId,
      "X-Ciphertext-Sha256": attachment.checksumSha256,
    });
    if (attachment.associatedData) {
      headers.set("X-Associated-Data", attachment.associatedData);
    }
    if (attachment.expiresAt) {
      headers.set("X-Expires-At", String(attachment.expiresAt));
    }
    const body = attachment.ciphertext.buffer.slice(
      attachment.ciphertext.byteOffset,
      attachment.ciphertext.byteOffset + attachment.ciphertext.byteLength,
    ) as ArrayBuffer;
    return rawRequest(
      `/conversations/${encodeURIComponent(conversationId)}/attachments`,
      { method: "POST", headers, body },
    ).then((response) => json<OpaqueE2eeAttachment>(response));
  },

  receiveAttachments(deviceId: string, after = 0, limit = 25) {
    const query = new URLSearchParams({
      after: String(after),
      limit: String(limit),
    });
    return rawRequest(
      `/devices/${encodeURIComponent(deviceId)}/attachments?${query}`,
    ).then((response) => json<OpaqueE2eeAttachment[]>(response));
  },

  async downloadAttachment(
    deviceId: string,
    attachmentId: string,
  ): Promise<DownloadedOpaqueE2eeAttachment> {
    const response = await rawRequest(
      `/devices/${encodeURIComponent(deviceId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        body?.error ?? `E2EE attachment download failed (${response.status})`,
      );
    }
    return {
      ciphertext: new Uint8Array(await response.arrayBuffer()),
      checksumSha256: response.headers.get("X-Ciphertext-Sha256") ?? "",
    };
  },

  deleteAttachment(deviceId: string, attachmentId: string) {
    return rawRequest(
      `/devices/${encodeURIComponent(deviceId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    ).then((response) => {
      if (!response.ok) {
        throw new Error(`E2EE attachment deletion failed (${response.status})`);
      }
    });
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
