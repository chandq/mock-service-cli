# AGENTS.md

## Scope And Precedence

This is the canonical repository instruction file. Read it before planning or editing. A more specific `AGENTS.md` in a descendant directory overrides this file for that subtree. `CLAUDE.md` is an adapter only; it must not redefine these rules.

## Project Facts

`mock-service-cli` is a JavaScript CommonJS CLI for local development, requiring Node.js `>=18`. It provides mock APIs, static/SPA servers, HTTP proxying, an API overview page, and a file explorer with optional editing and archive operations.

The tool is cross-platform and must support Windows, Linux, and macOS. Path separators/casing, hidden-file attributes, process signals, browser launching, filesystem behavior, and network interfaces must be handled through platform-aware adapters rather than POSIX-only assumptions.

Source of truth is `src/` and `scripts/`; `dist/`, `coverage/`, and `release/` are generated outputs. Do not hand-edit generated output.

Repository map:

- `src/bin/`: CLI entry point and argument/environment preparation.
- `src/lib/mockServer.js`: mock routes, web server, proxy, and socket server.
- `src/lib/staticServer.js`: static config, mounts, SPA fallback, proxy, and live reload.
- `src/lib/fileExplorerServer.js`: explorer API/UI, authentication, editing, and uploads.
- `src/lib/archiveService.js`, `archiveProvider.js`, `archiveProviders/`: archive jobs and edition capabilities.
- `src/lib/utils.js`: logging, host binding, URL, and allowlist helpers.
- `src/runtime.js`: lazy loader used by bundled modules.
- `test/`: Tap tests; `cli-entry.test.js` is the entrypoint smoke test.
- `docs/`: user-facing configuration and migration docs.

## Development Workflow

Before editing:

1. Read the relevant source, neighboring tests, README/docs, and current `git diff`.
2. Identify affected contracts: CLI flags, HTTP behavior, filesystem boundaries, or edition packaging.
3. Preserve unrelated user changes.

After editing:

1. Add focused tests for changed behavior, errors, and security-sensitive paths.
2. Run the narrowest relevant test, then lint and broader tests as practical.
3. Inspect `git diff`; leave only intentional source, test, script, or documentation changes.

Standard commands:

```bash
npm ci
npm run build                  # light edition
npm run build:light
npm run build:ultra
npm test                       # unit tests with coverage
npm run test:src               # CLI smoke test
npm run lint                   # ESLint, max warnings 0
npm run verify:packages
```

`npm test` invokes `scripts/run-tests.js unit`, which builds first and excludes `test/cli-entry.test.js`. The smoke suite can also be run with `node scripts/run-tests.js smoke`.

## Code Rules

- Keep CommonJS (`require`/`module.exports`) and JavaScript; do not add TypeScript or a new framework for a local change.
- Follow `eslint.config.cjs`: two spaces, semicolons, single quotes, existing naming/style, and no unused variables.
- Prefer existing dependencies and Node APIs. Keep exported APIs small and stable.
- Validate inputs at boundaries and return descriptive, contract-compatible errors.
- Avoid new synchronous filesystem work in hot request paths unless the local module already requires it.
- Keep comments short and explain only non-obvious invariants or security decisions.
- Use existing HTML/static-asset patterns for browser changes.
- Put platform-specific behavior behind shared, testable adapters and provide conservative fallbacks when a platform API is unavailable.

## Edition Boundary

`npm run build:light` and `npm run build:ultra` select one archive provider through `scripts/build.js`:

- `light`: ZIP/TAR.GZ creation; ZIP/TAR/TAR.GZ inspection and extraction.
- `ultra`: adds RAR, 7z, gzip, bzip2, and xz inspection/extraction.

Archive changes must be verified against both editions. Keep ultra-only imports and dependencies behind the provider/build boundary; the light package must not retain them.

## Security And Compatibility

- Keep servers bound to localhost by default. Do not weaken `--host` or its IP/CIDR allowlist.
- Keep explorer editing opt-in (`--edit`) and authentication applied to page loads and API requests.
- Treat filesystem paths, archive entries, proxy targets, headers, and config values as untrusted. Preserve traversal/symlink checks, archive entry/size/ratio limits, destination-conflict checks, and safe temporary extraction.
- Never log passwords, tokens, request bodies, or other sensitive values.
- Preserve CLI flags/defaults, public URLs, HTTP status semantics, and package separation unless the contract is intentionally changed and documented.
- Proxy/rewrite changes require coverage for prefix boundaries, query strings, HTTPS targets, and request/response headers.

## Tests And Documentation

Use Tap and neighboring helpers. Prefer temporary directories and ephemeral ports; close servers and remove temporary files. Update `README.md` or `docs/` when changing flags, config schema, defaults, security behavior, supported formats, or endpoints.

## Git And Release Rules

- Use Conventional Commits (`type(scope): subject`); see `gitmessage.md`.
- Do not commit `node_modules`, `coverage`, `dist`, `release`, local env files, or incidental generated output.
- Never run release/publish commands during routine implementation or testing.
- Never amend, reset, or discard user changes.
- Never hand-edit the version in `package.json` or generated `CHANGELOG.md`; release tooling owns them.
- Changes pushed to `master` under `src/`, `bin/`, `scripts/`, `package.json`, or `package-lock.json` can trigger the automated release workflow. Treat publishing and tag creation as maintainer/CI operations.
- Package-manager synchronization is a separate release workflow; do not modify external Homebrew/Scoop repositories from routine work.
- Review `CONTRIBUTING.md` and `SECURITY.md` for community or vulnerability-reporting workflows when relevant.

## Definition Of Done

- Source change is at the correct module boundary.
- Focused success/failure/security tests exist and pass.
- Relevant test commands and `npm run lint` pass, or limitations are reported.
- User-facing documentation is current.
- Final diff contains only intentional changes.
