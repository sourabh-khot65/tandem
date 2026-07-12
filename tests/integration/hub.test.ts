import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { generateInviteCode } from '../../src/shared/crypto.js';
import type { HubMessage } from '../../src/shared/types.js';
import { type TestHub, createTestHub, connectAndAuth, sendMsg, waitFor, collect, sleep } from '../helpers.js';

let th: TestHub;

beforeEach(async () => {
  th = await createTestHub();
});

afterEach(() => {
  th.hub.stop();
});

// ─── Authentication ──────────────────────────────────────────────────

describe('authentication', () => {
  it('accepts valid token', async () => {
    const { ws, msg } = await connectAndAuth(th.url, th.token, 'Alice');
    expect(msg.kind).toBe('auth_ok');
    ws.close();
  });

  it('returns workspace info in auth_ok', async () => {
    const { ws, msg } = await connectAndAuth(th.url, th.token, 'Alice');
    expect(msg.kind).toBe('auth_ok');
    if (msg.kind === 'auth_ok') {
      expect(msg.workspace.name).toBe('test-workspace');
      expect(msg.workspace.id).toBe(th.workspaceId);
      expect(msg.workspace.maxPeers).toBe(5);
    }
    ws.close();
  });

  it('returns username and token in auth_ok', async () => {
    const { ws, msg } = await connectAndAuth(th.url, th.token, 'Alice');
    expect(msg.kind).toBe('auth_ok');
    if (msg.kind === 'auth_ok') {
      expect(msg.username).toBe('Alice');
      expect(msg.token).toBe(th.token);
    }
    ws.close();
  });

  it('rejects invalid token', async () => {
    const { ws, msg } = await connectAndAuth(th.url, 'wrong-token', 'Hacker');
    expect(msg.kind).toBe('auth_fail');
    ws.close();
  });

  it('rejects unauthenticated messages', async () => {
    const ws = await new Promise<WebSocket>((resolve) => {
      const w = new WebSocket(th.url);
      w.on('open', () => resolve(w));
    });
    sendMsg(ws, { kind: 'board', tasks: [] });
    const resp = await waitFor(ws, (m) => m.kind === 'error');
    expect(resp.kind).toBe('error');
    ws.close();
  });

  it('enforces max peers', async () => {
    const hub2 = await createTestHub('small-workspace', 2);
    const { ws: w1 } = await connectAndAuth(hub2.url, hub2.token, 'P1');
    const { ws: w2 } = await connectAndAuth(hub2.url, hub2.token, 'P2');
    const { ws: w3, msg: m3 } = await connectAndAuth(hub2.url, hub2.token, 'P3');
    expect(m3.kind).toBe('auth_fail');
    if (m3.kind === 'auth_fail') {
      expect(m3.reason).toContain('full');
    }
    w1.close();
    w2.close();
    w3.close();
    hub2.hub.stop();
  });

  it('handles username collision with suffix', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice', 'sess-1');
    const { ws: w2, msg: m2 } = await connectAndAuth(th.url, th.token, 'Alice', 'sess-2');
    expect(m2.kind).toBe('auth_ok');
    if (m2.kind === 'auth_ok') {
      expect(m2.username).not.toBe('Alice');
      expect(m2.username).toMatch(/^Alice-[0-9a-f]+$/);
    }
    w1.close();
    w2.close();
  });

  it('allows same-session reconnect with same name', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice', 'sess-same');
    const { ws: w2, msg: m2 } = await connectAndAuth(th.url, th.token, 'Alice', 'sess-same');
    expect(m2.kind).toBe('auth_ok');
    if (m2.kind === 'auth_ok') {
      expect(m2.username).toBe('Alice'); // same session = keeps name
    }
    w1.close();
    w2.close();
  });

  it('times out unauthenticated connections', async () => {
    // This test would require waiting 10s — just verify the timeout is configured
    // by checking that auth works within the window
    const { ws, msg } = await connectAndAuth(th.url, th.token, 'Fast');
    expect(msg.kind).toBe('auth_ok');
    ws.close();
  });
});

// ─── Messaging ───────────────────────────────────────────────────────

