import express from "express";
import {
  getMonthlyMetrics,
  getClassPopularity,
  getPeakHours,
  getUserActivityMetrics,
  getTrainerActivityMetrics,
  getMemberMetrics,
  getUpcomingBookings,
  getTrainerUpcomingClasses,
  getAnalyticsOverview,
} from "../services/analytics.js";
import { monthValidation, validateId } from "../middleware/validation.js";
import {
  authenticate,
  getAuthenticatedUser,
  getFacilityContext,
  requireFacility,
  requireSelfParamOrFacilityRole,
  selectFacilityContext,
} from "../middleware/authorization.js";

export const analyticsRouter = express.Router();
analyticsRouter.use(authenticate, selectFacilityContext, requireFacility());

const MAX_ANALYTICS_PERIOD_MS = 93 * 24 * 60 * 60 * 1_000;

analyticsRouter.get(
  "/overview",
  requireFacility("trainer", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    const utcOffsetMinutes = Number(req.query.utcOffsetMinutes ?? 0);
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from >= to ||
      to - from > MAX_ANALYTICS_PERIOD_MS ||
      !Number.isInteger(utcOffsetMinutes) ||
      utcOffsetMinutes < -840 ||
      utcOffsetMinutes > 840
    ) {
      res.status(400).json({
        error: "The analytics period is invalid or exceeds 93 days",
        code: "ANALYTICS_PERIOD_INVALID",
      });
      return;
    }

    try {
      const auth = getAuthenticatedUser(res);
      const facility = getFacilityContext(res);
      const consumer =
        facility.role === "trainer" ? "trainer" : "administration";
      const overview = await getAnalyticsOverview({
        from,
        to,
        utcOffsetMinutes,
        facilityId: facility.id,
        consumer,
        trainerId: consumer === "trainer" ? auth.userId : undefined,
      });
      res.json(overview);
    } catch (error) {
      console.error("Error fetching analytics overview:", error);
      res.status(500).json({
        error: "Failed to fetch analytics overview",
        code: "ANALYTICS_OVERVIEW_FAILED",
      });
    }
  },
);

// Get monthly metrics
analyticsRouter.get(
  "/monthly",
  monthValidation,
  requireFacility("owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);

      if (!year || !month) {
        res.status(400).json({ error: "Missing year or month" });
        return;
      }

      const metrics = await getMonthlyMetrics(
        year,
        month,
        getFacilityContext(res).id,
      );
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching monthly metrics:", error);
      res.status(500).json({ error: "Failed to fetch monthly metrics" });
    }
  },
);

// Get class popularity
analyticsRouter.get(
  "/class-popularity",
  requireFacility("member", "trainer", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const popularity = await getClassPopularity(getFacilityContext(res).id);
      res.json(popularity);
    } catch (error) {
      console.error("Error fetching class popularity:", error);
      res.status(500).json({ error: "Failed to fetch class popularity" });
    }
  },
);

// Get peak hours
analyticsRouter.get(
  "/peak-hours",
  requireFacility("member", "trainer", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const peakHours = await getPeakHours(getFacilityContext(res).id);
      res.json(peakHours);
    } catch (error) {
      console.error("Error fetching peak hours:", error);
      res.status(500).json({ error: "Failed to fetch peak hours" });
    }
  },
);

// Get user activity metrics
analyticsRouter.get(
  "/user/:userId",
  validateId("userId"),
  requireSelfParamOrFacilityRole("userId", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const metrics = await getUserActivityMetrics(
        req.params.userId,
        getFacilityContext(res).id,
      );

      if (!metrics) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json(metrics);
    } catch (error) {
      console.error("Error fetching user activity metrics:", error);
      res.status(500).json({ error: "Failed to fetch user activity metrics" });
    }
  },
);

// Get trainer activity metrics
analyticsRouter.get(
  "/trainer/:trainerId",
  validateId("trainerId"),
  requireFacility("trainer", "owner", "admin"),
  requireSelfParamOrFacilityRole("trainerId", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const metrics = await getTrainerActivityMetrics(
        req.params.trainerId,
        getFacilityContext(res).id,
      );
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching trainer activity metrics:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch trainer activity metrics" });
    }
  },
);

// Get member metrics
analyticsRouter.get(
  "/members",
  requireFacility("owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const metrics = await getMemberMetrics(getFacilityContext(res).id);
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching member metrics:", error);
      res.status(500).json({ error: "Failed to fetch member metrics" });
    }
  },
);

// Get upcoming bookings for a user
analyticsRouter.get(
  "/user/:userId/upcoming-bookings",
  validateId("userId"),
  requireSelfParamOrFacilityRole("userId", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const bookings = await getUpcomingBookings(
        req.params.userId,
        getFacilityContext(res).id,
      );
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching upcoming bookings:", error);
      res.status(500).json({ error: "Failed to fetch upcoming bookings" });
    }
  },
);

// Get trainer upcoming classes
analyticsRouter.get(
  "/trainer/:trainerId/upcoming-classes",
  validateId("trainerId"),
  requireFacility("trainer", "owner", "admin"),
  requireSelfParamOrFacilityRole("trainerId", "owner", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const classes = await getTrainerUpcomingClasses(
        req.params.trainerId,
        getFacilityContext(res).id,
      );
      res.json(classes);
    } catch (error) {
      console.error("Error fetching trainer upcoming classes:", error);
      res.status(500).json({ error: "Failed to fetch upcoming classes" });
    }
  },
);
