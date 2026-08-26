import { describe, expect, it } from "vitest";
import { resolveBackgroundJobsConfiguration } from "./background-jobs-config.js";

describe("background jobs configuration", () => {
  it("keeps the single-node behavior enabled by default", () => {
    expect(resolveBackgroundJobsConfiguration({})).toEqual({ enabled: true });
  });

  it("allows web replicas to disable in-process schedulers", () => {
    expect(
      resolveBackgroundJobsConfiguration({ BACKGROUND_JOBS_ENABLED: "false" }),
    ).toEqual({ enabled: false });
  });

  it("rejects ambiguous values", () => {
    expect(() =>
      resolveBackgroundJobsConfiguration({ BACKGROUND_JOBS_ENABLED: "yes" }),
    ).toThrow(/true or false/i);
  });
});
