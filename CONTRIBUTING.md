# Contributing to mock-service-cli

First off, thanks for taking the time to contribute! 🦅

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). All interactions are expected to be respectful and constructive.

## Quick links

- [README.md](README.md) — full user documentation and CLI reference
- [gitmessage.md](gitmessage.md) — commit message rules
- [SECURITY.md](SECURITY.md) — how to report a vulnerability privately
- [AGENTS.md](AGENTS.md) — codebase orientation (also consumed by AI tools)
- [docs/](docs/) — migration guides, npm README, static-server config example

## Project at a glance

`mock-service-cli` is a Node.js (CommonJS) CLI providing a local **Mock / Static / SPA server, HTTP proxy, API overview page, and File explorer**. It is distributed as two npm editions that share one command:

- `mock-service-cli` (light)
- `mock-service-cli-ultra` (adds RAR/7z/bzip2/xz archive support)

The CLI is bundled with esbuild into `dist/`; runtime dependencies (archiver, chokidar, multer, nodemon, ua-parser-js, …) are installed by npm and stay outside the bundle. Node `>= 18` is required.

## Development setup

Requirements: Node.js `>= 18` and npm.

```bash
git clone https://github.com/chandq/mock-service-cli.git
cd mock-service-cli
npm ci
```

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint over `src`, `scripts`, `test` — zero warnings allowed |
| `npm run fix` | ESLint auto-fix |
| `npm test` | Unit tests (Tap, `test/*.test.js`); builds first |
| `npm run test:src` | Boots the real CLI (smoke test from source) |
| `npm run start:src` | Run the CLI from source |
| `npm run build` | Rebuild the esbuild bundle into `dist/` |
| `npm run package:editions` | Build `release/light` and `release/ultra` npm packages |

### Everyday loop

```bash
git checkout -b your-branch
# …make changes, add/adjust tests in test/*.test.js…
npm run lint
npm test
npm run test:src
```

Try the CLI locally, e.g.:

```bash
npm run start:src -- --help
npm run start:src -- -p 8090 -d ./mock
```

## Where things live

| Area | Path |
| --- | --- |
| CLI argument parsing, help, `--version` | `src/bin/mock-service-cli` |
| Server logic (mock, static, SPA, file explorer, archives) | `src/lib/*.js` |
| Web UIs (API overview, file explorer) | `src/lib/*.html`, `src/lib/*.svg` |
| Build/package/publish/test tooling | `scripts/*.js` |
| Unit tests | `test/*.test.js` |

The API overview / file explorer pages are generated at runtime from templates in `src/lib/`; when you change UI behavior, update the corresponding template and the favicon assets if needed.

## Conventions

### Code style

- ESLint (flat config `eslint.config.cjs`) with `--max-warnings=0`; Prettier for formatting (`.prettierrc.js`); commit hooks run lint/staged formatting via Husky + lint-staged.
- Match the surrounding code's style and comment language (the codebase uses English identifiers, with Chinese user-facing comments/docs where present).

### Mock-file format

Mock files and handlers are **CommonJS only** — ES modules are not supported. See README "编写 Mock 文件" for the module shape and route syntax.

### Tests

- Tap-based; unit tests live in `test/*.test.js`.
- A code change should come with (or update) tests; a behavior change to the CLI should also pass `npm run test:src`.

### Commit messages

Follow [gitmessage.md](gitmessage.md) — conventional commits:

```text
<type>(<scope>): <subject>          # type: feat|fix|docs|style|refactor|test|chore
                                    # subject: verb first, ~50 chars

<body>                              # 72-char wrap; why, how, side effects
```

Example:

```text
fix(proxy): keep original query string after rewrite

URL rewrites dropped query parameters when only the path prefix
matched. Preserve the query string so proxied requests behave
identically before and after rewrite.
```

### Versioning and releases (important)

- **Merging to `master` auto-releases**: a push touching `src/`, `bin/`, `scripts/`, `package.json`, or `package-lock.json` triggers the `release` workflow, which runs `standard-version` (bumps version + tag + changelog), creates a GitHub Release, and publishes both npm editions with provenance.
- **Never hand-edit** `package.json`'s `version` or `CHANGELOG.md` — release tooling owns them.
- The commit **type drives the next version**: `feat` → minor, `fix` → patch. Choose PR titles/commit types accordingly.
- Homebrew and Scoop manifests are synced **after** a successful release by the `sync-package-managers` workflow (automatic, or manually re-runnable); Nix derives its version from `package.json` at evaluation, so no per-release update is needed there.

## Adding a feature or CLI flag (checklist)

1. Add the option parsing in `src/bin/mock-service-cli` and document it in the README option table.
2. Implement the behavior in the relevant `src/lib/` module.
3. Add/adjust tests in `test/`.
4. Run `npm run lint`, `npm test`, `npm run test:src`.
5. Update user docs (README / `docs/`) if the change is user-visible.
6. Commit with a conventional message.

## Reporting bugs / requesting features

Use the issue templates: **Bug report** and **Feature request** (GitHub shows them when you open a new issue). Include the CLI version and edition (`mock-service-cli --version`), OS/Node version, and a minimal reproduction. Security issues must **not** be filed as public issues — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the project's [MIT](LICENSE) license.
