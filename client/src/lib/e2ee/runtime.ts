import {
  UnavailableSignalProtocolProvider,
  type SignalProtocolProvider,
} from "./provider";
import type {
  E2eeDistributionChannel,
  E2eePlatform,
  E2eeRuntimeDescriptor,
} from "./types";

export const E2EE_RUNTIME_BRIDGE_KEY = "__UMBRAVIA_E2EE_RUNTIME__";
export const E2EE_RUNTIME_BRIDGE_VERSION = 1;

interface E2eeRuntimeBridge {
  version: typeof E2EE_RUNTIME_BRIDGE_VERSION;
  platform: E2eePlatform;
  distribution: E2eeDistributionChannel;
  appOrigin?: string | null;
}

export interface E2eeRuntimeDetectionInput {
  bridge?: unknown;
  origin?: string | null;
}

export type SignalProtocolProviderFactory = (
  runtime: E2eeRuntimeDescriptor,
) => SignalProtocolProvider;

const supportedPlatforms = new Set<E2eePlatform>([
  "web",
  "windows",
  "macos",
  "ios",
  "android",
]);

const supportedDistributions = new Set<E2eeDistributionChannel>([
  "web",
  "microsoft-store",
  "mac-app-store",
  "app-store",
  "play-store",
  "direct",
]);

const allowedDistributions: Record<
  E2eePlatform,
  ReadonlySet<E2eeDistributionChannel>
> = {
  web: new Set(["web"]),
  windows: new Set(["microsoft-store", "direct"]),
  macos: new Set(["mac-app-store", "direct"]),
  ios: new Set(["app-store"]),
  android: new Set(["play-store", "direct"]),
};

export class InvalidE2eeRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidE2eeRuntimeError";
  }
}

function isRuntimeBridge(value: unknown): value is E2eeRuntimeBridge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === E2EE_RUNTIME_BRIDGE_VERSION &&
    typeof candidate.platform === "string" &&
    supportedPlatforms.has(candidate.platform as E2eePlatform) &&
    typeof candidate.distribution === "string" &&
    supportedDistributions.has(
      candidate.distribution as E2eeDistributionChannel,
    ) &&
    (candidate.appOrigin === undefined ||
      candidate.appOrigin === null ||
      typeof candidate.appOrigin === "string")
  );
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readBrowserRuntime(): E2eeRuntimeDetectionInput {
  const root = globalThis as unknown as Record<string, unknown>;
  const locationValue = root.location;
  const origin =
    locationValue && typeof locationValue === "object"
      ? (locationValue as { origin?: unknown }).origin
      : null;
  return {
    bridge: root[E2EE_RUNTIME_BRIDGE_KEY],
    origin: typeof origin === "string" ? origin : null,
  };
}

/**
 * The browser is the active target. Packaged applications must declare their
 * runtime explicitly through the versioned bridge instead of relying on user
 * agent detection.
 */
export function detectE2eeRuntime(
  input: E2eeRuntimeDetectionInput = readBrowserRuntime(),
): E2eeRuntimeDescriptor {
  if (input.bridge === undefined) {
    return {
      platform: "web",
      distribution: "web",
      appOrigin: normalizeOrigin(input.origin),
      packaged: false,
    };
  }

  if (!isRuntimeBridge(input.bridge)) {
    throw new InvalidE2eeRuntimeError(
      "The Umbravia E2EE runtime bridge is malformed or unsupported.",
    );
  }

  if (
    !allowedDistributions[input.bridge.platform].has(input.bridge.distribution)
  ) {
    throw new InvalidE2eeRuntimeError(
      `Distribution ${input.bridge.distribution} is not valid for ${input.bridge.platform}.`,
    );
  }

  const appOrigin = normalizeOrigin(input.bridge.appOrigin ?? input.origin);
  if (input.bridge.appOrigin && !appOrigin) {
    throw new InvalidE2eeRuntimeError(
      "The Umbravia E2EE runtime bridge contains an invalid app origin.",
    );
  }

  return {
    platform: input.bridge.platform,
    distribution: input.bridge.distribution,
    appOrigin,
    packaged: input.bridge.platform !== "web",
  };
}

export function createE2eeClientDeviceId(
  runtime: E2eeRuntimeDescriptor,
  randomId: string = crypto.randomUUID(),
): string {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(randomId)) {
    throw new InvalidE2eeRuntimeError("The E2EE device identifier is invalid.");
  }
  return `${runtime.platform}:${randomId}`;
}

export class SignalProtocolProviderRegistry {
  private readonly factories = new Map<
    E2eePlatform,
    SignalProtocolProviderFactory
  >();

  register(
    platform: E2eePlatform,
    factory: SignalProtocolProviderFactory,
  ): void {
    if (this.factories.has(platform)) {
      throw new InvalidE2eeRuntimeError(
        `A Signal Protocol provider is already registered for ${platform}.`,
      );
    }
    this.factories.set(platform, factory);
  }

  has(platform: E2eePlatform): boolean {
    return this.factories.has(platform);
  }

  resolve(runtime: E2eeRuntimeDescriptor): SignalProtocolProvider {
    const factory = this.factories.get(runtime.platform);
    return factory
      ? factory(runtime)
      : new UnavailableSignalProtocolProvider(runtime.platform);
  }
}

export function createSignalProtocolProviderRegistry(): SignalProtocolProviderRegistry {
  return new SignalProtocolProviderRegistry();
}

export function resolveSignalProtocolProvider(
  registry: SignalProtocolProviderRegistry,
  input?: E2eeRuntimeDetectionInput,
): {
  runtime: E2eeRuntimeDescriptor;
  provider: SignalProtocolProvider;
} {
  const runtime = detectE2eeRuntime(input);
  return { runtime, provider: registry.resolve(runtime) };
}
