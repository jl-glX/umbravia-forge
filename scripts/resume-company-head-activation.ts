import "dotenv/config";
import { closeDatabase, db, initializeDatabase } from "../server/db/client.js";
import { canRequestCompanyHeadBootstrap } from "../server/services/company-bootstrap.js";
import { resumeDesignatedCompanyHeadActivation } from "../server/services/umf-support.js";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function normalizedEmail(value: string | null, name: string): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must contain a valid email address`);
  }
  return email;
}

const email = normalizedEmail(argument("--email"), "--email");
const confirmation = normalizedEmail(
  argument("--confirm-email"),
  "--confirm-email",
);
const apply = process.argv.includes("--apply");

if (email !== confirmation) {
  throw new Error("--email and --confirm-email must match exactly");
}

await initializeDatabase();

try {
  const request = await db
    .selectFrom("umfSupportAccessRequests")
    .select(["status", "requestedRole", "activationKind"])
    .where("email", "=", email)
    .where("status", "in", ["pending", "approved"])
    .orderBy("updatedAt", "desc")
    .executeTakeFirst();
  const designated = await canRequestCompanyHeadBootstrap(email);
  const plan = {
    status: apply ? "applying" : "dry_run",
    designated,
    roleRequestStatus: request?.status ?? null,
    requestedRole: request?.requestedRole ?? null,
    activationKind: request?.activationKind ?? null,
  };
  if (!designated || !request) {
    throw new Error(
      "No resumable designated company head request is available",
    );
  }

  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const result = await resumeDesignatedCompanyHeadActivation(email);
    console.log(
      JSON.stringify(
        {
          ...plan,
          status: "applied",
          delivery: result.delivered ? "sent" : "queued",
          expiresAt: new Date(result.expiresAt).toISOString(),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await closeDatabase();
}
