import express from "express";
import type { Server } from "node:http";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { pathToFileURL } from "node:url";
import { setupStaticServing } from "./static-serve.js";
import {
  checkDatabaseConnection,
  closeDatabase,
  databaseProvider,
  initializeDatabase,
} from "./db/client.js";
import { seedDatabase } from "./db/seed.js";
import { authRouter } from "./routes/auth.js";
import { classesRouter } from "./routes/classes.js";
import { bookingsRouter } from "./routes/bookings.js";
import { usersRouter } from "./routes/users.js";
import { adminClassesRouter } from "./routes/admin-classes.js";
import { analyticsRouter } from "./routes/analytics.js";
import { crmRouter } from "./routes/crm.js";
import { accountSecurityRouter } from "./routes/account-security.js";
import { feedbackRouter } from "./routes/feedback.js";
import { billingRouter } from "./routes/billing.js";
import { facilityProfileRouter } from "./routes/facility-profile.js";
import { accountProfileRouter } from "./routes/account-profile.js";
import { accountIdentityRouter } from "./routes/account-identity.js";
import { accountLifecycleRouter } from "./routes/account-lifecycle.js";
import { accountManagerRouter } from "./routes/account-manager.js";
import { accountContinuityRouter } from "./routes/account-continuity.js";
import { dataRetentionRouter } from "./routes/data-retention.js";
import { memberCommerceRouter } from "./routes/member-commerce.js";
import { delegationsRouter } from "./routes/delegations.js";
import { downloadsRouter } from "./routes/downloads.js";
import { resourceManagerRouter } from "./routes/resource-manager.js";
import { securityManagerRouter } from "./routes/security-manager.js";
import { encryptionManagerRouter } from "./routes/encryption-manager.js";
import { environmentManagerRouter } from "./routes/environment-manager.js";
import { emailManagerRouter } from "./routes/email-manager.js";
import { managerConsoleRouter } from "./routes/manager-console.js";
import { capabilityRoadmapRouter } from "./routes/capability-roadmap.js";
import { commercialRouter } from "./routes/commercial.js";
import { communityRouter } from "./routes/community.js";
import { moderationRouter } from "./routes/moderation.js";
import { supportRouter } from "./routes/support.js";
import { supportEmailInboundRouter } from "./routes/support-email-inbound.js";
import { e2eeRouter } from "./routes/e2ee.js";
import {
  apiLimiter,
  apiSecurityHeaders,
  enforceTrustedMutationOrigin,
} from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import {
  startResourceManager,
  stopResourceManager,
} from "./services/resource-manager.js";
import { getAllowedClientOrigins } from "./lib/request-origin.js";
import { shouldSeedDemoData } from "./lib/demo-data-policy.js";
import {
  startAccountLifecycleScheduler,
  stopAccountLifecycleScheduler,
} from "./services/account-lifecycle-scheduler.js";
import { validateProductionConfiguration } from "./lib/production-config.js";
import { parseServerPort } from "./lib/server-endpoint.js";
import {
  rejectAbusiveRequestShape,
  rejectAutomatedProbe,
  rejectUnsupportedHttpMethod,
} from "./middleware/probe-protection.js";
import { configureHttpServerSecurity } from "./lib/http-server-security.js";

dotenv.config();

export const app = express();

app.disable("x-powered-by");
// The self-hosted reverse proxy terminates TLS. Trust exactly that first proxy
// hop in production so secure cookies and client IP rate limits work, without
// accepting arbitrary forwarded headers during local development.
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

const clientOrigins = getAllowedClientOrigins();
app.use(
  cors({
    origin: clientOrigins.length ? clientOrigins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-File-Name",
      "X-Message-Id",
      "X-Facility-Id",
    ],
    credentials: true,
    maxAge: 600,
  }),
);
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
              frameSrc: ["'self'", "https://challenges.cloudflare.com"],
              connectSrc: ["'self'", "https://challenges.cloudflare.com"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity:
      process.env.NODE_ENV === "production" ? undefined : false,
  }),
);

// Reject paths used by generic Internet scanners before they can fall through
// to the SPA. Caddy applies the same policy at the edge; this is the fallback
// when the application is reached directly from the local host.
app.use(rejectUnsupportedHttpMethod);
app.use(rejectAbusiveRequestShape);
app.use(rejectAutomatedProbe);

app.use("/api", apiSecurityHeaders);
app.use("/api", enforceTrustedMutationOrigin);
app.use("/api", apiLimiter);

// The Email Worker signs the exact JSON bytes. Mount its raw-body endpoint
// before the general parsers while retaining the common API protections.
app.use("/api/internal/support-email", supportEmailInboundRouter);

