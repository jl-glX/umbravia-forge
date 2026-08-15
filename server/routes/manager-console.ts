import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  authenticate,
  getAuthenticatedUser,
} from "../middleware/authorization.js";
import {
  authenticateManagerTerminalSession,
  authenticateManagerTerminalHeartbeat,
  closeManagerTerminalSession,
  exchangeManagerTerminalCredential,
  executeManagerConsoleCommand,
  getManagerConsoleOverview,
  issueManagerTerminalCredential,
  MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS,
  MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
  MANAGER_TERMINAL_SESSION_DURATION_MS,
  type ManagerTerminalAccessMode,
} from "../services/manager-console.js";

export const managerConsoleRouter = express.Router();

function readTerminalSessionToken(req: Request) {
  const authorization = req.get("Authorization")?.trim() ?? "";
  const match = /^Umbravia-Terminal\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function readAccessMode(value: unknown): ManagerTerminalAccessMode | null {
  return value === "internal" || value === "external" ? value : null;
}

function readTerminalChannel(req: Request) {
  return readAccessMode(req.get("X-Umbravia-Channel"));
}

async function authenticateTerminal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const channel = readTerminalChannel(req);
    if (!channel) {
      res.status(400).json({
        code: "MANAGER_TERMINAL_CHANNEL_REQUIRED",
        error: "An internal or external terminal channel is required",
      });
      return;
    }
    res.locals.managerTerminal = await authenticateManagerTerminalSession(
      readTerminalSessionToken(req),
      channel,
    );
    next();
  } catch (error) {
    next(error);
  }
}

managerConsoleRouter.get("/", authenticate, async (_req, res, next) => {
  try {
    const auth = getAuthenticatedUser(res);
    if (!auth.corporateConsole.enabled) {
      res.status(403).json({
        code: "MANAGER_CONSOLE_DENIED",
        error: "Corporate manager console access is denied",
      });
      return;
    }
    res.json({
      access: auth.corporateConsole,
      channel: "internal-manager-terminal",
      webConsoleAvailable: false,
      clientCommand: "npm run manager:console",
      compatibility: ["linux", "windows", "wsl", "macos"],
      accessModes: {
        internal: {
          credentialDurationMs: null,
          idleTimeoutMs: MANAGER_INTERNAL_TERMINAL_IDLE_TIMEOUT_MS,
          singleUse: false,
        },
        external: {
          credentialDurationMs: MANAGER_TERMINAL_CREDENTIAL_DURATION_MS,
          terminalSessionDurationMs: MANAGER_TERMINAL_SESSION_DURATION_MS,
          singleUse: true,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

managerConsoleRouter.post(
  "/credential",
  authenticate,
  async (req, res, next) => {
    try {
      const auth = getAuthenticatedUser(res);
      const accessMode = readAccessMode(req.body?.accessMode);
      if (!accessMode) {
        res.status(400).json({
          code: "MANAGER_TERMINAL_ACCESS_MODE_REQUIRED",
          error: "An internal or external access mode is required",
        });
        return;
      }
      res.status(201).json(
        await issueManagerTerminalCredential({
          userId: auth.userId,
          platformOperator: auth.platformOperator,
          accessMode,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

managerConsoleRouter.post("/terminal/connect", async (req, res, next) => {
  try {
    if (typeof req.body?.credential !== "string") {
      res.status(400).json({
        code: "MANAGER_TERMINAL_CREDENTIAL_REQUIRED",
        error: "A terminal credential is required",
      });
      return;
    }
    const channel = readAccessMode(req.body?.channel);
    if (!channel) {
      res.status(400).json({
        code: "MANAGER_TERMINAL_CHANNEL_REQUIRED",
        error: "An internal or external terminal channel is required",
      });
      return;
    }
    res.json(
      await exchangeManagerTerminalCredential(req.body.credential, channel),
    );
  } catch (error) {
    next(error);
  }
});

managerConsoleRouter.get(
  "/terminal/overview",
  authenticateTerminal,
  async (_req, res, next) => {
    try {
      const terminal = res.locals.managerTerminal as {
        userId: string;
        platformOperator: boolean;
      };
      res.json(
        await getManagerConsoleOverview(
          terminal.userId,
          terminal.platformOperator,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

managerConsoleRouter.post("/terminal/heartbeat", async (req, res, next) => {
  try {
    const channel = readTerminalChannel(req);
    if (!channel) {
      res.status(400).json({
        code: "MANAGER_TERMINAL_CHANNEL_REQUIRED",
        error: "An internal or external terminal channel is required",
      });
      return;
    }
    await authenticateManagerTerminalHeartbeat(
      readTerminalSessionToken(req),
      channel,
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

managerConsoleRouter.post(
  "/terminal/disconnect",
  authenticateTerminal,
  async (req, res, next) => {
    try {
      const channel = readTerminalChannel(req);
      await closeManagerTerminalSession(
        readTerminalSessionToken(req),
        channel!,
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

managerConsoleRouter.post(
  "/terminal/execute",
  authenticateTerminal,
  async (req, res, next) => {
    try {
      if (typeof req.body?.command !== "string") {
        res.status(400).json({
          code: "MANAGER_CONSOLE_COMMAND_INVALID",
          error: "A virtual console command is required",
        });
        return;
      }
      const terminal = res.locals.managerTerminal as {
        userId: string;
        platformOperator: boolean;
      };
      res.json(
        await executeManagerConsoleCommand({
          actorUserId: terminal.userId,
          platformOperator: terminal.platformOperator,
          command: req.body.command,
          contextProfileId:
            typeof req.body.contextProfileId === "string"
              ? req.body.contextProfileId
              : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
