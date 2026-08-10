import type {
  DecryptedMessage,
  DevicePublication,
  EncryptedEnvelope,
  OutboundEncryptedEnvelope,
  PrekeyBundle,
  E2eePlatform,
} from "./types";

/**
 * Boundary for a browser-capable, audited Signal Protocol implementation.
 * The server never receives plaintext, identity private keys or session state.
 */
export interface SignalProtocolProvider {
  readonly capabilityVersion: string;
  createDevice(clientDeviceId: string): Promise<DevicePublication>;
  replenishPrekeys(count: number): Promise<DevicePublication["oneTimePrekeys"]>;
  encrypt(
    plaintext: Uint8Array,
    bundles: PrekeyBundle[],
    senderDeviceId: string,
    clientMessageId: string,
  ): Promise<OutboundEncryptedEnvelope[]>;
  decrypt(envelope: EncryptedEnvelope): Promise<DecryptedMessage>;
}

export class SignalProviderUnavailableError extends Error {
  readonly platform: E2eePlatform;

  constructor(platform: E2eePlatform = "web") {
    super(
      `No audited Signal Protocol provider is configured for ${platform}. E2EE fails closed.`,
    );
    this.name = "SignalProviderUnavailableError";
    this.platform = platform;
  }
}

/**
 * Deliberately fails closed. This prevents an accidental plaintext fallback
 * while an audited and licence-compatible browser provider is selected.
 */
export class UnavailableSignalProtocolProvider implements SignalProtocolProvider {
  readonly capabilityVersion = "signal-provider-required-v1";
  readonly platform: E2eePlatform;

  constructor(platform: E2eePlatform = "web") {
    this.platform = platform;
  }

  private unavailable(): never {
    throw new SignalProviderUnavailableError(this.platform);
  }

  async createDevice(_clientDeviceId: string): Promise<DevicePublication> {
    return this.unavailable();
  }

  async replenishPrekeys(
    _count: number,
  ): Promise<DevicePublication["oneTimePrekeys"]> {
    return this.unavailable();
  }

  async encrypt(
    _plaintext: Uint8Array,
    _bundles: PrekeyBundle[],
    _senderDeviceId: string,
    _clientMessageId: string,
  ): Promise<OutboundEncryptedEnvelope[]> {
    return this.unavailable();
  }

  async decrypt(_envelope: EncryptedEnvelope): Promise<DecryptedMessage> {
    return this.unavailable();
  }
}
