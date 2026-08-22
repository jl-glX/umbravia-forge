import "dotenv/config";
import { closeDatabase, initializeDatabase } from "../server/db/client.js";
import {
  applyCompanyHeadDesignation,
  planCompanyHeadDesignation,
} from "../server/services/company-head-designation.js";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function required(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (
  process.env.DATABASE_PROVIDER !== "postgresql" ||
  !process.env.DATABASE_URL
) {
  throw new Error(
    "This designation requires the explicit PostgreSQL production environment",
  );
}

const email = required("--email");
const confirmedEmail = required("--confirm-email");
const apply = process.argv.includes("--apply");
if (email.trim().toLowerCase() !== confirmedEmail.trim().toLowerCase()) {
  throw new Error("Corporate email confirmation does not match");
}

await initializeDatabase();
try {
  const plan = apply
    ? await applyCompanyHeadDesignation(email)
    : await planCompanyHeadDesignation(email);
  console.log(
    JSON.stringify({ mode: apply ? "applied" : "dry_run", ...plan }, null, 2),
  );
} finally {
  await closeDatabase();
}
