# Dependency update policy

Umbravia Forge keeps direct dependencies pinned to exact versions. The root
application and the independent `cloudflare/` Worker project each use their
own committed lockfile and `.npmrc` as the reproducible source for
installations; the second project is not an npm workspace and must never be
inferred from the root installation.

## Supported toolchain

- Node.js 24 LTS (24.15.0 or newer in the 24.x line)
- npm 11.18.0 or newer in the 11.x line. This is the first supported toolchain
  for the pinned `allowScripts` policy enforced by this repository.
- TypeScript 7.0.x as the native project compiler
- TypeScript 6.0.x only as the temporary programmatic API consumed by
  `typescript-eslint`
- Node 24 type definitions aligned with the supported runtime

The dual TypeScript installation follows the upstream TypeScript 7 migration
guidance. Remove the TypeScript 6 alias when the native compiler exposes the
programmatic API required by lint tooling and the complete validation sequence
still passes.

## Safe update workflow

1. Start from a clean branch and keep `package.json` plus `package-lock.json`
   together in the same change.
2. Update a coherent dependency group without using peer-dependency bypasses.
3. Run `npm run CI`. This performs clean locked installations for the root and
   `cloudflare/`, all project checks and a vulnerability audit of both trees.
4. Review the resulting diff and application behavior before merging.

`npm run CI --force` is also safe: the runner deliberately removes npm's force
flag from its child processes. It never rewrites dependency declarations or
either lockfile, and it fails if any of the four protected manifests/lockfiles
changes during validation.

Do not use `npm audit fix --force` as an update strategy. Major upgrades are
reviewed independently. Dependabot groups compatible minor and patch updates;
major releases remain isolated for explicit migration and testing.

Dependabot monitors `/` and `/cloudflare` independently. CI installs both
lockfiles without deploying Workers or reading provider credentials. The audit
gate accepts only an npm audit v2 payload with complete metadata. Every `via`
entry must be a valid advisory URL or a named vulnerable parent. A derived
exception is accepted only when that parent is present in the same report and
has already matched its own exact advisory, package version and exception.
Transport/registry errors, invalid JSON, missing metadata, malformed `via`
objects, orphaned dependency chains and unexpected report versions fail closed
for either tree.

Rollback of this control consists of reverting the Dependabot entry, the
Cloudflare install step and the paired audit project in the same change. Do not
remove only the failing audit: restore the previous commit while investigating
registry availability or lockfile compatibility, and do not deploy from a
partially validated dependency tree.

## GitHub Dependency Review

The pull-request workflow runs GitHub Dependency Review when the repository is
public. GitHub requires Advanced Security to provide that service for a private
repository, so the job records the limitation instead of failing when the
repository is private. This does not replace the project gate: `validate`
continues to run the pinned lockfile checks and `npm run audit:ci` for every
pull request.

## Temporary React Router advisory

React Router 7.18.2 is the safest currently verified release for this client,
but npm reports `GHSA-qwww-vcr4-c8h2` for its optional React Server Components
action mode. Umbravia Forge uses declarative client-side `BrowserRouter` routing
and does not enable the affected RSC mode.

Older releases are not an acceptable workaround: the npm advisory database
reports multiple XSS, open-redirect, RCE and denial-of-service ranges below
7.18. The audit runner therefore permits only the RSC advisory, only through
the exact `react-router` and `react-router-dom` 7.18.2 dependency chain. Any
other advisory, package or version fails CI.
