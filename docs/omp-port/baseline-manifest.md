# OMP Port Baseline Manifest

Captured: 2026-09-20

## Fork baseline

- Repository: `https://github.com/ha5h6r000wn/omp-workbuddy-connect`
- Branch: `feat/omp-port`
- Commit: `6b91ab6753bcb8b5603859b2d9646644a4e62258`
- Package: `omp-workbuddy-connect@1.1.5`

The commit identifies the frozen repository baseline, not later working-tree content.

## Upstream baseline

- Repository: `https://github.com/icekale/pi-workbuddy-connect`
- Reference: `refs/heads/main`
- Commit observed from the remote: `cb2398e3374144db0c088d7a4887dc0913342858`

The Fork baseline is therefore not identical to the current upstream commit.

## OMP baseline

- Repository: `https://github.com/can1357/oh-my-pi`
- Release: `v18.2.6`
- Tag commit observed from the remote: `78b753124d11f8dd3ae73e2524125890ff7c977e`
- Installed packages used for contract verification:
  - `@oh-my-pi/pi-ai@18.2.6`
  - `@oh-my-pi/pi-coding-agent@18.2.6`

`package.json` and `package-lock.json` pin both OMP packages to `18.2.6`; wildcard peer constraints are not used.

## Working-tree boundary

At the start of this apply batch, `git status --short --untracked-files=all` was empty. There were no pre-existing tracked or untracked user modifications to preserve.

The first implementation batch intentionally creates an uncommitted delta relative to the frozen Fork commit:

- `extensions/workbuddy.ts`: syntax repair and removal of unsupported OMP contracts.
- `package.json`: exact OMP 18.2.6 peer/development constraints.
- `package-lock.json`: lockfile regenerated from the exact manifest constraints.
- `tsconfig.json`: checks all extension and future `src` TypeScript modules.
- `docs/omp-port/baseline-manifest.md`: this manifest.
- `docs/omp-port/api-compatibility-matrix.md`: verified host-contract matrix.
- `openspec/changes/adapt-workbuddy-international-omp/tasks.md`: completion state, updated only after verification.

This list separates the implementation workspace from commit `6b91ab6753bcb8b5603859b2d9646644a4e62258`; the commit must not be described as the complete current workspace.

## Runtime

- OS/kernel: Darwin 27.0.0, `RELEASE_ARM64_T6050`
- Architecture: arm64
- Node.js: `v26.9.0`
- npm: `11.19.1`
- TypeScript: `7.0.2`
- OMP-compatible loader runtime used for verification: Bun `1.3.14` via `npx`, because no standalone `bun` executable was installed.

## Reproduction commands

```sh
npm install --ignore-scripts
npx tsc --noEmit
node --experimental-strip-types -e "await import('./extensions/workbuddy.ts')"
npx --yes bun@1.3.14 -e "import { loadExtensions } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/index'; const result = await loadExtensions(['./extensions/workbuddy.ts'], process.cwd()); console.log(JSON.stringify({ extensions: result.extensions.length, errors: result.errors, providers: result.runtime.pendingProviderRegistrations.map(({ name }) => name) })); if (result.errors.length || result.extensions.length !== 1) process.exit(1);"
```

Expected loader result:

```json
{"extensions":1,"errors":[],"providers":["workbuddy"]}
```
