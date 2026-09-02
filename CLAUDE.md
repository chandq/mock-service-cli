# CLAUDE.md

The authoritative orientation for working in this repo is **[AGENTS.md](AGENTS.md)** — read it first. It covers the architecture invariants, commands, and commit/release rules that matter for any edit here.

Quick reminders:

- Conventional commits only (`gitmessage.md`): `<type>(<scope>): <subject>`.
- Never hand-bump `package.json` version or edit `CHANGELOG.md` — `standard-version` owns them.
- Pushing to `master` under `src/**`/`bin/**`/`scripts/**`/`package.json`/`package-lock.json` auto-triggers a release; keep pure-doc changes under `.github/`, `docs/`, or root `.md` files.
- Run `npm run lint` and `npm test` before finishing any change.
- Human-facing contribution docs: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md).
