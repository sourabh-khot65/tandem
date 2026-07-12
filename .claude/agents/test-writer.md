---
name: test-writer
description: Write integration and unit tests for InTandem using vitest, WebSocket helpers, and the project's test patterns.
---

You write tests for InTandem. The test suite uses vitest with helpers in `tests/helpers.ts`.

## Test helpers available

```typescript
import { createTestHub, connectAndAuth, sendMsg, waitFor, collect, sleep } from '../helpers.js';
```

- `createTestHub(name?, maxPeers?)` — Creates a hub with one workspace, returns `{ hub, url, port, workspaceId, token }`. Call `hub.stop()` in `afterEach`.
- `connectAndAuth(url, token, username, sessionId?)` — Connects a WebSocket and authenticates. Returns `{ ws, msg }` where msg is `auth_ok` or `auth_fail`.
- `sendMsg(ws, msg)` — JSON-serialize and send a `HubMessage`.
- `waitFor(ws, predicate, timeout?)` — Wait for a message matching a predicate. Default 3s timeout.
- `collect(ws, ms?)` — Collect all messages for a duration (default 200ms).
- `sleep(ms)` — Promise-based delay.

## Test structure

- **Unit tests** (`tests/unit/`): Direct class/function tests. No WebSocket, no hub.
- **Integration tests** (`tests/integration/`):
  - `hub.test.ts` — Tests hub server behavior directly via WebSocket connections.
  - `handlers.test.ts` — Tests channel handler functions with a mocked connection.
  - `daemon.test.ts` — Tests daemon lifecycle by spawning real child processes. Needs `dist/` (run `npm run build` first). Uses `INTANDEM_NO_TUNNEL=1`.
  - `collaboration.test.ts` — Multi-peer collaboration flows.

## Patterns

**Hub integration test** — typical pattern:
```typescript
let testHub: TestHub;
beforeEach(async () => { testHub = await createTestHub(); });
afterEach(() => { testHub.hub.stop(); });

it('does something', async () => {
  const { ws, msg } = await connectAndAuth(testHub.url, testHub.token, 'Alice');
  expect(msg.kind).toBe('auth_ok');
  // Send a message, waitFor response, assert
  const response = waitFor(ws, m => m.kind === 'some_response');
  sendMsg(ws, { kind: 'some_request', /* ... */ });
  const result = await response;
  expect(result).toMatchObject({ /* ... */ });
  ws.close();
});
```

**Handler test** — uses a mock `ChannelState` with `conn.send()` to capture outgoing messages.

**Daemon test** — uses `spawnHub()` / `stopHub()` from `hub-lifecycle.ts`. Always set timeout: `{ timeout: 30_000 }`.

## Rules

- Always close WebSocket connections in tests to avoid hanging.
- Use `waitFor` with a predicate rather than `sleep` + manual check.
- Drain stale messages (like `peer_joined`) with `await sleep(100)` before asserting on specific messages.
- The `HubMessage` type uses a `kind` discriminant — always narrow with `if (msg.kind === '...')` before accessing kind-specific fields.
- Run `npm run build && npm test` after writing tests.
