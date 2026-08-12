import { spawnSync } from "node:child_process";
import { resolveNpmInvocation } from "./lib/npm-invocation.mjs";

const scriptNames = process.argv.slice(2);
if (scriptNames.length === 0) {
  throw new Error("At least one project script is required");
}

for (const scriptName of scriptNames) {
  if (!/^[a-z][a-z0-9:-]*$/u.test(scriptName)) {
    throw new Error(`Invalid project script name: ${scriptName}`);
  }
  const invocation = resolveNpmInvocation(["run", scriptName], process.env);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
