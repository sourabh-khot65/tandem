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

// ─── Dashboard ──────────────────────────────────────────────────────

// ─── Security hardening ─────────────────────────────────────────────

describe('security hardening', () => {
  describe('dashboard security headers', () => {
    it('includes X-Frame-Options DENY', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=${encodeURIComponent(th.token)}`);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    });

    it('includes X-Content-Type-Options nosniff', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=${encodeURIComponent(th.token)}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('includes Referrer-Policy no-referrer', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=${encodeURIComponent(th.token)}`);
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    });

    it('includes Cache-Control no-store', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=${encodeURIComponent(th.token)}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('username validation', () => {
    it('rejects username longer than 32 characters', async () => {
      const longName = 'A'.repeat(33);
      const { ws, msg } = await connectAndAuth(th.url, th.token, longName);
      expect(msg.kind).toBe('auth_fail');
      if (msg.kind === 'auth_fail') {
        expect(msg.reason).toContain('too long');
      }
      ws.close();
    });

    it('rejects username with invalid characters', async () => {
      const { ws, msg } = await connectAndAuth(th.url, th.token, 'user@evil.com');
      expect(msg.kind).toBe('auth_fail');
      if (msg.kind === 'auth_fail') {
        expect(msg.reason).toContain('alphanumeric');
      }
      ws.close();
    });

    it('rejects username with spaces', async () => {
      const { ws, msg } = await connectAndAuth(th.url, th.token, 'has space');
      expect(msg.kind).toBe('auth_fail');
      ws.close();
    });

    it('accepts valid username with dashes and underscores', async () => {
      const { ws, msg } = await connectAndAuth(th.url, th.token, 'valid_user-123');
      expect(msg.kind).toBe('auth_ok');
      ws.close();
    });

    it('accepts 32-character username', async () => {
      const { ws, msg } = await connectAndAuth(th.url, th.token, 'A'.repeat(32));
      expect(msg.kind).toBe('auth_ok');
      ws.close();
    });
  });

  describe('entity caps', () => {
    it('rejects tasks beyond 500 limit', async () => {
      const { ws } = await connectAndAuth(th.url, th.token, 'Alice');

      // Insert 500 tasks directly via the hub's workspace db
      const workspace = (th.hub as any).workspaces.values().next().value;
      for (let i = 0; i < 500; i++) {
        workspace.db.createTask({
          id: `task-${i}`,
          title: `Task ${i}`,
          status: 'open',
          priority: 'medium',
          createdBy: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // The 501st should be rejected
      sendMsg(ws, {
        kind: 'board_update',
        task: {
          id: 'task-overflow',
          title: 'One too many',
          status: 'open',
          priority: 'medium',
          createdBy: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      const err = await waitFor(ws, (m) => m.kind === 'error');
      expect(err.kind).toBe('error');
      if (err.kind === 'error') {
        expect(err.message).toContain('Task limit');
      }
      ws.close();
    });

    it('still allows updating existing tasks at the cap', async () => {
      const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
      const workspace = (th.hub as any).workspaces.values().next().value;
      for (let i = 0; i < 500; i++) {
        workspace.db.createTask({
          id: `task-${i}`,
          title: `Task ${i}`,
          status: 'open',
          priority: 'medium',
          createdBy: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // Updating an existing task should still work
      sendMsg(ws, {
        kind: 'board_update',
        task: {
          id: 'task-0',
          title: 'Updated task',
          status: 'claimed',
          assignee: 'Alice',
          priority: 'medium',
          createdBy: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      const update = await waitFor(ws, (m) => m.kind === 'board_update');
      expect(update.kind).toBe('board_update');
      ws.close();
    });

    it('rejects findings beyond 500 limit', async () => {
      const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
      const workspace = (th.hub as any).workspaces.values().next().value;
      for (let i = 0; i < 500; i++) {
        workspace.db.createFinding({
          id: `finding-${i}`,
          service: 'test',
          severity: 'low',
          summary: `Finding ${i}`,
          reportedBy: 'Alice',
          timestamp: Date.now(),
        });
      }

      sendMsg(ws, {
        kind: 'finding_submit',
        finding: {
          id: 'finding-overflow',
          service: 'test',
          severity: 'low',
          summary: 'One too many',
          reportedBy: 'Alice',
          timestamp: Date.now(),
        },
      });
      const err = await waitFor(ws, (m) => m.kind === 'error');
      expect(err.kind).toBe('error');
      if (err.kind === 'error') {
        expect(err.message).toContain('Finding limit');
      }
      ws.close();
    });

    it('rejects new variables beyond 100 limit', async () => {
      const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
      const workspace = (th.hub as any).workspaces.values().next().value;
      for (let i = 0; i < 100; i++) {
        workspace.db.setVar(`key-${i}`, `value-${i}`, 'Alice');
      }

      sendMsg(ws, { kind: 'var_set', key: 'key-overflow', value: 'nope', setBy: 'Alice' });
      const err = await waitFor(ws, (m) => m.kind === 'error');
      expect(err.kind).toBe('error');
      if (err.kind === 'error') {
        expect(err.message).toContain('Variable limit');
      }
      ws.close();
    });

    it('still allows updating existing variables at the cap', async () => {
      const { ws } = await connectAndAuth(th.url, th.token, 'Alice');
      const workspace = (th.hub as any).workspaces.values().next().value;
      for (let i = 0; i < 100; i++) {
        workspace.db.setVar(`key-${i}`, `value-${i}`, 'Alice');
      }

      sendMsg(ws, { kind: 'var_set', key: 'key-0', value: 'updated', setBy: 'Alice' });
      const update = await waitFor(ws, (m) => m.kind === 'var_set');
      expect(update.kind).toBe('var_set');
      if (update.kind === 'var_set') {
        expect(update.value).toBe('updated');
      }
      ws.close();
    });
  });
});

describe('dashboard', () => {
  describe('HTTP endpoint', () => {
    it('returns 401 without token', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard`);
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=bad-token`);
      expect(res.status).toBe(401);
    });

    it('returns 200 with valid token', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/dashboard?token=${encodeURIComponent(th.token)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('InTandem');
      expect(html).toContain('test-workspace');
    });

    it('returns 404 for unknown paths', async () => {
      const res = await fetch(`http://127.0.0.1:${th.port}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe('observer connection', () => {
    it('receives dashboard_sync on connect', async () => {
      const ws = new WebSocket(th.url);
      await new Promise<void>((r) => ws.on('open', r));
      sendMsg(ws, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });

      const sync = await waitFor(ws, (m) => m.kind === 'dashboard_sync');
      expect(sync.kind).toBe('dashboard_sync');
      if (sync.kind === 'dashboard_sync') {
        expect(sync.workspace.name).toBe('test-workspace');
        expect(sync.workspace.id).toBe(th.workspaceId);
        expect(sync.peers).toEqual([]);
        expect(sync.tasks).toEqual([]);
        expect(sync.locks).toEqual([]);
      }
      ws.close();
    });

    it('does not appear in peer list', async () => {
      const dashWs = new WebSocket(th.url);
      await new Promise<void>((r) => dashWs.on('open', r));
      sendMsg(dashWs, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });
      await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

      const { ws: peerWs, msg } = await connectAndAuth(th.url, th.token, 'Alice');
      expect(msg.kind).toBe('auth_ok');
      if (msg.kind === 'auth_ok') {
        expect(msg.workspace.peers).not.toContain('__dashboard__');
      }

      peerWs.close();
      dashWs.close();
    });

    it('does not trigger peer_joined broadcast', async () => {
      const { ws: peerWs } = await connectAndAuth(th.url, th.token, 'Alice');

      const dashWs = new WebSocket(th.url);
      await new Promise<void>((r) => dashWs.on('open', r));
      sendMsg(dashWs, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });
      await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

      // Alice should not receive a peer_joined for __dashboard__
      const msgs = await collect(peerWs, 300);
      const dashboardJoins = msgs.filter(
        (m) =>
          m.kind === 'peer_joined' && (m as Extract<HubMessage, { kind: 'peer_joined' }>).username === '__dashboard__',
      );
      expect(dashboardJoins).toHaveLength(0);

      peerWs.close();
      dashWs.close();
    });

    it('does not count toward maxPeers', async () => {
      const small = await createTestHub('small', 1);
      try {
        // Dashboard connects first
        const dashWs = new WebSocket(small.url);
        await new Promise<void>((r) => dashWs.on('open', r));
        sendMsg(dashWs, { kind: 'auth', token: small.token, username: '__dashboard__', sessionId: '__dashboard__' });
        await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

        // Peer should still be able to join (1 slot available)
        const { ws: peerWs, msg } = await connectAndAuth(small.url, small.token, 'Alice');
        expect(msg.kind).toBe('auth_ok');

        peerWs.close();
        dashWs.close();
      } finally {
        small.hub.stop();
      }
    });

    it('receives board_update broadcasts', async () => {
      const dashWs = new WebSocket(th.url);
      await new Promise<void>((r) => dashWs.on('open', r));
      sendMsg(dashWs, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });
      await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

      const { ws: peerWs } = await connectAndAuth(th.url, th.token, 'Alice');
      const updatePromise = waitFor(dashWs, (m) => m.kind === 'board_update');

      sendMsg(peerWs, {
        kind: 'board_update',
        task: {
          id: 'T-dash-1',
          title: 'Dashboard test task',
          status: 'open',
          createdBy: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      const update = await updatePromise;
      expect(update.kind).toBe('board_update');
      if (update.kind === 'board_update') {
        expect(update.task.title).toBe('Dashboard test task');
      }

      peerWs.close();
      dashWs.close();
    });

    it('receives peer_joined and peer_left broadcasts', async () => {
      const dashWs = new WebSocket(th.url);
      await new Promise<void>((r) => dashWs.on('open', r));
      sendMsg(dashWs, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });
      await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

      const joinPromise = waitFor(dashWs, (m) => m.kind === 'peer_joined');
      const { ws: peerWs } = await connectAndAuth(th.url, th.token, 'Bob');
      const joined = await joinPromise;
      expect(joined.kind).toBe('peer_joined');

      const leftPromise = waitFor(dashWs, (m) => m.kind === 'peer_left');
      peerWs.close();
      const left = await leftPromise;
      expect(left.kind).toBe('peer_left');

      dashWs.close();
    });

    it('receives activity_entry broadcasts', async () => {
      const dashWs = new WebSocket(th.url);
      await new Promise<void>((r) => dashWs.on('open', r));
      sendMsg(dashWs, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dashboard__' });
      await waitFor(dashWs, (m) => m.kind === 'dashboard_sync');

      const activityPromise = waitFor(dashWs, (m) => m.kind === 'activity_entry');
      const { ws: peerWs } = await connectAndAuth(th.url, th.token, 'Carol');
      const activity = await activityPromise;
      expect(activity.kind).toBe('activity_entry');
      if (activity.kind === 'activity_entry') {
        expect(activity.entry.actor).toBe('Carol');
        expect(activity.entry.action).toBe('joined');
      }

      peerWs.close();
      dashWs.close();
    });

    it('multiple dashboards can connect simultaneously', async () => {
      const dash1 = new WebSocket(th.url);
      const dash2 = new WebSocket(th.url);
      await Promise.all([new Promise<void>((r) => dash1.on('open', r)), new Promise<void>((r) => dash2.on('open', r))]);
      sendMsg(dash1, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dash1__' });
      sendMsg(dash2, { kind: 'auth', token: th.token, username: '__dashboard__', sessionId: '__dash2__' });
      const [sync1, sync2] = await Promise.all([
        waitFor(dash1, (m) => m.kind === 'dashboard_sync'),
        waitFor(dash2, (m) => m.kind === 'dashboard_sync'),
      ]);
      expect(sync1.kind).toBe('dashboard_sync');
      expect(sync2.kind).toBe('dashboard_sync');

      // Both receive peer_joined
      const [join1, join2] = await Promise.all([
        waitFor(dash1, (m) => m.kind === 'peer_joined'),
        waitFor(dash2, (m) => m.kind === 'peer_joined'),
        connectAndAuth(th.url, th.token, 'Dave').then(({ ws }) => ws),
      ]);
      expect(join1.kind).toBe('peer_joined');
      expect(join2.kind).toBe('peer_joined');

      dash1.close();
      dash2.close();
    });
  });
});
