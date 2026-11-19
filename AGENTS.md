# AGENTS.md — harness-control

## Overview

Unified AI coding harness visibility, token telemetry, drift/duplicate diagnostics, and manager-delegated skill lifecycle control plane (`packages/core`, `packages/server`, `packages/cli`, `apps/web`, `apps/desktop`).

## Architecture & Boundaries

- `packages/core`: Pure hexagonal architecture (`domain` -> `application` -> `infrastructure`).
  - `domain/` has zero I/O or framework imports.
  - `application/` (`InventoryService`, `ActionService`, `CleanupService`, `SourceCatalogService`, `computeGlobalTelemetry`) depends only on `domain` and `ports.ts`.
  - `infrastructure/` implements filesystem scanning (`FsSkillScanner`), native CLI discovery (`NativeCliAdapter`), git inspection (`GitInspector`), tiktoken measurement (`TiktokenCounter`), session transcript usage (`UsageLogInspector`), and shell execution (`ShellExecutor`).
- `packages/server`: Local HTTP daemon (`127.0.0.1:4318`) using Hono + Zod (`app.ts`, `daemon.ts`, `client.ts`).
- `packages/cli`: Commander CLI (`bin.ts`) and TermUI (`@termuijs/jsx`) interactive TUI (`tui.tsx`).
- `apps/web`: React + Vite dashboard UI (`src/App.tsx`, `src/styles.css`) styled with `kanon-ui` tokens.
- `apps/desktop`: Tauri v2 desktop wrapper (`src-tauri/`) bundling `apps/web/dist`.

## Non-Negotiable Rules

- **Manager-only remove & upgrade**: Always delegate `remove` and `upgrade` to package manager CLIs (`apm`, `npx skills`, `claude plugin`, `gemini extensions`). Never delete skill directories with `rm` or run `git pull` directly.
- **No `atime` usage tracking**: Filesystem `atime` is polluted by scans. Activation tracking reads `.jsonl` session transcripts (`~/.claude*/projects`, `~/.codex/sessions`, `~/.gemini/antigravity/brain`).
- **Toolchain**: Use `pnpm`, Vite+ (`vp`), and `go-task` (`Taskfile.yml`).

## Verification Commands

```bash
task build   # Build core, server, cli, web
task check   # vp check (oxfmt + oxlint) + pnpm -r typecheck
task test    # vp test run (unit + integration)
```
