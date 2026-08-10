export type E2eeEnvelopeType = "prekey" | "signal";

export type E2eePlatform = "web" | "windows" | "macos" | "ios" | "android";

export type E2eeDistributionChannel =
  | "web"
  | "microsoft-store"
  | "mac-app-store"
  | "app-store"
  | "play-store"
  | "direct";

export interface E2eeRuntimeDescriptor {
  platform: E2eePlatform;
  distribution: E2eeDistributionChannel;
  appOrigin: string | null;
  packaged: boolean;
}

export interface OneTimePrekey {
  keyId: number;
  publicKey: string;
}

export interface DevicePublication {
  clientDeviceId: string;
  registrationId: number;
  identityKey: string;
  signedPrekeyId: number;
  signedPrekey: string;
  signedPrekeySignature: string;
  capabilityVersion: string;
  oneTimePrekeys: OneTimePrekey[];
}

export interface PublishedDevice {
  id: string;
  clientDeviceId: string;
  capabilityVersion: string;
  uploadedPrekeys: number;
}

export interface PrekeyBundle {
  deviceId: string;
  clientDeviceId: string;
  registrationId: number;
  identityKey: string;
  signedPrekey: OneTimePrekey & { signature: string };
  oneTimePrekey: OneTimePrekey | null;
  capabilityVersion: string;
}

export interface EncryptedEnvelope {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  clientMessageId: string;
  envelopeType: E2eeEnvelopeType;
  ciphertext: string;
  associatedData: string;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  expiresAt: number | null;
}

export interface OutboundEncryptedEnvelope {
  senderDeviceId: string;
  recipientDeviceId: string;
  clientMessageId: string;
  envelopeType: E2eeEnvelopeType;
  ciphertext: string;
  associatedData?: string;
  expiresAt?: number | null;
}

export interface OpaqueE2eeAttachment {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  clientAttachmentId: string;
  sizeBytes: number;
  checksumSha256: string;
  associatedData: string;
  createdAt: number;
  downloadedAt: number | null;
  expiresAt: number | null;
}

export interface OutboundOpaqueE2eeAttachment {
  senderDeviceId: string;
  recipientDeviceId: string;
  clientAttachmentId: string;
  ciphertext: Uint8Array;
  checksumSha256: string;
  associatedData?: string;
  expiresAt?: number | null;
}

export interface DownloadedOpaqueE2eeAttachment {
  ciphertext: Uint8Array;
  checksumSha256: string;
}

export interface DecryptedMessage {
  plaintext: Uint8Array;
  senderDeviceId: string;
  clientMessageId: string;
}
