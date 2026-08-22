import { describe, expect, it } from "vitest";
import {
  getUmfSupportMailNotices,
  type UmfSupportMailNotice,
} from "./umf-support-mail-readiness";
import type { UmfSupportCapabilities } from "./umf-support";

function email(
  overrides: Partial<UmfSupportCapabilities["email"]> = {},
): UmfSupportCapabilities["email"] {
  return {
    outbound: true,
    inbound: true,
    addressConfigured: true,
    configurationValid: true,
    outboundState: "configured",
    queueState: "configured",
    inboundState: "configured",
    outboundOperationallyVerified: true,
    inboundOperationallyVerified: true,
    ...overrides,
  };
}

function notices(
  overrides: Partial<UmfSupportCapabilities["email"]>,
): UmfSupportMailNotice[] {
  return getUmfSupportMailNotices(email(overrides));
}

describe("UMF Support mail readiness notices", () => {
  it("does not warn after both directions have end-to-end evidence", () => {
    expect(notices({})).toEqual([]);
  });

  it("identifies missing inbound address without questioning outbound mail", () => {
    expect(
      notices({
        inbound: false,
        inboundState: "disabled",
        addressConfigured: false,
        inboundOperationallyVerified: false,
      }),
    ).toEqual(["inboundAddressMissing"]);
  });

  it("distinguishes configuration from pending operational validation", () => {
    expect(
      notices({
        outboundOperationallyVerified: false,
        inboundOperationallyVerified: false,
      }),
    ).toEqual(["outboundVerificationPending", "inboundVerificationPending"]);
  });

  it("reports queue protection separately from SMTP configuration", () => {
    expect(
      notices({
        outbound: false,
        outboundState: "configured",
        queueState: "missing",
        outboundOperationallyVerified: false,
      }),
    ).toEqual(["queueMissing"]);
  });
});
