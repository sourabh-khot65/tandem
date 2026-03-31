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
```

Code quality is enforced via git hooks (husky + lint-staged + commitlint):

- **pre-commit**: lint-staged runs Prettier on staged files + tsc --noEmit once
- **commit-msg**: commitlint enforces conventional commit messages (e.g., `fix:`, `feat:`, `chore:`)

No test framework is configured.

## Architecture

The system has three layers:

1. **Channel (`src/channel/`)** — An MCP server that Claude Code spawns as a subprocess. Split into four files:
   - `server.ts` — Orchestrator: wires MCP server, connection, message handler, and tool handlers together.
   - `connection.ts` — `HubConnection` class managing WebSocket lifecycle, reconnect with generation counter.
   - `handlers.ts` — Tool call handler functions (create, join, send, board, etc.).
   - `tools.ts` — Tool definitions (JSON schemas for each MCP tool).
     When creating a workspace, it starts an embedded Hub and opens a localtunnel for remote access. Communicates with Claude via MCP notifications using `notifications/claude/channel`.

2. **Hub (`src/hub/server.ts`)** — A WebSocket server that routes messages between peers. Handles auth (token-based), rate limiting (30 msgs/min per peer), peer lifecycle, and task board operations. Each workspace gets its own SQLite database via `TandemDB`.

3. **Shared (`src/shared/`)** — Protocol types (`types.ts`), crypto utilities (`crypto.ts` — join codes, tokens, content sanitization), username generation (`names.ts`), and config management (`config.ts` — per-PID session files in `~/.tandem/sessions/` with stale PID cleanup).

**CLI (`src/cli.ts`)** — Thin entry point for `intandem init` (writes `.mcp.json`), `intandem whoami`, `intandem rename`, and `intandem channel` (starts the MCP server — not meant to be run manually).

### Message flow

Claude A -> MCP tool call -> Channel server -> WebSocket Hub -> Channel server -> MCP notification -> Claude B

### Key design decisions

- The Channel server is an all-in-one process: it embeds the Hub when creating a workspace (no separate server process).
- Join codes encode `{hubUrl, workspaceId, token}` as base64url JSON — the token is the sole auth mechanism.
- Content sanitization (`sanitizeContent`) escapes `<`/`>` to prevent prompt injection via channel tags.
- Workspace config persists per-PID in `~/.tandem/sessions/<PID>.json` (stale PIDs auto-cleaned on startup).
- SQLite databases live at `~/.tandem/data/<workspaceId>.db` with WAL mode.
- The hub is ephemeral — when the creator's session ends, it shuts down.

## TypeScript Configuration

- ES2022 target, Node16 module resolution, strict mode
- Source in `src/`, output in `dist/`
- ESM (`"type": "module"` in package.json) — all imports use `.js` extensions
