# Architecture: `harness-control`

## Principles

- **Wrapper, Not a Replacement:** Zero proprietary lockfiles or package stores. All mutations delegate to owning managers (`apm`, `npx skills`, `claude`, `gemini`, `git`) or explicit user-confirmed path operations.
- **Single Core, Multiple Interfaces:** `@harness-control/core` implements discovery, provenance, topology, BPE token telemetry, and dry-run action planning. `@harness-control/server` exposes the core over a local HTTP daemon (`127.0.0.1:4318`). Both `@harness-control/cli` (Commander + TermUI) and `apps/web` (Vite + React, also packaged in Tauri v2) consume the same daemon API.
- **Future-Primitive Ready:** `PrimitiveKind` (`skill | mcp | hook | command | lsp | prompt`) is a first-class domain axis; Phase 1 implements `skill`.

## Layers (`packages/core`)

- `domain/`: Pure TypeScript types and invariants with zero runtime dependencies.
- `application/`: Use cases (`InventoryService`, `ActionService`, `computeGlobalTelemetry`) and port interfaces.
- `infrastructure/`: Adapters (`FsSkillScanner`, `NativeCliAdapter`, `GitInspector`, `TiktokenCounter`, `ShellExecutor`, `ConfigStore`, `harness-registry`).
