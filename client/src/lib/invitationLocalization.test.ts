import { describe, expect, it } from "vitest";
import {
  buildInvitationAcceptancePayload,
  buildInvitationCreationPayload,
} from "./invitationLocalization";

describe("invitation localization payloads", () => {
  it.each([
    ["fr-FR", "fr"],
    ["it_IT", "it"],
    ["ca-ES-valencia", "ca-valencia"],
    ["gl-ES", "gl"],
    ["eu-ES", "eu"],
    ["oc-ES-aranes", "oc-aranes"],
    ["xx", "es"],
    ["ca-notvalencian", "es"],
    [undefined, "es"],
  ] as const)(
    "uses canonical locale %s when creating invitations",
    (input, expected) => {
      expect(
        buildInvitationCreationPayload({
          email: "invitee@example.com",
          name: "Invitee",
          role: "trainer",
          interfaceLocale: input,
        }),
      ).toEqual({
        email: "invitee@example.com",
        name: "Invitee",
        role: "trainer",
        locale: expected,
      });
    },
  );

  it.each([
    ["fr-FR", "fr"],
    ["it_IT", "it"],
    ["ca_ES_valencia", "ca-valencia"],
    ["gl-ES", "gl"],
    ["eu-ES", "eu"],
    ["oc_ES_aranes", "oc-aranes"],
    ["xx", "es"],
    ["ca-notvalencian", "es"],
    [undefined, "es"],
  ] as const)(
    "uses canonical locale %s when accepting invitations",
    (input, expected) => {
      expect(
        buildInvitationAcceptancePayload({
          password: "Password123",
          acceptedTerms: true,
          acceptedPrivacy: true,
          interfaceLocale: input,
        }),
      ).toEqual({
        password: "Password123",
        acceptedTerms: true,
        acceptedPrivacy: true,
        locale: expected,
      });
    },
  );
});
