import { describe, expect, it } from "vitest";
import {
  SignalProviderUnavailableError,
  UnavailableSignalProtocolProvider,
} from "./provider";

describe("Signal Protocol provider boundary", () => {
  it("fails closed instead of falling back to plaintext", async () => {
    const provider = new UnavailableSignalProtocolProvider();
    await expect(
      provider.createDevice("browser-device"),
    ).rejects.toBeInstanceOf(SignalProviderUnavailableError);
    await expect(provider.replenishPrekeys(10)).rejects.toBeInstanceOf(
      SignalProviderUnavailableError,
    );
  });
});
