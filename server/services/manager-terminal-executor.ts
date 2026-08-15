import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  getManagerConnectionCryptoStatus,
  protectManagerConnectionPayload,
  revealManagerConnectionPayload,
} from "../lib/manager-connection-crypto.js";

const DEFAULT_IMAGE = "umbravia-forge/manager-terminal:0.1.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_WORKSPACE_ARCHIVE_BYTES = 16 * 1024 * 1024;
const WORKSPACE_LABEL = "com.umbraviaforge.manager-terminal-workspace";
const ACCESS_LABEL = "com.umbraviaforge.manager-terminal-access";

export interface ManagerTerminalExecutionRequest {
  accessId: string;
  workspaceKey: string;
  command: string;
  timeoutMs?: number;
}

export interface ManagerTerminalExecutionResult {
  backend: "docker";
  containerName: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export class ManagerTerminalExecutionUnavailableError extends Error {
  readonly status = 503;
  readonly statusCode = 503;
  readonly code = "MANAGER_TERMINAL_EXECUTION_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "ManagerTerminalExecutionUnavailableError";
  }
}

function configuredBoolean(value: string | undefined, fallback = false) {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ManagerTerminalExecutionUnavailableError(
    "MANAGER_TERMINAL_EXECUTION_ENABLED must be true or false",
  );
}

function configuredPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ManagerTerminalExecutionUnavailableError(
      `Terminal execution limit must be between 1 and ${maximum}`,
    );
  }
  return parsed;
}

function stableRuntimeName(prefix: string, value: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function validateCommand(command: string) {
  const normalized = command.trim();
  if (!normalized || normalized.length > 16_384 || normalized.includes("\0")) {
    throw new ManagerTerminalExecutionUnavailableError(
      "The sandbox command is empty or exceeds the execution limit",
    );
  }
  return normalized;
}

export function translateManagerTerminalCommand(command: string) {
  const match =
    /^(dir|type|copy|move|del|erase|where|cls)(?:\s+([\s\S]*))?$/i.exec(
      command,
    );
  if (!match) return command;
  const rest = match[2]?.trim() ?? "";
  const aliases: Record<string, string> = {
    dir: "ls -la",
    type: "cat",
    copy: "cp",
    move: "mv",
    del: "rm",
    erase: "rm",
    where: "command -v",
    cls: "clear",
  };
  return `${aliases[match[1].toLowerCase()]}${rest ? ` ${rest}` : ""}`;
}

async function runDocker(
  argumentsList: string[],
  options: {
    timeoutMs: number;
    stdin?: string | Buffer;
    maxOutputBytes?: number;
  } = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
) {
  return await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    truncated: boolean;
  }>((resolve, reject) => {
    const child = spawn("docker", argumentsList, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      if (remaining === 0) {
        truncated = true;
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      outputBytes += accepted.byteLength;
      if (accepted.byteLength < chunk.byteLength) truncated = true;
      if (target === "stdout") stdout += accepted.toString("utf8");
      else stderr += accepted.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => reject(error));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? (timedOut ? 124 : 1),
        stdout,
        stderr,
        timedOut,
        truncated,
      });
    });
    child.stdin.end(options.stdin);
  });
}

