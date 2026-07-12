# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InTandem is a real-time pair programming tool that connects up to 5 Claude Code sessions into a shared workspace via MCP (Model Context Protocol). It runs as an MCP server subprocess spawned by Claude Code, exposing tools like `intandem_create`, `intandem_join`, `intandem_send`, etc.

## Build & Dev Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Watch mode (tsc --watch)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run format         # Format all files with Prettier
npm run format:check   # Check formatting without writing
npm run lint           # Run typecheck + format:check
npm test               # Run all tests (vitest run)
npx vitest run tests/integration/hub.test.ts       # Run a single test file
npx vitest run -t "routes messages"                # Run tests matching a name
```

Code quality is enforced via git hooks (husky + lint-staged + commitlint):

- **pre-commit**: lint-staged runs Prettier on staged files + tsc --noEmit once
- **commit-msg**: commitlint enforces conventional commit messages (e.g., `fix:`, `feat:`, `chore:`)

## Architecture

The system has three layers:

1. **Channel (`src/channel/`)** — An MCP server that Claude Code spawns as a subprocess. Split into four files:
   - `server.ts` — Orchestrator: wires MCP server, connection, message handler, and tool handlers together.
   - `connection.ts` — `HubConnection` class managing WebSocket lifecycle, reconnect with generation counter.
   - `handlers.ts` — Tool call handler functions (create, join, send, board, etc.).
   - `tools.ts` — Tool definitions (JSON schemas for each MCP tool).

2. **Hub (`src/hub/`)** — A WebSocket server that routes messages between peers.
   - `server.ts` — Handles auth (token-based), rate limiting (30 msgs/min per peer), peer lifecycle, task board, file locks, and message routing.
   - `db.ts` — SQLite persistence layer (tasks, messages, findings, variables, file locks). Each workspace gets its own database via `TandemDB`.
   - `daemon.ts` — Standalone daemon process. The hub runs detached so it survives MCP channel reconnects. Managed via pidfile at `~/.tandem/hub.json`. Set `INTANDEM_NO_TUNNEL=1` to skip cloudflared tunnel (used in tests and CI).

3. **Shared (`src/shared/`)** — Protocol types, utilities, and lifecycle management.
   - `types.ts` — `HubMessage` discriminated union (uses `kind` field), `FileLock`, `TaskItem`, etc.
   - `hub-lifecycle.ts` — `spawnHub()`, `findRunningHub()`, `stopHub()` for daemon management.
   - `crypto.ts` — Join codes, tokens, content sanitization (escapes `<`/`>` to prevent prompt injection).
   - `config.ts` — Per-PID session files in `~/.tandem/sessions/` with stale PID cleanup.
   - `tunnel.ts` — Cloudflare quick tunnel wrapper for cross-machine access.

**CLI (`src/cli.ts`)** — Entry point for `intandem init`, `intandem whoami`, `intandem rename`, `intandem hub status/stop/logs`, and `intandem channel` (starts the MCP server).

### Message flow

Claude A -> MCP tool call -> Channel server -> WebSocket Hub -> Channel server -> MCP notification -> Claude B

### Key design decisions

- The Channel server embeds the Hub when creating a workspace — the Hub runs as a detached daemon process (`hub-daemon`) that survives MCP reconnects, coordinated via pidfile at `~/.tandem/hub.json`.
- Join codes encode `{hubUrl, workspaceId, token}` as base64url JSON — the token is the sole auth mechanism.
- Content sanitization (`sanitizeContent`) escapes `<`/`>` to prevent prompt injection via channel tags.
- Workspace config persists per-PID in `~/.tandem/sessions/<PID>.json` (stale PIDs auto-cleaned on startup).
- SQLite databases live at `~/.tandem/data/<workspaceId>.db` with WAL mode.
- Advisory file-lock protocol: file-level locks with 5-minute TTL, auto-release on disconnect, real-time broadcast notifications. Channel handlers use a pending-resolve pattern with 3-second timeout for lock/unlock/list operations.
- ESM (`"type": "module"` in package.json) — all imports use `.js` extensions.

### Test structure

- `tests/helpers.ts` — Shared utilities: `createTestHub()`, `connectAndAuth()`, `waitFor()`, `sendMsg()`, `collect()`, `sleep()`.
- `tests/unit/` — Unit tests for crypto, connection, db.
- `tests/integration/` — Integration tests for hub server, channel handlers, daemon lifecycle, collaboration flows.
- Daemon tests spawn real child processes and need `dist/` to exist (run `npm run build` first).
