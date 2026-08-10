import { describe, expect, it } from "vitest";
import type { SignalProtocolProvider } from "./provider";
import { SignalProviderUnavailableError } from "./provider";
import {
  createE2eeClientDeviceId,
  createSignalProtocolProviderRegistry,
  detectE2eeRuntime,
  InvalidE2eeRuntimeError,
  resolveSignalProtocolProvider,
} from "./runtime";

describe("E2EE platform runtime", () => {
  it("targets the current website by default", () => {
    expect(
      detectE2eeRuntime({ origin: "https://www.umbraviaforge.com/login" }),
    ).toEqual({
      platform: "web",
      distribution: "web",
      appOrigin: "https://www.umbraviaforge.com",
      packaged: false,
    });
  });

  it("accepts an explicit future packaged runtime", () => {
    expect(
      detectE2eeRuntime({
        origin: "https://www.umbraviaforge.com",
        bridge: {
          version: 1,
          platform: "windows",
          distribution: "microsoft-store",
        },
      }),
    ).toEqual({
      platform: "windows",
      distribution: "microsoft-store",
      appOrigin: "https://www.umbraviaforge.com",
      packaged: true,
    });
  });

  it("rejects contradictory platform and store declarations", () => {
    expect(() =>
      detectE2eeRuntime({
        bridge: {
          version: 1,
          platform: "ios",
          distribution: "play-store",
        },
      }),
    ).toThrow(InvalidE2eeRuntimeError);
  });

  it("creates server-compatible platform-scoped device identifiers", () => {
    const runtime = detectE2eeRuntime({
      origin: "https://www.umbraviaforge.com",
    });
    expect(createE2eeClientDeviceId(runtime, "device_123")).toBe(
      "web:device_123",
    );
  });

  it("fails closed on web until an audited provider is registered", async () => {
    const registry = createSignalProtocolProviderRegistry();
    const { runtime, provider } = resolveSignalProtocolProvider(registry, {
      origin: "https://www.umbraviaforge.com",
    });

    expect(runtime.platform).toBe("web");
    await expect(provider.createDevice("web:device_123")).rejects.toMatchObject(
      {
        platform: "web",
      },
    );
    await expect(
      provider.createDevice("web:device_123"),
    ).rejects.toBeInstanceOf(SignalProviderUnavailableError);
  });

  it("allows a future application shell to register its provider", () => {
    const registry = createSignalProtocolProviderRegistry();
    const provider = {
      capabilityVersion: "test-provider-v1",
    } as SignalProtocolProvider;
    registry.register("android", () => provider);

    const resolved = resolveSignalProtocolProvider(registry, {
      bridge: {
        version: 1,
        platform: "android",
        distribution: "play-store",
      },
    });

    expect(resolved.runtime.platform).toBe("android");
    expect(resolved.provider).toBe(provider);
  });
});
