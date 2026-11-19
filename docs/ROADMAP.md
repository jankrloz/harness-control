# Roadmap & Product Backlog

## Phase 1 — Skills Control Plane _(Shipped)_

- [x] 18-harness + multi-profile (`~/.claude`, `~/.claude-*`) skill discovery
- [x] `tiktoken` (`cl100k_base`) token budgets (`description`, `frontmatter`, `body`, `full`) across global & project scopes
- [x] Session transcript activation tracking (`.jsonl`, zero `atime` pollution)
- [x] Drift (`global-project-overlap`, `content-divergence`, `multiple-copies`, `multiple-managers`, `duplicate-source`, relative age) & duplicate detection
- [x] Manager-only CLI execution (`apm`, `npx skills`, `claude plugin`, `gemini extensions`) with dry-run & scope selector
- [x] Full-page Cleanup Planner (Web, TUI `[7] Cleanup`, CLI `cleanup`)
- [x] Discover & Install (`skills.sh` + `npx skills find`)

---

## Phase 2 — Unified Primitives Matrix

- [ ] **MCP Servers**: Cross-harness toggle matrix, connectivity check, import from apps, drift/duplicate checks
- [ ] **Prompts, Hooks, Commands, LSPs**: Unified discovery, token measurement, and manager-delegated lifecycle

---

## Phase 3 — Unified Sessions Explorer

- [ ] Cross-harness session index (`Claude Code`, `Claude Desktop`, `Codex`, `Gemini CLI`, `Antigravity`, `OpenCode`, `OpenClaw`, `Hermes`, `Pi`, `Cursor`)
- [ ] Group `By time` (`Today`, `This week`, `Earlier`) and `By project`
- [ ] Full-text search across session titles, workspace folders, first/last messages, and session IDs
- [ ] Session inspection, transcript preview, and quick resume

---

## Phase 4 — Harness Profiles, Accounts, Routing & Aggregation

- [ ] **Profiles & Accounts**: Manage multiple config directories/accounts per harness (`~/.claude`, `~/.claude-*`, `Codex`, `Antigravity`, `GitHub Copilot`, `xAI`, `Kimi`, `DeepSeek`)
- [ ] **Provider Quotas**: Live 5-hour / weekly / model quota bars per account
- [ ] **Routing & Aggregation**: Local provider routing, fallback rules, model aliasing, and multi-provider aggregation across harnesses

---

## Phase 5 — Usage, Cost & Request Telemetry Dashboard

- [ ] Summary metrics: `Total Cost`, `Total Requests`, `Tokens Processed`, `Cache Hit Rate`
- [ ] Hourly / daily token & spend bar charts filterable by harness and provider/model
- [ ] Tabbed drill-down: `Request Logs` (`Cost`, `Fresh Input`, `Output`, `Cache Hit`, `Speed tok/s`, `TTFT`), `Providers`, and `Models`

---

## Phase 6 — Native Menu Bar & Desktop Widgets (CodexBar-style)

- [ ] Tauri v2 system tray / macOS menu bar popover with live quota gauges and active session spend
- [ ] Desktop widgets for token burn rate, remaining 5-hour/weekly quotas, and one-click profile switching
- [ ] Quick actions from tray: trigger rescan, open Cleanup, or switch active harness profile
