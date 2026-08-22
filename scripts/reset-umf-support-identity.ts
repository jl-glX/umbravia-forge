import "dotenv/config";
import { closeDatabase, initializeDatabase } from "../server/db/client.js";
import {
  applyUmfSupportIdentityReset,
  planUmfSupportIdentityReset,
} from "../server/services/umf-support-identity-reset.js";

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
    "This operational reset requires the explicit PostgreSQL production environment",
  );
}

const corporateEmail = required("--corporate-email");
const confirmedCorporateEmail = required("--confirm-corporate-email");
const legacyCommercialEmail =
  argument("--legacy-commercial-email") ?? undefined;
const confirmedLegacyCommercialEmail =
  argument("--confirm-legacy-commercial-email") ?? undefined;
const apply = process.argv.includes("--apply");

if (corporateEmail !== confirmedCorporateEmail) {
  throw new Error("Corporate email confirmation does not match");
}
if (legacyCommercialEmail !== confirmedLegacyCommercialEmail) {
  throw new Error("Legacy commercial email confirmation does not match");
}

await initializeDatabase();
try {
  const input = { corporateEmail, legacyCommercialEmail };
  const plan = apply
    ? await applyUmfSupportIdentityReset(input)
    : await planUmfSupportIdentityReset(input);
  console.log(
    JSON.stringify(
      {
        mode: apply ? "applied" : "dry_run",
        commercialAccountDeleted: false,
        ...plan,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase();
}
