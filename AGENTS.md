# AGENTS.md — project guide for AI coding agents

Orientation for working in this repository. Read this before making changes. Human contributors should also see [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

`mock-service-cli` — a Node.js **CommonJS** CLI for local development:

- Mock server (hot-reload, per-path JS handlers) · Static server · SPA server · HTTP proxy · API overview page · File explorer (read-only or `--edit`).

Two npm editions share the one `mock-service-cli` command:

| Edition | Package | Extra |
| --- | --- | --- |
| light | `mock-service-cli` | — |
| ultra | `mock-service-cli-ultra` | RAR/7z/bzip2/xz archive support |

Requires Node `>= 18`. The CLI is bundled with esbuild into `dist/`; a set of runtime dependencies stays **external** to the bundle.

## Commands

| Task | Command |
| --- | --- |
| Install deps | `npm ci` |
| Lint (flat eslint, zero warnings allowed) | `npm run lint` / `npm run fix` (auto-fix) |
| Unit tests (Tap, under `test/*.test.js`) | `npm test` |
| Smoke test of the real CLI | `npm run test:src` |
| Build bundle | `npm run build` (alias `build:light`) / `npm run build:ultra` |
| Run from source | `npm run start:src` |
| Run built CLI | `npm start` |
| Package an npm edition to `release/<edition>/` | `npm run package:light` / `package:ultra` / `package:editions` |
| Verify packaged editions | `npm run verify:packages` |
| Publish editions to npm (maintainer/CI only) | `npm run publish:editions` |

Always run `npm run lint` and `npm test` before pushing; run `npm run test:src` when behavior of the CLI changes.

## Layout

| Path | Purpose |
| --- | --- |
| `src/bin/mock-service-cli` | CLI entry: arg parsing, help, `--version` |
| `src/lib/*.js` | Servers & logic: `mockServer.js`, `staticServer.js`, `fileExplorerServer.js`, `archiveService.js`(+`archiveProviders/`), `asyncTaskQueue.js`, `manageMockFiles.js`, `packageInfo.js`, `utils.js` |
| `src/lib/*.html`, `*.svg` | Web UIs: API overview, file explorer, static server, their favicons |
| `bin/mock-service-cli` (+ `bin/mock-service-cli.cmd`) | Published shebang launcher (`.cmd` = Windows shim for Scoop) |
| `scripts/*.js` | Build/package/publish/test runners (`build.js`, `package-edition.js`, `publish-editions.js`, `publish-package-managers.js`, `run-tests.js`, `verify-packages.js`) |
| `test/*.test.js` | Tap unit tests |
| `dist/`, `release/<edition>/` | Build output — **generated, never hand-edit** |
| `docs/` | Migration guides, npm README, static-server config example, Homebrew/Scoop repo READMEs |
| `flake.nix` | Nix package (light edition; version auto-derived from `package.json`) |

## Build model — invariants code depends on

- esbuild bundles `src` → `dist` (platform `node`, format `cjs`, target `node18`).
- **Runtime deps are external, not bundled**: `archiver`, `chokidar`, `multer`, `nodemon`, `ua-parser-js` (ultra also `7zip-bin`, `node-unrar-js`). A new runtime dependency must be installable by npm for all channels (npm/Homebrew/Scoop/Nix), not just requireable at build time.
- `dist/` is emitted **one directory below `package.json`** (`src/lib/packageInfo.js` resolves `../package.json`) — never restructure the output/install layout.
- Mock files are **CommonJS only** (no ES modules) — see README "编写 Mock 文件".
- CLI options are documented in README's option table; when you add or change a flag, update that table and `docs/` where relevant.

## Tests

- Tap-based; new behavior should come with tests in `test/`.
- `npm test` builds first (`pretest`).
- The source smoke test (`run-tests.js smoke`) boots the real CLI entry.

## Commits & the release model (important)

- Commit messages follow `gitmessage.md` (conventional commits):
  `<type>(<scope>): <subject>` — types `feat|fix|docs|style|refactor|test|chore`; subject starts with a verb and stays ~50 chars; body answers why/how/side-effects, wrapped at 72.
- **Pushing to `master`** with changes under `src/**`, `bin/**`, `scripts/**`, `package.json`, or `package-lock.json` **auto-triggers `release.yml`**: `standard-version` bumps the version and tags, creates a GitHub Release, and publishes both npm editions with provenance.
- Therefore: **never hand-bump `package.json` version or edit `CHANGELOG.md`** — tooling owns them. Commit type drives the bump (`feat` → minor, `fix` → patch).
- Homebrew/Scoop manifest sync is **decoupled** from the npm publish job: `release.yml` publishes npm only; `sync-package-managers.yml` runs after a successful release (`workflow_run`) or manually, pushing formulae/manifests into `chandq/homebrew-tap` and `chandq/scoop-bucket` via `scripts/publish-package-managers.js`. Nix needs no per-release update (version read from `package.json` at eval).
- Gotcha: don't push a standalone commit touching a trigger path when `HEAD` is already the latest release tag and the change contains no `feat`/`fix` — the auto-release will fail at `gh release create <existing-tag>`. Fold such changes into the next real release, or keep them under `.github/`, `docs/`, or root `.md` files (which don't trigger release).

## Community & security

`CONTRIBUTING.md` (contribution guide) · `CODE_OF_CONDUCT.md` · `SECURITY.md` (private vulnerability reporting) · issue/PR templates in `.github/`.

## Reference

- [README.md](README.md) — full user documentation & CLI table
- [CHANGELOG.md](CHANGELOG.md) — generated by standard-version
- `docs/static-server.config.example.json` — self-contained static-server config reference
