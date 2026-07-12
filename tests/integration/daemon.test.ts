import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { existsSync } from 'node:fs';
import { spawnHub, findRunningHub, stopHub, HUB_FILE } from '../../src/shared/hub-lifecycle.js';
import type { HubDaemonInfo } from '../../src/shared/hub-lifecycle.js';
import type { HubMessage } from '../../src/shared/types.js';
import { connectAndAuth, sendMsg, waitFor, sleep } from '../helpers.js';

const TIMEOUT = 30_000;

beforeAll(() => {
  process.env.INTANDEM_NO_TUNNEL = '1';
});

let daemonInfo: HubDaemonInfo | null = null;

afterEach(async () => {
  stopHub();
  await sleep(500);
  daemonInfo = null;
}, TIMEOUT);

// ─── Daemon lifecycle ───────────────────────────────────────────────

describe('hub daemon lifecycle', () => {
  it('spawns a daemon and writes hubfile', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'daemon-test', maxPeers: 3 });

    expect(daemonInfo.pid).toBeGreaterThan(0);
    expect(daemonInfo.port).toBeGreaterThan(0);
    expect(daemonInfo.localUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(daemonInfo.workspaceId).toMatch(/^TNM-/);
    expect(daemonInfo.workspaceName).toBe('daemon-test');
    expect(daemonInfo.token).toBeTruthy();
    expect(daemonInfo.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(daemonInfo.maxPeers).toBe(3);
    expect(existsSync(HUB_FILE)).toBe(true);
  });

  it('findRunningHub returns daemon info', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'find-test' });

    const found = findRunningHub();
    expect(found).not.toBeNull();
    expect(found!.pid).toBe(daemonInfo.pid);
    expect(found!.workspaceName).toBe('find-test');
  });

  it('stopHub kills daemon and cleans hubfile', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'stop-test' });
    expect(findRunningHub()).not.toBeNull();

    const stopped = stopHub();
    expect(stopped).toBe(true);
    await sleep(1000);

    expect(findRunningHub()).toBeNull();
    daemonInfo = null;
  });

  it('spawnHub replaces an existing daemon', { timeout: TIMEOUT }, async () => {
    const first = await spawnHub({ name: 'first-workspace' });
    const firstPid = first.pid;

    const second = await spawnHub({ name: 'second-workspace' });
    expect(second.pid).not.toBe(firstPid);
    expect(second.workspaceName).toBe('second-workspace');

    const running = findRunningHub();
    expect(running!.workspaceName).toBe('second-workspace');
    daemonInfo = second;
  });
});

// ─── WebSocket connectivity ─────────────────────────────────────────

describe('daemon WebSocket connectivity', () => {
  it('accepts auth with valid token', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'auth-test' });

    const { ws, msg } = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice');
    expect(msg.kind).toBe('auth_ok');
    if (msg.kind === 'auth_ok') {
      expect(msg.workspace.name).toBe('auth-test');
      expect(msg.username).toBe('Alice');
    }
    ws.close();
  });

  it('rejects auth with invalid token', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'bad-auth-test' });

    const { ws, msg } = await connectAndAuth(daemonInfo.localUrl, 'wrong-token', 'Mallory');
    expect(msg.kind).toBe('auth_fail');
    ws.close();
  });

  it('routes messages between peers', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'msg-test', maxPeers: 3 });

    const alice = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice');
    expect(alice.msg.kind).toBe('auth_ok');

    // Drain the peer_joined that arrives for Bob
    const bob = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Bob');
    expect(bob.msg.kind).toBe('auth_ok');
    await sleep(100);

    // Alice sends broadcast
    const bobReceived = waitFor(bob.ws, (m) => m.kind === 'message');
    sendMsg(alice.ws, {
      kind: 'message',
      payload: {
        type: 'chat',
        from: 'Alice',
        content: 'hello from daemon test',
        timestamp: Date.now(),
      },
    });

    const msg = await bobReceived;
    expect(msg.kind).toBe('message');
    if (msg.kind === 'message') {
      expect(msg.payload.content).toBe('hello from daemon test');
      expect(msg.payload.from).toBe('Alice');
    }

    alice.ws.close();
    bob.ws.close();
  });

  it('invite code is pre-registered by daemon', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'invite-test' });

    // Connect and resolve the invite code
    const ws = new WebSocket(daemonInfo.localUrl);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const result = new Promise<HubMessage>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    sendMsg(ws, { kind: 'invite_resolve', inviteCode: daemonInfo.inviteCode });
    const msg = await result;

    expect(msg.kind).toBe('invite_result');
    if (msg.kind === 'invite_result') {
      expect(msg.workspaceId).toBe(daemonInfo.workspaceId);
      expect(msg.token).toBeTruthy(); // ticket, not raw token
    }
    ws.close();
  });
});