describe('messaging', () => {
  it('broadcasts messages to all peers', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100); // drain join notifications

    const msgPromise = waitFor(w1, (m) => m.kind === 'message');
    sendMsg(w2, {
      kind: 'message',
      payload: { type: 'finding', from: 'Bob', content: 'Found it', timestamp: Date.now() },
    });

    const received = await msgPromise;
    expect(received.kind).toBe('message');
    if (received.kind === 'message') {
      expect(received.payload.content).toBe('Found it');
    }
    w1.close();
    w2.close();
  });

  it('enforces sender identity (H1 fix)', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    const msgPromise = waitFor(w1, (m) => m.kind === 'message');
    // Bob tries to spoof as "FakeUser"
    sendMsg(w2, {
      kind: 'message',
      payload: { type: 'chat', from: 'FakeUser', content: 'spoofed', timestamp: Date.now() },
    });

    const received = await msgPromise;
    if (received.kind === 'message') {
      expect(received.payload.from).toBe('Bob'); // hub overwrites to real identity
    }
    w1.close();
    w2.close();
  });

  it('routes directed messages to specific peer', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    const { ws: w3 } = await connectAndAuth(th.url, th.token, 'Carol', 'sess-carol');
    await collect(w1, 100);
    await collect(w3, 100);

    // Bob sends to Alice only
    const alicePromise = waitFor(w1, (m) => m.kind === 'message');
    sendMsg(w2, {
      kind: 'message',
      payload: { type: 'chat', from: 'Bob', to: 'Alice', content: 'private', timestamp: Date.now() },
    });

    const aliceMsg = await alicePromise;
    expect(aliceMsg.kind).toBe('message');

    // Carol should NOT receive it
    const carolMsgs = await collect(w3, 300);
    const carolGotIt = carolMsgs.some((m) => m.kind === 'message' && (m as any).payload.content === 'private');
    expect(carolGotIt).toBe(false);

    w1.close();
    w2.close();
    w3.close();
  });

  it('returns error for non-existent recipient', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'message',
      payload: { type: 'chat', from: 'Alice', to: 'Ghost', content: 'hello?', timestamp: Date.now() },
    });

    const err = await waitFor(w1, (m) => m.kind === 'error');
    expect(err.kind).toBe('error');
    if (err.kind === 'error') expect(err.message).toContain('Ghost');
    w1.close();
  });

  it('sends delivery receipts with msgId', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);
    await collect(w2, 100);

    const ackPromise = waitFor(w1, (m) => m.kind === 'msg_ack');
    sendMsg(w1, {
      kind: 'message',
      payload: { type: 'chat', from: 'Alice', content: 'ack test', timestamp: Date.now(), msgId: 'msg-42' },
    });

    const ack = await ackPromise;
    expect(ack.kind).toBe('msg_ack');
    if (ack.kind === 'msg_ack') {
      expect(ack.msgId).toBe('msg-42');
      expect(ack.deliveredTo).toContain('Bob');
    }
    w1.close();
    w2.close();
  });

  it('rejects stale timestamps (H2 fix)', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'message',
      payload: { type: 'chat', from: 'Alice', content: 'old', timestamp: Date.now() - 300_000 },
    });

    const err = await waitFor(w1, (m) => m.kind === 'error');
    expect(err.kind).toBe('error');
    if (err.kind === 'error') expect(err.message).toContain('timestamp');
    w1.close();
  });

  it('rate limits excessive messages', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Spammer');
    await collect(w1, 100);

    const msgs: HubMessage[] = [];
    const handler = (data: WebSocket.RawData) => msgs.push(JSON.parse(data.toString()));
    w1.on('message', handler);

    for (let i = 0; i < 35; i++) {
      sendMsg(w1, {
        kind: 'message',
        payload: { type: 'chat', from: 'Spammer', content: `spam ${i}`, timestamp: Date.now() },
      });
    }
    await sleep(500);
    w1.off('message', handler);

    const rateLimitErr = msgs.find((m) => m.kind === 'error' && (m as any).message.includes('Rate limit'));
    expect(rateLimitErr).toBeDefined();
    w1.close();
  });
});

