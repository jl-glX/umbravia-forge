import type { UmfSupportCapabilities } from "./umf-support";

export type UmfSupportMailNotice =
  | "outboundMissing"
  | "outboundInvalid"
  | "queueMissing"
  | "queueInvalid"
  | "outboundVerificationPending"
  | "inboundAddressMissing"
  | "inboundDisabled"
  | "inboundInvalid"
  | "inboundVerificationPending";

export function getUmfSupportMailNotices(
  email: UmfSupportCapabilities["email"],
): UmfSupportMailNotice[] {
  const notices: UmfSupportMailNotice[] = [];

  if (!email.outbound) {
    if (email.outboundState === "invalid") {
      notices.push("outboundInvalid");
    } else if (email.outboundState !== "configured") {
      notices.push("outboundMissing");
    } else if (email.queueState === "invalid") {
      notices.push("queueInvalid");
    } else if (email.queueState === "missing") {
      notices.push("queueMissing");
    } else {
      notices.push("outboundInvalid");
    }
  } else if (!email.outboundOperationallyVerified) {
    notices.push("outboundVerificationPending");
  }

  if (!email.inbound) {
    if (email.inboundState === "invalid") {
      notices.push("inboundInvalid");
    } else if (!email.addressConfigured) {
      notices.push("inboundAddressMissing");
    } else {
      notices.push("inboundDisabled");
    }
  } else if (!email.inboundOperationallyVerified) {
    notices.push("inboundVerificationPending");
  }

  return notices;
}
