# Dependency update policy

Umbravia Forge keeps direct dependencies pinned to exact versions and uses the
committed lockfile as the reproducible source for installations.

## Supported toolchain

- Node.js 24 LTS (24.15.0 or newer in the 24.x line)
- npm 11.18.0 or newer in the 11.x line. This is the first supported toolchain
  for the pinned `allowScripts` policy enforced by this repository.
- TypeScript 7.0.x as the native project compiler
- TypeScript 6.0.x only as the temporary programmatic API consumed by
  `typescript-eslint`
- Node 26 type definitions aligned with the supported runtime

The dual TypeScript installation follows the upstream TypeScript 7 migration
guidance. Remove the TypeScript 6 alias when the native compiler exposes the
programmatic API required by lint tooling and the complete validation sequence
still passes.

## Safe update workflow

1. Start from a clean branch and keep `package.json` plus `package-lock.json`
   together in the same change.
2. Update a coherent dependency group without using peer-dependency bypasses.
3. Run `npm run CI`. This performs a clean locked installation, all project
   checks and a vulnerability audit.
4. Review the resulting diff and application behavior before merging.

`npm run CI --force` is also safe: the runner deliberately removes npm's force
flag from its child processes. It never rewrites dependency declarations or
the lockfile, and it fails if either protected file changes during validation.

Do not use `npm audit fix --force` as an update strategy. Major upgrades are
reviewed independently. Dependabot groups compatible minor and patch updates;
major releases remain isolated for explicit migration and testing.

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