function executionConfiguration() {
  const networkMode =
    process.env.MANAGER_TERMINAL_NETWORK_MODE?.trim() || "none";
  if (networkMode !== "none" && networkMode !== "bridge") {
    throw new ManagerTerminalExecutionUnavailableError(
      "MANAGER_TERMINAL_NETWORK_MODE must be none or bridge",
    );
  }
  return {
    enabled: configuredBoolean(
      process.env.MANAGER_TERMINAL_EXECUTION_ENABLED,
      false,
    ),
    image: process.env.MANAGER_TERMINAL_SANDBOX_IMAGE?.trim() || DEFAULT_IMAGE,
    networkMode,
    timeoutMs: configuredPositiveInteger(
      process.env.MANAGER_TERMINAL_COMMAND_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    memory: process.env.MANAGER_TERMINAL_MEMORY_LIMIT?.trim() || "512m",
    cpus: process.env.MANAGER_TERMINAL_CPU_LIMIT?.trim() || "0.50",
    pids: configuredPositiveInteger(
      process.env.MANAGER_TERMINAL_PIDS_LIMIT,
      128,
      512,
    ),
    encryptedWorkspaceRoot: resolve(
      process.env.MANAGER_TERMINAL_ENCRYPTED_WORKSPACE_ROOT?.trim() ||
        "data/runtime/manager-terminal-encrypted-workspaces",
    ),
  };
}

function stableReference(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceEncryptionContext(reference: string) {
  return `manager-terminal-workspace:${reference}`;
}

function encryptedWorkspacePath(root: string, reference: string) {
  return join(root, `${reference}.xchacha20`);
}

async function prepareEncryptedWorkspaceRoot(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(root, 0o700);
}

async function restoreEncryptedWorkspace(input: {
  containerName: string;
  workspaceReference: string;
  encryptedWorkspaceRoot: string;
}) {
  const archivePath = encryptedWorkspacePath(
    input.encryptedWorkspaceRoot,
    input.workspaceReference,
  );
  let envelope: string;
  try {
    envelope = await readFile(archivePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const archive = revealManagerConnectionPayload(
    envelope.trim(),
    workspaceEncryptionContext(input.workspaceReference),
  );
  if (archive.byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new ManagerTerminalExecutionUnavailableError(
      "The encrypted terminal workspace exceeds the restore limit",
    );
  }
  const restored = await runDocker(
    [
      "exec",
      "--interactive",
      "--user",
      "10001:10001",
      input.containerName,
      "/bin/bash",
      "-lc",
      "base64 -d | tar -xzf - -C /workspace",
    ],
    {
      timeoutMs: 30_000,
      stdin: archive.toString("base64"),
    },
  );
  if (restored.exitCode !== 0) {
    throw new ManagerTerminalExecutionUnavailableError(
      `The encrypted terminal workspace could not be restored: ${restored.stderr.trim() || "archive rejected"}`,
    );
  }
  return true;
}

async function persistEncryptedWorkspace(input: {
  containerName: string;
  workspaceReference: string;
  encryptedWorkspaceRoot: string;
}) {
  const archived = await runDocker(
    [
      "exec",
      "--user",
      "10001:10001",
      input.containerName,
      "/bin/bash",
      "-lc",
      "tar -czf - -C /workspace . | base64 -w 0",
    ],
    {
      timeoutMs: 30_000,
      maxOutputBytes: Math.ceil((MAX_WORKSPACE_ARCHIVE_BYTES * 4) / 3) + 4096,
    },
  );
  if (archived.exitCode !== 0 || archived.truncated) {
    throw new ManagerTerminalExecutionUnavailableError(
      `The terminal workspace could not be sealed: ${archived.stderr.trim() || "archive limit exceeded"}`,
    );
  }
  const archive = Buffer.from(archived.stdout.trim(), "base64");
  if (
    archive.byteLength === 0 ||
    archive.byteLength > MAX_WORKSPACE_ARCHIVE_BYTES
  ) {
    throw new ManagerTerminalExecutionUnavailableError(
      "The terminal workspace archive is empty or exceeds the persistence limit",
    );
  }
  const envelope = protectManagerConnectionPayload(
    archive,
    workspaceEncryptionContext(input.workspaceReference),
  );
  await prepareEncryptedWorkspaceRoot(input.encryptedWorkspaceRoot);
  const archivePath = encryptedWorkspacePath(
    input.encryptedWorkspaceRoot,
    input.workspaceReference,
  );
  const temporaryPath = `${archivePath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporaryPath, envelope, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  try {
    await rename(temporaryPath, archivePath);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await rm(archivePath, { force: true });
    await rename(temporaryPath, archivePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  if (process.platform !== "win32") await chmod(archivePath, 0o600);
}

export function getManagerTerminalExecutionStatus() {
  const configuration = executionConfiguration();
  const encryption = getManagerConnectionCryptoStatus();
  return {
    enabled: configuration.enabled,
    backend: "docker" as const,
    image: configuration.image,
    network: configuration.networkMode,
    hostNetwork: false as const,
    hostFilesystemMounted: false as const,
    readOnlyRootFilesystem: true as const,
    plaintextWorkspacePersistent: false as const,
    activeWorkspaceStorage: "container-tmpfs" as const,
    encryptedWorkspaceSnapshots: {
      enabled: true as const,
      primitive: encryption.primitive,
      envelopeVersion: encryption.writeVersion,
      developmentFallback: encryption.developmentFallback,
      maximumArchiveBytes: MAX_WORKSPACE_ARCHIVE_BYTES,
    },
    resourceLimits: {
      memory: configuration.memory,
      cpus: configuration.cpus,
      pids: configuration.pids,
      commandTimeoutMs: configuration.timeoutMs,
      outputBytes: MAX_OUTPUT_BYTES,
    },
  };
}

async function ensureSandbox(input: {
  accessId: string;
  workspaceKey: string;
}) {
  const configuration = executionConfiguration();
  if (!configuration.enabled) {
    throw new ManagerTerminalExecutionUnavailableError(
      "Isolated terminal execution is not enabled on this deployment",
    );
  }
  const accessReference = stableReference(input.accessId);
  const workspaceReference = stableReference(input.workspaceKey);
  const containerName = stableRuntimeName(
    "uf-terminal",
    `${input.accessId}:${input.workspaceKey}`,
  );
  let inspection;
  try {
    inspection = await runDocker(["inspect", containerName], {
      timeoutMs: 5_000,
    });
  } catch (error) {
    throw new ManagerTerminalExecutionUnavailableError(
      `The isolated container runtime is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (inspection.exitCode === 0) return containerName;

  const started = await runDocker(
    [
      "run",
      "--detach",
      "--pull",
      "never",
      "--name",
      containerName,
      "--label",
      "com.umbraviaforge.manager-terminal=true",
      "--label",
      `${ACCESS_LABEL}=${accessReference}`,
      "--label",
      `${WORKSPACE_LABEL}=${workspaceReference}`,
      "--network",
      configuration.networkMode,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      String(configuration.pids),
      "--memory",
      configuration.memory,
      "--cpus",
      configuration.cpus,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--tmpfs",
      "/run:rw,noexec,nosuid,nodev,size=16m",
      "--tmpfs",
      `/workspace:rw,exec,nosuid,nodev,size=${MAX_WORKSPACE_ARCHIVE_BYTES * 2}`,
      "--workdir",
      "/workspace",
      configuration.image,
      "tail",
      "-f",
      "/dev/null",
    ],
    { timeoutMs: 30_000 },
  );
  if (started.exitCode !== 0) {
    throw new ManagerTerminalExecutionUnavailableError(
      `The isolated terminal could not start: ${started.stderr.trim() || "container runtime rejected the request"}`,
    );
  }
  try {
    await restoreEncryptedWorkspace({
      containerName,
      workspaceReference,
      encryptedWorkspaceRoot: configuration.encryptedWorkspaceRoot,
    });
  } catch (error) {
    await runDocker(["rm", "--force", containerName], { timeoutMs: 10_000 });
    throw error;
  }
  return containerName;
}

export async function executeIsolatedManagerTerminalCommand(
  input: ManagerTerminalExecutionRequest,
): Promise<ManagerTerminalExecutionResult> {
  const configuration = executionConfiguration();
  const command = translateManagerTerminalCommand(
    validateCommand(input.command),
  );
  const containerName = await ensureSandbox(input);
  const timeoutMs = Math.min(
    input.timeoutMs ?? configuration.timeoutMs,
    MAX_TIMEOUT_MS,
  );
  const result = await runDocker(
    [
      "exec",
      "--user",
      "10001:10001",
      "--workdir",
      "/workspace",
      containerName,
      "/bin/bash",
      "-lc",
      command,
    ],
    { timeoutMs },
  );
  return {
    backend: "docker",
    containerName,
    command,
    ...result,
  };
}

export async function destroyManagerTerminalSandbox(accessId: string) {
  const configuration = executionConfiguration();
  if (!configuration.enabled) return false;
  const accessReference = stableReference(accessId);
  try {
    const listed = await runDocker(
      [
        "ps",
        "--all",
        "--filter",
        `label=${ACCESS_LABEL}=${accessReference}`,
        "--format",
        "{{.Names}}",
      ],
      { timeoutMs: 10_000 },
    );
    if (listed.exitCode !== 0) return false;
    const containerNames = listed.stdout.split(/\r?\n/).filter(Boolean);
    let persisted = true;
    for (const containerName of containerNames) {
      const inspected = await runDocker(
        [
          "inspect",
          "--format",
          `{{ index .Config.Labels "${WORKSPACE_LABEL}" }}`,
          containerName,
        ],
        { timeoutMs: 5_000 },
      );
      const workspaceReference = inspected.stdout.trim();
      try {
        if (
          inspected.exitCode !== 0 ||
          !/^[a-f0-9]{64}$/.test(workspaceReference)
        ) {
          throw new ManagerTerminalExecutionUnavailableError(
            "The terminal workspace identity is unavailable",
          );
        }
        await persistEncryptedWorkspace({
          containerName,
          workspaceReference,
          encryptedWorkspaceRoot: configuration.encryptedWorkspaceRoot,
        });
      } catch {
        persisted = false;
      }
      const removed = await runDocker(["rm", "--force", containerName], {
        timeoutMs: 10_000,
      });
      if (removed.exitCode !== 0) persisted = false;
    }
    if (!persisted) {
      throw new ManagerTerminalExecutionUnavailableError(
        "The terminal closed securely, but one or more encrypted workspaces could not be preserved",
      );
    }
    return containerNames.length > 0;
  } catch {
    return false;
  }
}
