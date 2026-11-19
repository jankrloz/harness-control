# CLI & TUI Reference

`harness-control` communicates with the local background daemon (`127.0.0.1:4318`) and auto-starts it when needed.

## Global Command

```bash
harness-control [command] [options]
```

## Commands

| Command                         | Description                                                                        | Key Options                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| `tui`                           | Launch interactive 7-module TermUI dashboard (default when no args)                | —                                                 |
| `list`                          | List discovered skills with manager, scope, tokens, drift, broken status           | `--harness <id>`, `--broken`, `--drift`, `--json` |
| `tokens`                        | Show global & project token usage breakdown by harness and source                  | `--json`                                          |
| `sources`                       | Show catalog sources, deprecated skills, and available updates                     | `--json`                                          |
| `cleanup`                       | Analyze duplicates, drift, unused, untracked, broken, and outdated skills          | `--only <categories>`, `-y, --yes`                |
| `upgrade [skillId]`             | Preview and execute manager-CLI upgrades (`apm`, `npx-skills`, `claude`, `gemini`) | `--all`, `--author <source>`, `-y, --yes`         |
| `remove <skillId>`              | Preview and execute manager-CLI removal (dry-run by default)                       | `-y, --yes`                                       |
| `migrate-apm <skillIds...>`     | Migrate skills to declarative APM (`apm.yml`)                                      | `--cleanup`, `-y, --yes`                          |
| `repair-link <broken> <target>` | Re-point a dangling symlink to a valid target directory                            | `-y, --yes`                                       |
| `serve`                         | Run the Core HTTP Daemon in the foreground                                         | `--port <port>`                                   |

## Examples

### Dry-run cleanup for duplicates & unused skills

```bash
harness-control cleanup --only duplicates,unused
```

### Execute cleanup via manager CLIs

```bash
harness-control cleanup --only duplicates -y
```

### Inspect token usage & heaviest projects

```bash
harness-control tokens
```

### Upgrade all skills from a specific source

```bash
harness-control upgrade --author jankrloz -y
```

## Interactive TUI Shortcuts

- `1`–`7` / `Tab`: Switch modules (`Overview`, `Skills`, `Tokens`, `Projects`, `Sources`, `Daemon`, `Cleanup`)
- `j` / `k` or `↑` / `↓`: Navigate rows
- `Space` (Cleanup): Toggle item in queue
- `a` / `s` (Cleanup): Cycle action (`remove`, `migrate-to-apm`, `upgrade`, `skip`) and scope (`all`, `global`, `project`)
- `x`: Preview & confirm action / cleanup queue
- `r`: Trigger fresh rescan
- `q`: Quit