// Facility logos use a larger JSON allowance inside their authenticated router.
// The general API keeps its deliberately small request limit below.
app.use("/api/facility-profile", facilityProfileRouter);
app.use("/api/account/profile", accountProfileRouter);
app.use("/api/account/identity", accountIdentityRouter);

// Body parsing middleware
const requestLimit = process.env.MAX_REQUEST_SIZE || "32kb";
app.use(express.json({ limit: requestLimit }));
app.use(express.urlencoded({ extended: false, limit: requestLimit }));

// API routes
app.use("/api/auth", authRouter);
app.use("/api/account/lifecycle", accountLifecycleRouter);
app.use("/api/account/manager", accountManagerRouter);
app.use("/api/account/continuity", accountContinuityRouter);
app.use("/api/admin/data-retention", dataRetentionRouter);
app.use("/api/activity-sessions", classesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/admin/activity-sessions", adminClassesRouter);

const markLegacyActivitySessionRoute =
  (successorPath: string): express.RequestHandler =>
  (_request, response, next) => {
    response.setHeader("Deprecation", "true");
    response.setHeader("Link", `<${successorPath}>; rel="successor-version"`);
    next();
  };

// One-release compatibility aliases. New clients use activity-session routes;
// the aliases keep an already deployed client functional during the migration.
app.use(
  "/api/classes",
  markLegacyActivitySessionRoute("/api/activity-sessions"),
  classesRouter,
);
app.use(
  "/api/admin/classes",
  markLegacyActivitySessionRoute("/api/admin/activity-sessions"),
  adminClassesRouter,
);
app.use("/api/analytics", analyticsRouter);
app.use("/api/crm", crmRouter);
app.use("/api/account/security", accountSecurityRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/billing", billingRouter);
app.use("/api/member-commerce", memberCommerceRouter);
app.use("/api/account/delegations", delegationsRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/admin/resource-manager", resourceManagerRouter);
app.use("/api/admin/security-manager", securityManagerRouter);
app.use("/api/admin/encryption-manager", encryptionManagerRouter);
app.use("/api/admin/environment-manager", environmentManagerRouter);
app.use("/api/admin/email-manager", emailManagerRouter);
app.use("/api/admin/manager-console", managerConsoleRouter);
app.use("/api/admin/capability-roadmap", capabilityRoadmapRouter);
app.use("/api/commercial", commercialRouter);
app.use("/api/community", communityRouter);
app.use("/api/moderation", moderationRouter);
app.use("/api/support", supportRouter);
app.use("/api/e2ee", e2eeRouter);

if (process.env.NODE_ENV !== "production") {
  app.get("/", (_req, res) => {
    res.json({
      service: "Umbravia Forge API",
      message: "The web application runs on the frontend development URL.",
      frontend: process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:3000",
      health: "/api/health",
    });
  });
}

// Health check endpoint
app.get("/api/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health", async (_req, res) => {
  try {
    await checkDatabaseConnection();
    res.json({ status: "ready", database: databaseProvider });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

app.use("/api", notFoundHandler);

if (process.env.NODE_ENV === "production") {
  setupStaticServing(app);
}

// Keep unmatched and path-normalized requests inside the controlled JSON
// error surface instead of exposing Express' default HTML response.
app.use(notFoundHandler);
app.use(errorHandler);

// Export a function to start the server
export async function startServer(
  port: string | number,
  host = process.env.HOST ?? "127.0.0.1",
): Promise<Server> {
  try {
    const resolvedPort = parseServerPort(port);
    validateProductionConfiguration(process.env, databaseProvider);
    // Initialize database
    await initializeDatabase();
    if (shouldSeedDemoData()) {
      await seedDatabase();
    }
    await startResourceManager();
    await startAccountLifecycleScheduler();

    return await new Promise<Server>((resolve, reject) => {
      const server = app.listen(resolvedPort, host, () => {
        console.log(`API Server running at http://${host}:${resolvedPort}`);
        resolve(server);
      });
      configureHttpServerSecurity(server);
      server.once("error", reject);
    });
  } catch (err) {
    await stopAccountLifecycleScheduler();
    await stopResourceManager();
    throw err;
  }
}

export function stopServer(server: Server): void {
  console.log("Shutting down gracefully...");
  void (async () => {
    await stopAccountLifecycleScheduler();
    await stopResourceManager();
    server.close(async (error) => {
      await closeDatabase();
      if (error) console.error("Failed to stop API server:", error);
      process.exit(error ? 1 : 0);
    });
  })();
}

// Start the server directly if this is the main module
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log("Starting server...");
  startServer(process.env.PORT || 3001)
    .then((server) => {
      process.once("SIGINT", () => stopServer(server));
      process.once("SIGTERM", () => stopServer(server));
    })
    .catch(async (error: unknown) => {
      console.error("Failed to start server:", error);
      await closeDatabase();
      process.exit(1);
    });
}
