import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { argon2id, hash, verify } from "argon2";

const options = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

const weakLaboratoryPassword = "LaboratoryOnlyPassword123";
const strongLaboratoryPassword = `${randomBytes(24).toString("base64url")}Aa1`;
const candidates = [
  "Password123456",
  "UmbraviaForge2026",
  "SummerTraining123",
  "Administrator123",
  "GymPassword123",
  weakLaboratoryPassword,
];

const hashStartedAt = performance.now();
const weakLaboratoryHash = await hash(weakLaboratoryPassword, options);
const hashDurationMs = performance.now() - hashStartedAt;

const comparisonStartedAt = performance.now();
let matchedAt = -1;
for (const [index, candidate] of candidates.entries()) {
  if (await verify(weakLaboratoryHash, candidate)) {
    matchedAt = index;
    break;
  }
}
const comparisonDurationMs = performance.now() - comparisonStartedAt;
const attempts = matchedAt + 1;

const strongHash = await hash(strongLaboratoryPassword, options);
const strongComparisonStartedAt = performance.now();
let strongMatched = false;
for (const candidate of candidates) {
  if (await verify(strongHash, candidate)) {
    strongMatched = true;
    break;
  }
}
const strongComparisonDurationMs =
  performance.now() - strongComparisonStartedAt;

const firstDistinctPassword = `Aa1${"x".repeat(69)}ONE`;
const secondDistinctPassword = `Aa1${"x".repeat(69)}TWO`;
const distinctHash = await hash(firstDistinctPassword, options);
const argon2WouldAliasDistinctInputs = await verify(
  distinctHash,
  secondDistinctPassword,
);

console.log(
  JSON.stringify(
    {
      scope: "self-generated laboratory credential",
      algorithm: "Argon2id",
      parameters: {
        memoryKiB: options.memoryCost,
        iterations: options.timeCost,
        parallelism: options.parallelism,
      },
      hashDurationMs: Math.round(hashDurationMs),
      dictionaryAttempts: attempts,
      comparisonDurationMs: Math.round(comparisonDurationMs),
      comparisonsPerSecond: Number(
        ((attempts * 1000) / comparisonDurationMs).toFixed(2),
      ),
      weakPasswordMatched: matchedAt >= 0,
      randomStrongPasswordDictionaryAttempts: candidates.length,
      randomStrongPasswordComparisonDurationMs: Math.round(
        strongComparisonDurationMs,
      ),
      randomStrongPasswordMatched: strongMatched,
      argon2WouldAliasDistinctInputs,
      applicationPolicy: "Inputs longer than 1024 UTF-8 bytes are rejected",
      note: "Only synthetic credentials generated for this local run were tested.",
    },
    null,
    2,
  ),
);
