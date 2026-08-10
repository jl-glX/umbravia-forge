export type E2eeEnvelopeType = "prekey" | "signal";

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

export interface DecryptedMessage {
  plaintext: Uint8Array;
  senderDeviceId: string;
  clientMessageId: string;
}
