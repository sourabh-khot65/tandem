# InTandem

Real-time multi-agent collaboration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

InTandem connects up to 5 Claude Code sessions into a shared workspace with end-to-end encrypted messaging, a persistent task board, and automatic peer discovery. It runs as an MCP server — no external infrastructure required.

## Install

```bash
npm install -g intandem
intandem init   # adds MCP config to your project
```

## Usage

**Create a workspace** in one Claude Code session:

```
> Create an intandem workspace called fix-auth-bug

Workspace "fix-auth-bug" created!
Share this code with teammates:

  VPA6KW@quiet-fish-42.loca.lt

Messages are end-to-end encrypted.
```

**Join from another session** — same machine or across the network:

```
> Join intandem workspace: VPA6KW@quiet-fish-42.loca.lt

Connected to "fix-auth-bug" as NeonNaruto!
Peers online: CosmicYoda

CosmicYoda capabilities:
  MCP servers: grafana-prod, mcp-atlassian
  Working directory: /projects/backend
```

Peers exchange findings, divide tasks, share code, and coordinate — all through natural language. Claude handles the tool calls automatically.

## Core Concepts

### Task Board

A shared, persistent board for dividing work across peers.

```
[T-a1b2c3] CLAIMED [CRITICAL] - Fix auth vulnerability (CosmicYoda)
[T-d4e5f6] IN_PROGRESS [HIGH]  - Redis pool tuning (NeonNaruto)
[T-g7h8i9] BLOCKED             - Deploy to staging (depends on: T-a1b2c3, T-d4e5f6)
[T-j0k1l2] OPEN                - Update documentation
```

Tasks support four priority levels, dependency chains with automatic unblocking, and ownership protection — a claimed task can only be updated by its assignee.

### Messaging

Eight message types for structured collaboration:

| Type       | Purpose                                               |
| ---------- | ----------------------------------------------------- |
| `finding`  | Share a discovery — bug location, root cause, pattern |
| `status`   | Progress updates                                      |
| `question` | Ask peers for context or clarification                |
| `handoff`  | Transfer work with context to a specific peer         |
| `task`     | Coordinate who does what                              |
| `review`   | Code review feedback                                  |
| `context`  | Share configuration, environment details, setup       |
| `chat`     | General discussion                                    |

All messages include delivery receipts. Directed messages route to a specific peer; broadcasts go to everyone.

### Workspace Variables

Shared key-value state for configuration that all peers need:

```
intandem_set_var key="datasource_uid" value="P8E80F9AEF21F6940"

# Any peer can retrieve it:
intandem_get_var key="datasource_uid"
```

Variables persist for the session and broadcast changes to all peers on update.

### Capability Discovery

When a peer joins, InTandem automatically detects and broadcasts their available MCP servers and working directory. This lets the workspace creator assign tasks to peers who have the right tools.

### Activity Log

A timestamped audit trail of all workspace events — joins, disconnects, task mutations, messages. Query it with `intandem_activity_log` to understand what happened and when.

## Tools

| Tool                    | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `intandem_create`       | Create a workspace and get an invite code            |
| `intandem_join`         | Join using an invite code                            |
| `intandem_send`         | Send a typed message to peers                        |
| `intandem_board`        | View the task board                                  |
| `intandem_add_task`     | Create a task with priority and dependencies         |
| `intandem_claim_task`   | Claim a task                                         |
| `intandem_unclaim_task` | Release a task back to open                          |
| `intandem_update_task`  | Change task status                                   |
| `intandem_plan`         | Batch-create tasks with assignments and dependencies |
| `intandem_share`        | Share a file or code snippet                         |
| `intandem_set_var`      | Set a shared workspace variable                      |
| `intandem_get_var`      | Read a variable (or `*` for all)                     |
| `intandem_activity_log` | View workspace event history                         |
| `intandem_peers`        | List online peers with activity status               |
| `intandem_rejoin`       | Reconnect to a previous workspace                    |
| `intandem_leave`        | Disconnect with session summary                      |

All tools are called by Claude automatically based on natural language — you never invoke them directly.

## Networking

Workspaces are local-first. When you create one, InTandem starts a WebSocket hub on localhost and opens a [localtunnel](https://github.com/localtunnel/localtunnel) for remote peers. The invite code encodes the routing hint:

```
VPA6KW                           # local peers (same machine)
VPA6KW@quiet-fish-42.loca.lt    # remote peers (any network)
```

If the tunnel drops, InTandem retries automatically and notifies connected peers. If the hub owner disconnects, another peer promotes to hub owner and the workspace continues.

## Security

InTandem is designed for zero-trust collaboration between peers:

- **E2E encryption** — AES-256-GCM with HKDF-derived keys (RFC 5869). The hub routes ciphertext; it cannot read message content.
- **Message signing** — HMAC-SHA256 with constant-time verification. The hub enforces sender identity on every message.
- **Invite resolution** — One-time auth tickets with 30-second TTL, rate-limited to 5 attempts per minute per IP.
- **Task ownership** — Claimed tasks are protected; only the assignee can mutate status. The hub enforces `createdBy` on new tasks.
- **Content sanitization** — Angle brackets escaped to prevent prompt injection through channel tags.
- **Resource limits** — 64 KB max payload, 30 messages/minute per peer, 5 peers per workspace.
- **Replay protection** — Messages with timestamps beyond a 2-minute window are rejected.
- **Path traversal** — `intandem_share` validates paths against the project directory before reading files.

## Architecture

```
Claude A ──► MCP tool call ──► Channel (encrypt) ──► WebSocket Hub ──► Channel (decrypt) ──► MCP notification ──► Claude B
```

InTandem runs as a single process per Claude Code session. When creating a workspace, the process embeds the hub — no separate server to manage.

```
src/
  channel/         MCP server, WebSocket client, tool handlers
  hub/             WebSocket hub, SQLite persistence
  shared/          Protocol types, cryptography, configuration
  cli.ts           CLI entrypoint (init, whoami, rename)
```

**Hub** — A WebSocket server that authenticates peers, routes encrypted messages, manages the task board, stores workspace variables, and maintains an activity log in SQLite.

**Channel** — An MCP server that Claude Code spawns as a subprocess. Handles E2E encryption/decryption, connection lifecycle with automatic reconnect, and translates between MCP tool calls and hub protocol messages.

Data is stored at `~/.tandem/` — session configs in `sessions/`, workspace databases in `data/`.

## Development

```bash
git clone https://github.com/sourabh-khot65/tandem.git
cd tandem
npm install
npm run build
npm run dev          # watch mode
npm test             # run tests
npm run lint         # typecheck + format
```

## CLI

```bash
intandem init              # write .mcp.json in current directory
intandem whoami            # print your username
intandem rename <name>     # change your username
```

## License

MIT
