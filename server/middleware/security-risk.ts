import type { NextFunction, Request, Response } from "express";
import { recordSecurityEvent } from "../services/security-events.js";
import {
  assessSecurityRisk,
  requestSecuritySignals,
} from "../services/security-risk.js";
import { publishManagerSignal } from "../services/manager-coordinator.js";

export function observeSecurityRisk(surface: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const assessment = assessSecurityRisk(requestSecuritySignals(req));
    res.locals.securityRisk = assessment;

    if (assessment.reasons.length && process.env.NODE_ENV !== "test") {
      if (assessment.level === "high") {
        publishManagerSignal(
          "security",
          "commercial",
          "warning",
          "HIGH_RISK_OBSERVED",
          `${surface}: ${assessment.reasons.join(",")}`,
        );
      }
      void recordSecurityEvent("risk_observed", null, {
        surface,
        level: assessment.level,
        score: assessment.score,
        reason: assessment.reasons.join(","),
      }).catch(() => {
        // Observation must never become a dependency of authentication.
      });
    }

    next();
  };
}
