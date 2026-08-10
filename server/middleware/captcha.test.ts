import express from "express";
import request from "supertest";
import { afterEach, describe, it, vi } from "vitest";

vi.mock("../services/security-events.js", () => ({
  recordSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { requireCaptcha } from "./captcha.js";

function testApp() {
  const app = express();
  app.use(express.json());
  app.post("/protected", requireCaptcha("login"), (_req, res) => {
    res.json({ allowed: true });
  });
  return app;
}

describe("captcha middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns a controlled failure when production is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await request(testApp())
      .post("/protected")
      .send({ captchaToken: "anything" })
      .expect(503, {
        code: "CAPTCHA_NOT_CONFIGURED",
        error: "Human verification is temporarily unavailable",
      });
  });

  it("does not let a missing token reach the protected handler", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "production-secret");
    await request(testApp()).post("/protected").send({}).expect(403, {
      code: "CAPTCHA_FAILED",
      error: "Human verification failed or expired",
    });
  });

  it("lets a server-validated token reach the protected handler", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "production-secret");
    vi.stubEnv("CLIENT_ORIGIN", "https://app.umbravia-forge.example");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            action: "login",
            hostname: "app.umbravia-forge.example",
          }),
          { status: 200 },
        ),
      ),
    );
    await request(testApp())
      .post("/protected")
      .send({ captchaToken: "test-token" })
      .expect(200, { allowed: true });
  });
});