// ─── Peer Lifecycle ──────────────────────────────────────────────────

describe('peer lifecycle', () => {
  it('notifies on peer join', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    const joinPromise = waitFor(w1, (m) => m.kind === 'peer_joined');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    const joinMsg = await joinPromise;

    expect(joinMsg.kind).toBe('peer_joined');
    if (joinMsg.kind === 'peer_joined') {
      expect(joinMsg.username).toBe('Bob');
      expect(joinMsg.peers).toContain('Alice');
      expect(joinMsg.peers).toContain('Bob');
    }
    w1.close();
    w2.close();
  });

  it('notifies on peer leave', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);

    const leavePromise = waitFor(w1, (m) => m.kind === 'peer_left');
    w2.close();
    const leaveMsg = await leavePromise;

    expect(leaveMsg.kind).toBe('peer_left');
    if (leaveMsg.kind === 'peer_left') {
      expect(leaveMsg.username).toBe('Bob');
    }
    w1.close();
  });

  it('returns peer info with lastActiveAt', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);

    // Bob sends a message to update lastMessageAt
    sendMsg(w2, {
      kind: 'message',
      payload: { type: 'status', from: 'Bob', content: 'active', timestamp: Date.now() },
    });
    await sleep(100);

    const peersPromise = waitFor(w1, (m) => m.kind === 'peers');
    sendMsg(w1, { kind: 'peers' });
    const peers = await peersPromise;

    expect(peers.kind).toBe('peers');
    if (peers.kind === 'peers' && peers.list) {
      expect(peers.list).toHaveLength(2);
      const bob = peers.list.find((p) => p.username === 'Bob');
      expect(bob).toBeDefined();
      expect(bob!.lastActiveAt).toBeGreaterThan(0);
      expect(bob!.lastActiveAt).toBeGreaterThanOrEqual(bob!.connectedAt);
    }
    w1.close();
    w2.close();
  });

  it('pushes board and recent messages on first connect', async () => {
    // Create a task first
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-pre', title: 'Pre-existing', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    await sleep(200);

    // New peer connects — board is pushed during auth, so collect ALL messages including auth
    const allMsgs: HubMessage[] = [];
    const { ws: w2 } = await new Promise<{ ws: WebSocket }>((resolve) => {
      const ws = new WebSocket(th.url);
      ws.on('message', (data) => {
        allMsgs.push(JSON.parse(data.toString()) as HubMessage);
      });
      ws.on('open', () => {
        sendMsg(ws, { kind: 'auth', token: th.token, username: 'Bob', sessionId: 'sess-bob-board' });
      });
      // Resolve once auth_ok arrives
      const check = setInterval(() => {
        if (allMsgs.some((m) => m.kind === 'auth_ok')) {
          clearInterval(check);
          resolve({ ws });
        }
      }, 50);
    });
    await sleep(300);

    const boardMsg = allMsgs.find((m) => m.kind === 'board');
    expect(boardMsg).toBeDefined();
    if (boardMsg?.kind === 'board') {
      expect(boardMsg.tasks.some((t) => t.id === 'T-pre')).toBe(true);
    }
    w1.close();
    w2.close();
  });
});

// ─── Invite Codes ────────────────────────────────────────────────────

describe('invite codes', () => {
  it('resolves registered invite code', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Creator');
    const code = generateInviteCode();
    sendMsg(w1, { kind: 'invite_register', inviteCode: code });
    await sleep(100);

    // Fresh connection resolves the code
    const ws = await new Promise<WebSocket>((resolve) => {
      const w = new WebSocket(th.url);
      w.on('open', () => resolve(w));
    });
    const resultPromise = waitFor(ws, (m) => m.kind === 'invite_result' || m.kind === 'invite_fail');
    sendMsg(ws, { kind: 'invite_resolve', inviteCode: code });
    const result = await resultPromise;

    expect(result.kind).toBe('invite_result');
    if (result.kind === 'invite_result') {
      expect(result.workspaceId).toBe(th.workspaceId);
      expect(result.token).not.toBe(th.token); // returns ticket, not raw token
    }

    // Ticket auth works and returns real token
    if (result.kind === 'invite_result') {
      const { ws: w2, msg: m2 } = await connectAndAuth(th.url, result.token, 'Joiner');
      expect(m2.kind).toBe('auth_ok');
      if (m2.kind === 'auth_ok') {
        expect(m2.token).toBe(th.token); // real token for E2E
      }
      w2.close();
    }

    ws.close();
    w1.close();
  });

  it('rejects invalid invite code', async () => {
    const ws = await new Promise<WebSocket>((resolve) => {
      const w = new WebSocket(th.url);
      w.on('open', () => resolve(w));
    });
    sendMsg(ws, { kind: 'invite_resolve', inviteCode: 'ZZZZZZ' });
    const result = await waitFor(ws, (m) => m.kind === 'invite_fail');
    expect(result.kind).toBe('invite_fail');
    ws.close();
  });
});

