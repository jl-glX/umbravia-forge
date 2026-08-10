import type {
  DecryptedMessage,
  DevicePublication,
  EncryptedEnvelope,
  OutboundEncryptedEnvelope,
  PrekeyBundle,
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
  constructor() {
    super(
      "No audited browser Signal Protocol provider is configured. E2EE fails closed.",
    );
    this.name = "SignalProviderUnavailableError";
  }
}

/**
 * Deliberately fails closed. This prevents an accidental plaintext fallback
 * while an audited and licence-compatible browser provider is selected.
 */
export class UnavailableSignalProtocolProvider implements SignalProtocolProvider {
  readonly capabilityVersion = "signal-provider-required-v1";

  private unavailable(): never {
    throw new SignalProviderUnavailableError();
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
