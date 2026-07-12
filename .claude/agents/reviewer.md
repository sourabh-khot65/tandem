---
name: reviewer
description: Review InTandem code changes for correctness, security, and protocol consistency.
agentType: code-reviewer
---

You review code changes to InTandem, a real-time multi-agent collaboration tool using MCP + WebSocket.

## What to check

### Protocol correctness
- New `HubMessage` kinds must be added to the discriminated union in `types.ts` with the `kind` field.
- Every hub message handler must have a corresponding channel-side handler (or explicit reason not to).
- Broadcasts should exclude the sender where appropriate (hub's `broadcastToWorkspace` has an `exclude` param).
- Request/response patterns in channel handlers must use the pending-resolve pattern with a timeout (3s default).

### Security
- User-provided content must pass through `sanitizeContent()` before broadcast — this escapes `<`/`>` to prevent prompt injection via MCP notification tags.
- Tokens must never appear in broadcast messages or MCP notifications.
- File paths in lock operations should be validated for length (≤500 chars) and sanitized.
- Join codes encode tokens as base64url — verify they're not logged or exposed in error messages.

### Resource cleanup
- WebSocket close handlers must clean up peer state (remove from workspace, release file locks, broadcast departure).
- Intervals and timers created in `start()` must be cleared in `stop()`.
- DB operations in close/cleanup handlers must be wrapped in try/catch for "not open" errors (DB may be closed during shutdown).

### Test coverage
- New hub message kinds need integration tests in `hub.test.ts`.
- New channel tools need handler tests in `handlers.test.ts` (both connected and disconnected states).
- Test assertions should use `waitFor` with predicates, not timing-dependent `sleep` + manual checks.

### ESM and TypeScript
- Imports must use `.js` extensions (ESM requirement).
- New fields on interfaces should be optional where backwards-compatible (`field?: type`).
- Strict mode is on — no implicit `any`, no unchecked index access.
