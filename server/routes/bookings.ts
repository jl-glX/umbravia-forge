import express from "express";
import {
  bookClass,
  cancelBooking,
  getUserBookings,
  getClassBookings,
  getClassWaitlist,
  exportClassAttendeesCsv,
  markBookingAttendance,
  recordBookingReminder,
  setAttendanceIntention,
} from "../services/booking.js";
import {
  adjustBookingReputation,
  getBookingReputation,
} from "../services/booking-reputation.js";
import {
  bookingAttendanceValidation,
  bookingCancellationValidation,
  bookingIntentionValidation,
  bookingValidation,
  reputationAdjustmentValidation,
  validateId,
} from "../middleware/validation.js";
import {
  authenticate,
  getFacilityContext,
  requireBookingFacility,
  requireFacility,
  requireSelfBodyOrFacilityRole,
  requireSelfFacilityRoleOrBookingDelegation,
  requireSelfParamOrFacilityRole,
  requireTrainerBookingOrRole,
  requireTrainerClassOrRole,
  selectFacilityContext,
} from "../middleware/authorization.js";
import { requireRecentFormVerification } from "../middleware/form-verification.js";

export const bookingsRouter = express.Router();
bookingsRouter.use(authenticate);
bookingsRouter.use(selectFacilityContext);
bookingsRouter.use(requireFacility());

// Get user bookings
bookingsRouter.get(
  "/user/:userId",
  validateId("userId"),
  requireSelfParamOrFacilityRole("userId", "admin", "owner"),
  async (req: express.Request, res: express.Response) => {
    try {
      const bookings = await getUserBookings(
        req.params.userId,
        getFacilityContext(res).id,
      );
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching user bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  },
);

// Get class bookings (for admin/trainer view)
bookingsRouter.get(
  "/class/:activitySessionId",
  validateId("activitySessionId"),
  requireTrainerClassOrRole("activitySessionId", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const bookings = await getClassBookings(
        req.params.activitySessionId,
        getFacilityContext(res).id,
      );
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching class bookings:", error);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  },
);

// Export class attendees as CSV
bookingsRouter.get(
  "/class/:activitySessionId/export-csv",
  validateId("activitySessionId"),
  requireTrainerClassOrRole("activitySessionId", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const csv = await exportClassAttendeesCsv(
        req.params.activitySessionId,
        getFacilityContext(res).id,
      );
      res.setHeader("Content-Type", "text/csv;charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendees-${req.params.activitySessionId}.csv"`,
      );
      res.send(csv);
    } catch (error) {
      console.error("Error exporting CSV:", error);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  },
);

// Create booking
bookingsRouter.post(
  "/",
  bookingValidation,
  requireSelfFacilityRoleOrBookingDelegation("userId", "admin", "owner"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { activitySessionId, userId } = req.body;

      if (!activitySessionId || !userId) {
        res.status(400).json({ error: "Missing activitySessionId or userId" });
        return;
      }

      const result = await bookClass(
        activitySessionId,
        userId,
        getFacilityContext(res).id,
      );
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error creating booking:", error);
      res.status(400).json({ error: message });
    }
  },
);

bookingsRouter.put(
  "/:bookingId/intention",
  bookingIntentionValidation,
  requireBookingFacility("bookingId"),
  requireSelfBodyOrFacilityRole("userId", "admin", "owner"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await setAttendanceIntention(
          req.params.bookingId,
          req.body.userId,
          req.body.intention,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  },
);

bookingsRouter.post(
  "/:bookingId/reminder",
  validateId("bookingId"),
  requireTrainerBookingOrRole("bookingId", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await recordBookingReminder(req.params.bookingId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  },
);

bookingsRouter.put(
  "/:bookingId/attendance",
  bookingAttendanceValidation,
  requireTrainerBookingOrRole("bookingId", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(
        await markBookingAttendance(req.params.bookingId, req.body.status),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  },
);

bookingsRouter.get(
  "/reputation/:userId",
  validateId("userId"),
  requireSelfParamOrFacilityRole("userId", "admin", "owner"),
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      res.json(
        await getBookingReputation(
          req.params.userId,
          getFacilityContext(res).id,
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "User not found") {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

bookingsRouter.post(
  "/reputation/:userId/adjustment",
  reputationAdjustmentValidation,
  requireFacility("admin", "owner"),
  requireRecentFormVerification,
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      res.json(
        await adjustBookingReputation({
          userId: req.params.userId,
          facilityId: getFacilityContext(res).id,
          pointsDelta: req.body.pointsDelta,
          reason: req.body.reason,
          clearPenalty: req.body.clearPenalty,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "User not found") {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

// Cancel booking
bookingsRouter.delete(
  "/:bookingId",
  bookingCancellationValidation,
  requireBookingFacility("bookingId"),
  requireSelfFacilityRoleOrBookingDelegation("userId", "admin", "owner"),
  async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({ error: "Missing userId" });
        return;
      }

      await cancelBooking(req.params.bookingId, userId);
      res.json({ message: "Booking cancelled successfully" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error cancelling booking:", error);
      res.status(400).json({ error: message });
    }
  },
);

// Get class waitlist
bookingsRouter.get(
  "/waitlist/:activitySessionId",
  validateId("activitySessionId"),
  requireTrainerClassOrRole("activitySessionId", "admin"),
  async (req: express.Request, res: express.Response) => {
    try {
      const waitlist = await getClassWaitlist(
        req.params.activitySessionId,
        getFacilityContext(res).id,
      );
      res.json(waitlist);
    } catch (error) {
      console.error("Error fetching waitlist:", error);
      res.status(500).json({ error: "Failed to fetch waitlist" });
    }
  },
);
