# CLAUDE.md

## Instruction Entry Point

This file is intentionally small. It is an adapter for Claude Code, not a second policy source.

1. Read the repository root [`AGENTS.md`](./AGENTS.md) completely before planning, editing, testing, or reviewing.
2. Search for and apply the most specific descendant `AGENTS.md` for each file you touch.
3. Read [`README.md`](./README.md) and relevant files in `docs/` when the task concerns user-visible behavior.
4. Treat `AGENTS.md` as authoritative if any wording here appears incomplete or inconsistent.

## Claude-Specific Operating Notes

- Start by inspecting the current diff; preserve unrelated user changes.
- Use the commands and verification sequence defined in `AGENTS.md`.
- Keep explanations and changes scoped to the requested task. Do not create a parallel instruction system in this file.
- Before handoff, report tests run, tests not run, and any remaining uncertainty.