// ─── Daemon survives peer disconnect ────────────────────────────────

describe('daemon persistence', () => {
  it('stays alive after all peers disconnect', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'persist-test' });

    // Connect and disconnect
    const { ws } = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Ephemeral');
    ws.close();
    await sleep(500);

    // Daemon should still be running
    const running = findRunningHub();
    expect(running).not.toBeNull();
    expect(running!.pid).toBe(daemonInfo.pid);
  });

  it('allows reconnection after disconnect', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'reconnect-test' });

    // First connection
    const first = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice', 'sess-1');
    expect(first.msg.kind).toBe('auth_ok');
    first.ws.close();
    await sleep(300);

    // Second connection with same session
    const second = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice', 'sess-1');
    expect(second.msg.kind).toBe('auth_ok');
    second.ws.close();
  });

  it('supports task board across reconnects', { timeout: TIMEOUT }, async () => {
    daemonInfo = await spawnHub({ name: 'board-persist-test' });

    // Connect, create a task, disconnect
    const first = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice');
    sendMsg(first.ws, {
      kind: 'board_update',
      task: {
        id: 'T-abc123',
        title: 'Fix the bug',
        status: 'open',
        priority: 'high',
        createdBy: 'Alice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    await sleep(200);
    first.ws.close();
    await sleep(300);

    // Reconnect and check board
    const second = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'Alice', 'sess-2');
    // On first connect with new session, hub auto-pushes board
    const boardMsg = await waitFor(second.ws, (m) => m.kind === 'board');
    expect(boardMsg.kind).toBe('board');
    if (boardMsg.kind === 'board') {
      expect(boardMsg.tasks.length).toBe(1);
      expect(boardMsg.tasks[0].title).toBe('Fix the bug');
      expect(boardMsg.tasks[0].priority).toBe('high');
    }
    second.ws.close();
  });
});

// ─── Adopt mode (hub ownership transfer) ────────────────────────────

describe('daemon adopt mode', () => {
  it('adopts an existing workspace and reuses its DB', { timeout: 45_000 }, async () => {
    // Create workspace, add a task, stop daemon
    const original = await spawnHub({ name: 'adopt-test' });
    const { ws } = await connectAndAuth(original.localUrl, original.token, 'Creator');
    sendMsg(ws, {
      kind: 'board_update',
      task: {
        id: 'T-persist',
        title: 'Survive adoption',
        status: 'in_progress',
        assignee: 'Creator',
        createdBy: 'Creator',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    await sleep(200);
    ws.close();
    await sleep(200);
    stopHub();
    await sleep(1000);

    // Adopt with same workspace ID and token
    daemonInfo = await spawnHub({
      name: 'adopt-test',
      adopt: { workspaceId: original.workspaceId, token: original.token },
    });

    expect(daemonInfo.workspaceId).toBe(original.workspaceId);

    // Connect and verify task survived
    const { ws: ws2, msg } = await connectAndAuth(daemonInfo.localUrl, daemonInfo.token, 'NewOwner');
    expect(msg.kind).toBe('auth_ok');

    const boardMsg = await waitFor(ws2, (m) => m.kind === 'board');
    expect(boardMsg.kind).toBe('board');
    if (boardMsg.kind === 'board') {
      const task = boardMsg.tasks.find((t) => t.id === 'T-persist');
      expect(task).toBeDefined();
      expect(task!.title).toBe('Survive adoption');
      expect(task!.status).toBe('in_progress');
    }
    ws2.close();
  });
});