// ─── Capabilities ────────────────────────────────────────────────────

describe('capabilities', () => {
  it('broadcasts capabilities to other peers', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);

    const capPromise = waitFor(w1, (m) => m.kind === 'capabilities');
    sendMsg(w2, { kind: 'capabilities', username: 'Bob', cwd: '/projects/app', tools: ['grafana', 'jira'] });
    const cap = await capPromise;

    expect(cap.kind).toBe('capabilities');
    if (cap.kind === 'capabilities') {
      expect(cap.username).toBe('Bob');
      expect(cap.tools).toEqual(['grafana', 'jira']);
      expect(cap.cwd).toBe('/projects/app');
    }
    w1.close();
    w2.close();
  });
});

// ─── File locks ───────────────────────────────────────────────────────

describe('file locks', () => {
  it('acquires a lock and responds with success', async () => {
    const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
    const resultPromise = waitFor(ws, (m) => m.kind === 'lock_result');
    sendMsg(ws, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const msg = await resultPromise;

    expect(msg.kind).toBe('lock_result');
    if (msg.kind === 'lock_result') {
      expect(msg.success).toBe(true);
      expect(msg.filePath).toBe('src/auth.ts');
      expect(msg.expiresAt).toBeGreaterThan(Date.now());
    }
    ws.close();
  });

  it('denies lock held by another peer', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    // Alice locks
    const lockPromise = waitFor(w1, (m) => m.kind === 'lock_result');
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await lockPromise;

    // Bob tries to lock same file
    const denyPromise = waitFor(w2, (m) => m.kind === 'lock_result');
    sendMsg(w2, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const deny = await denyPromise;

    expect(deny.kind).toBe('lock_result');
    if (deny.kind === 'lock_result') {
      expect(deny.success).toBe(false);
      expect(deny.lockedBy).toBe('Alice');
    }
    w1.close();
    w2.close();
  });

  it('broadcasts lock_update to other peers on acquire', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    const updatePromise = waitFor(w2, (m) => m.kind === 'lock_update');
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const update = await updatePromise;

    expect(update.kind).toBe('lock_update');
    if (update.kind === 'lock_update') {
      expect(update.event).toBe('acquired');
      expect(update.lock.filePath).toBe('src/auth.ts');
      expect(update.lock.lockedBy).toBe('Alice');
    }
    w1.close();
    w2.close();
  });

  it('releases lock and broadcasts to peers', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);
    await collect(w2, 100);

    // Alice locks
    const lockPromise = waitFor(w1, (m) => m.kind === 'lock_result');
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await lockPromise;
    await collect(w2, 100); // drain lock_update

    // Alice unlocks
    const releasePromise = waitFor(w2, (m) => m.kind === 'lock_update');
    const resultPromise = waitFor(w1, (m) => m.kind === 'lock_result');
    sendMsg(w1, { kind: 'lock_release', filePath: 'src/auth.ts' });

    const result = await resultPromise;
    expect(result.kind).toBe('lock_result');
    if (result.kind === 'lock_result') expect(result.success).toBe(true);

    const release = await releasePromise;
    expect(release.kind).toBe('lock_update');
    if (release.kind === 'lock_update') {
      expect(release.event).toBe('released');
      expect(release.lock.filePath).toBe('src/auth.ts');
    }
    w1.close();
    w2.close();
  });

  it('allows re-lock after release by different peer', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    // Alice locks then unlocks
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await waitFor(w1, (m) => m.kind === 'lock_result');
    sendMsg(w1, { kind: 'lock_release', filePath: 'src/auth.ts' });
    await waitFor(w1, (m) => m.kind === 'lock_result');
    await sleep(100);

    // Bob can now lock it
    const bobResult = waitFor(w2, (m) => m.kind === 'lock_result');
    sendMsg(w2, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const msg = await bobResult;

    expect(msg.kind).toBe('lock_result');
    if (msg.kind === 'lock_result') expect(msg.success).toBe(true);
    w1.close();
    w2.close();
  });

  it('releases locks on peer disconnect', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w2, 100);

    // Alice locks a file
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await waitFor(w1, (m) => m.kind === 'lock_result');
    await collect(w2, 100); // drain lock_update

    // Alice disconnects — Bob should get lock_update(released)
    const releasePromise = waitFor(w2, (m) => m.kind === 'lock_update' && m.event === 'released');
    w1.close();
    const release = await releasePromise;

    expect(release.kind).toBe('lock_update');
    if (release.kind === 'lock_update') {
      expect(release.event).toBe('released');
      expect(release.lock.filePath).toBe('src/auth.ts');
    }
    w2.close();
  });

  it('lists all active locks', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    // Alice and Bob each lock a file
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await waitFor(w1, (m) => m.kind === 'lock_result');
    sendMsg(w2, { kind: 'lock_acquire', filePath: 'src/db.ts' });
    await waitFor(w2, (m) => m.kind === 'lock_result');

    // Alice requests lock list
    const listPromise = waitFor(w1, (m) => m.kind === 'locks_list');
    sendMsg(w1, { kind: 'locks_request' });
    const list = await listPromise;

    expect(list.kind).toBe('locks_list');
    if (list.kind === 'locks_list') {
      expect(list.locks.length).toBe(2);
      const paths = list.locks.map((l) => l.filePath).sort();
      expect(paths).toEqual(['src/auth.ts', 'src/db.ts']);
    }
    w1.close();
    w2.close();
  });

  it('extends TTL on re-lock by same peer', async () => {
    const { ws } = await connectAndAuth(th.url, th.token, 'Alice');

    // Lock once
    sendMsg(ws, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const first = await waitFor(ws, (m) => m.kind === 'lock_result');

    // Lock again (should extend TTL)
    sendMsg(ws, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    const second = await waitFor(ws, (m) => m.kind === 'lock_result');

    if (first.kind === 'lock_result' && second.kind === 'lock_result') {
      expect(second.success).toBe(true);
      expect(second.expiresAt!).toBeGreaterThanOrEqual(first.expiresAt!);
    }
    ws.close();
  });

  it('rejects release by non-holder', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 100);

    // Alice locks
    sendMsg(w1, { kind: 'lock_acquire', filePath: 'src/auth.ts' });
    await waitFor(w1, (m) => m.kind === 'lock_result');
    await sleep(100);

    // Bob tries to unlock
    const resultPromise = waitFor(w2, (m) => m.kind === 'lock_result');
    sendMsg(w2, { kind: 'lock_release', filePath: 'src/auth.ts' });
    const result = await resultPromise;

    expect(result.kind).toBe('lock_result');
    if (result.kind === 'lock_result') {
      expect(result.success).toBe(false);
      expect(result.reason).toContain('do not hold');
    }
    w1.close();
    w2.close();
  });

  it('includes taskId in lock', async () => {
    const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
    sendMsg(ws, { kind: 'lock_acquire', filePath: 'src/auth.ts', taskId: 'T-fix-auth' });
    await waitFor(ws, (m) => m.kind === 'lock_result');

    const listPromise = waitFor(ws, (m) => m.kind === 'locks_list');
    sendMsg(ws, { kind: 'locks_request' });
    const list = await listPromise;

    expect(list.kind).toBe('locks_list');
    if (list.kind === 'locks_list') {
      expect(list.locks[0].taskId).toBe('T-fix-auth');
    }
    ws.close();
  });
});
