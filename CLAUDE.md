# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InTandem is a real-time pair programming tool that connects up to 5 Claude Code sessions into a shared workspace via MCP (Model Context Protocol). It runs as an MCP server subprocess spawned by Claude Code, exposing tools like `intandem_create`, `intandem_join`, `intandem_send`, etc.

## Build & Dev Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Watch mode (tsc --watch)
```

No test framework is configured. No linter is configured.

## Architecture

The system has three layers:

1. **Channel (`src/channel/server.ts`)** — An MCP server that Claude Code spawns as a subprocess. It defines all user-facing tools (create, join, send, board, etc.) and manages the connection lifecycle. When creating a workspace, it starts an embedded Hub and opens a localtunnel for remote access. Communicates with Claude via MCP notifications using `notifications/claude/channel`.

2. **Hub (`src/hub/server.ts`)** — A WebSocket server that routes messages between peers. Handles auth (token-based), rate limiting (30 msgs/min per peer), peer lifecycle, and task board operations. Each workspace gets its own SQLite database via `TandemDB`.

3. **Shared (`src/shared/`)** — Protocol types (`types.ts`), crypto utilities (`crypto.ts` — join codes are base64url-encoded JSON containing hub URL + workspace ID + token), username generation (`names.ts`), and config management (`config.ts` — persists to `~/.tandem/`).

**CLI (`src/cli.ts`)** — Thin entry point for `intandem init` (writes `.mcp.json`), `intandem whoami`, `intandem rename`, and `intandem channel` (starts the MCP server — not meant to be run manually).

### Message flow

Claude A -> MCP tool call -> Channel server -> WebSocket Hub -> Channel server -> MCP notification -> Claude B

### Key design decisions

- The Channel server is an all-in-one process: it embeds the Hub when creating a workspace (no separate server process).
- Join codes encode `{hubUrl, workspaceId, token}` as base64url JSON — the token is the sole auth mechanism.
- Content sanitization (`sanitizeContent`) escapes `<`/`>` to prevent prompt injection via channel tags.
- Workspace config persists to `~/.tandem/config.json` for auto-reconnect on Claude Code restart.
- SQLite databases live at `~/.tandem/data/<workspaceId>.db` with WAL mode.
- The hub is ephemeral — when the creator's session ends, it shuts down.

## TypeScript Configuration

- ES2022 target, Node16 module resolution, strict mode
- Source in `src/`, output in `dist/`
- ESM (`"type": "module"` in package.json) — all imports use `.js` extensions
