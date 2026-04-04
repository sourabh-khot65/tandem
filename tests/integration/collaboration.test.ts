import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { HubMessage } from '../../src/shared/types.js';
import { type TestHub, createTestHub, connectAndAuth, sendMsg, waitFor, collect, sleep } from '../helpers.js';

let th: TestHub;

beforeEach(async () => {
  th = await createTestHub();
});

afterEach(() => {
  th.hub.stop();
});

// ─── Task Board Operations ───────────────────────────────────────────

describe('task board', () => {
  it('creates tasks with triggeredBy audit trail', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w2, 200);

    const updatePromise = waitFor(w2, (m) => m.kind === 'board_update');
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-1', title: 'Do something', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    const update = await updatePromise;

    expect(update.kind).toBe('board_update');
    if (update.kind === 'board_update') {
      expect(update.triggeredBy).toBe('Alice');
      expect(update.task.createdBy).toBe('Alice');
    }
    w1.close();
    w2.close();
  });

  it('retrieves board via request', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-x', title: 'Task X', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    await sleep(100);

    const boardPromise = waitFor(w1, (m) => m.kind === 'board');
    sendMsg(w1, { kind: 'board', tasks: [] });
    const board = await boardPromise;

    expect(board.kind).toBe('board');
    if (board.kind === 'board') {
      expect(board.tasks.some((t) => t.id === 'T-x')).toBe(true);
    }
    w1.close();
  });

  it('validates task status', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-bad',
        title: 'Bad status',
        status: 'invalid' as any,
        createdBy: 'Alice',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const err = await waitFor(w1, (m) => m.kind === 'error');
    expect(err.kind).toBe('error');
    w1.close();
  });

  it('rejects oversized task title (H5 fix)', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-long',
        title: 'x'.repeat(600),
        status: 'open',
        createdBy: 'Alice',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const err = await waitFor(w1, (m) => m.kind === 'error');
    if (err.kind === 'error') expect(err.message).toContain('title too long');
    w1.close();
  });
});

// ─── Task Claiming & Ownership ───────────────────────────────────────

describe('task claiming', () => {
  async function setupTaskWithTwoPeers() {
    const { ws: w1, msg: m1 } = await connectAndAuth(th.url, th.token, 'Creator');
    const { ws: w2, msg: m2 } = await connectAndAuth(th.url, th.token, 'Worker', 'sess-worker');
    const workerName = m2.kind === 'auth_ok' ? m2.username : 'Worker';
    await collect(w1, 200);
    await collect(w2, 200);

    // Creator makes a task
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-work', title: 'Do work', status: 'open', createdBy: 'Creator', createdAt: 1, updatedAt: 1 },
    });
    await collect(w2, 200);

    return { w1, w2, workerName };
  }

  it('allows anyone to claim an open task', async () => {
    const { w1, w2, workerName } = await setupTaskWithTwoPeers();

    const claimPromise = waitFor(w1, (m) => m.kind === 'board_update');
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: workerName,
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    const claim = await claimPromise;
    if (claim.kind === 'board_update') {
      expect(claim.task.assignee).toBe(workerName);
      expect(claim.task.status).toBe('claimed');
    }
    w1.close();
    w2.close();
  });

  it('allows assignee to update their claimed task', async () => {
    const { w1, w2, workerName } = await setupTaskWithTwoPeers();

    // Claim
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: workerName,
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await collect(w1, 200);

    // Update to in_progress
    const progressPromise = waitFor(w1, (m) => m.kind === 'board_update');
    sendMsg(w2, {
      kind: 'board_update',
      task: { id: 'T-work', title: '', status: 'in_progress', createdBy: '', createdAt: 0, updatedAt: Date.now() },
    });
    const progress = await progressPromise;
    if (progress.kind === 'board_update') {
      expect(progress.task.status).toBe('in_progress');
    }
    w1.close();
    w2.close();
  });

  it('prevents creator from overriding claimed task status', async () => {
    const { w1, w2, workerName } = await setupTaskWithTwoPeers();

    // Worker claims
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: workerName,
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await collect(w1, 200);

    // Creator tries to mark done
    const rejectPromise = waitFor(w1, (m) => m.kind === 'board_reject');
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-work', title: '', status: 'done', createdBy: '', createdAt: 0, updatedAt: Date.now() },
    });
    const reject = await rejectPromise;
    expect(reject.kind).toBe('board_reject');
    if (reject.kind === 'board_reject') {
      expect(reject.reason).toContain(workerName);
    }
    w1.close();
    w2.close();
  });

  it('prevents non-creator non-assignee from modifying task', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Creator');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Worker', 'sess-worker');
    const { ws: w3 } = await connectAndAuth(th.url, th.token, 'Outsider', 'sess-outsider');
    await collect(w3, 300);

    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-priv', title: 'Private', status: 'open', createdBy: 'Creator', createdAt: 1, updatedAt: 1 },
    });
    await collect(w3, 200);

    // Worker claims it
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-priv',
        title: '',
        status: 'claimed',
        assignee: 'Worker',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await collect(w3, 200);

    // Outsider tries to update
    const rejectPromise = waitFor(w3, (m) => m.kind === 'board_reject');
    sendMsg(w3, {
      kind: 'board_update',
      task: { id: 'T-priv', title: '', status: 'done', createdBy: '', createdAt: 0, updatedAt: Date.now() },
    });
    const reject = await rejectPromise;
    expect(reject.kind).toBe('board_reject');
    w1.close();
    w2.close();
    w3.close();
  });

  it('allows unclaim (assignee releases back to open)', async () => {
    const { w1, w2, workerName } = await setupTaskWithTwoPeers();

    // Claim
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: workerName,
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await collect(w1, 200);

    // Unclaim
    const unclaimPromise = waitFor(w1, (m) => m.kind === 'board_update');
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'open',
        assignee: '',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    const unclaim = await unclaimPromise;
    if (unclaim.kind === 'board_update') {
      expect(unclaim.task.status).toBe('open');
      expect(unclaim.task.assignee).toBeFalsy();
    }
    w1.close();
    w2.close();
  });

  it('rejects claim on already-claimed task', async () => {
    const { w1, w2, workerName } = await setupTaskWithTwoPeers();
    const { ws: w3 } = await connectAndAuth(th.url, th.token, 'Intruder', 'sess-intruder');
    await collect(w3, 300);

    // Worker claims
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: workerName,
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await collect(w3, 200);

    // Intruder tries to claim
    const rejectPromise = waitFor(w3, (m) => m.kind === 'board_reject');
    sendMsg(w3, {
      kind: 'board_update',
      task: {
        id: 'T-work',
        title: '',
        status: 'claimed',
        assignee: 'Intruder',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    const reject = await rejectPromise;
    expect(reject.kind).toBe('board_reject');
    if (reject.kind === 'board_reject') {
      expect(reject.reason).toContain('claimed');
    }
    w1.close();
    w2.close();
    w3.close();
  });
});

// ─── Task Dependencies ───────────────────────────────────────────────

describe('task dependencies', () => {
  it('auto-blocks tasks with unmet dependencies', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w2, 200);

    // Create parent
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-dep-parent', title: 'Parent', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    await collect(w2, 200);

    // Create child with dependency
    const childPromise = waitFor(w2, (m) => m.kind === 'board_update');
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-dep-child',
        title: 'Child',
        status: 'open',
        dependsOn: ['T-dep-parent'],
        createdBy: 'Alice',
        createdAt: 2,
        updatedAt: 2,
      },
    });
    const child = await childPromise;
    if (child.kind === 'board_update') {
      expect(child.task.status).toBe('blocked');
      expect(child.task.dependsOn).toEqual(['T-dep-parent']);
    }
    w1.close();
    w2.close();
  });

  it('auto-unblocks when all dependencies complete', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);
    await collect(w2, 200);

    // Create parent + child
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-unblock-parent',
        title: 'Parent',
        status: 'open',
        createdBy: 'Alice',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    await sleep(100);
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-unblock-child',
        title: 'Child',
        status: 'open',
        dependsOn: ['T-unblock-parent'],
        createdBy: 'Alice',
        createdAt: 2,
        updatedAt: 2,
      },
    });
    await collect(w2, 300);

    // Complete parent — collect all board_updates on w2
    const updates: HubMessage[] = [];
    const handler = (data: WebSocket.RawData) => updates.push(JSON.parse(data.toString()));
    w2.on('message', handler);

    // Claim then complete parent
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-unblock-parent',
        title: '',
        status: 'claimed',
        assignee: 'Alice',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await sleep(100);
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-unblock-parent', title: '', status: 'done', createdBy: '', createdAt: 0, updatedAt: Date.now() },
    });
    await sleep(500);
    w2.off('message', handler);

    const childUnblock = updates.find(
      (m) =>
        m.kind === 'board_update' && (m as Extract<HubMessage, { kind: 'board_update' }>).task.id === 'T-unblock-child',
    );
    expect(childUnblock).toBeDefined();
    if (childUnblock?.kind === 'board_update') {
      expect(childUnblock.task.status).toBe('open');
    }
    w1.close();
    w2.close();
  });

  it('keeps task blocked when only some dependencies are done', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 200);

    // Create two parents and one child depending on both
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-p1', title: 'P1', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-p2', title: 'P2', status: 'open', createdBy: 'Alice', createdAt: 2, updatedAt: 2 },
    });
    await sleep(100);
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-multi-child',
        title: 'Multi-Child',
        status: 'open',
        dependsOn: ['T-p1', 'T-p2'],
        createdBy: 'Alice',
        createdAt: 3,
        updatedAt: 3,
      },
    });
    await sleep(200);

    // Complete only P1
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-p1',
        title: '',
        status: 'claimed',
        assignee: 'Alice',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await sleep(100);

    const updates: HubMessage[] = [];
    const handler = (data: WebSocket.RawData) => updates.push(JSON.parse(data.toString()));
    w1.on('message', handler);

    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-p1', title: '', status: 'done', createdBy: '', createdAt: 0, updatedAt: Date.now() },
    });
    await sleep(300);
    w1.off('message', handler);

    // Child should NOT be unblocked (P2 still open)
    const childUpdate = updates.find(
      (m) =>
        m.kind === 'board_update' &&
        (m as Extract<HubMessage, { kind: 'board_update' }>).task.id === 'T-multi-child' &&
        (m as Extract<HubMessage, { kind: 'board_update' }>).task.status === 'open',
    );
    expect(childUpdate).toBeUndefined();
    w1.close();
  });
});

// ─── Workspace Variables ─────────────────────────────────────────────

describe('workspace variables', () => {
  it('sets and retrieves a variable', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, { kind: 'var_set', key: 'uid', value: 'P8E80F9AEF21F6940', setBy: 'Alice' });
    await sleep(100);

    const resultPromise = waitFor(w1, (m) => m.kind === 'var_result');
    sendMsg(w1, { kind: 'var_get', key: 'uid' });
    const result = await resultPromise;

    if (result.kind === 'var_result') {
      expect(result.value).toBe('P8E80F9AEF21F6940');
      expect(result.setBy).toBe('Alice');
    }
    w1.close();
  });

  it('broadcasts var_set to other peers', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);

    const varPromise = waitFor(w1, (m) => m.kind === 'var_set');
    sendMsg(w2, { kind: 'var_set', key: 'env', value: 'production', setBy: 'Bob' });
    const varMsg = await varPromise;

    if (varMsg.kind === 'var_set') {
      expect(varMsg.key).toBe('env');
      expect(varMsg.value).toBe('production');
    }
    w1.close();
    w2.close();
  });

  it('lists all variables with wildcard', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, { kind: 'var_set', key: 'k1', value: 'v1', setBy: 'Alice' });
    sendMsg(w1, { kind: 'var_set', key: 'k2', value: 'v2', setBy: 'Alice' });
    await sleep(100);

    const listPromise = waitFor(w1, (m) => m.kind === 'vars_list');
    sendMsg(w1, { kind: 'var_get', key: '*' });
    const list = await listPromise;

    if (list.kind === 'vars_list') {
      expect(list.vars.length).toBeGreaterThanOrEqual(2);
    }
    w1.close();
  });

  it('returns null for non-existent variable', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    const resultPromise = waitFor(w1, (m) => m.kind === 'var_result');
    sendMsg(w1, { kind: 'var_get', key: 'nonexistent' });
    const result = await resultPromise;

    if (result.kind === 'var_result') {
      expect(result.value).toBeNull();
    }
    w1.close();
  });

  it('rejects oversized variable key', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, { kind: 'var_set', key: 'x'.repeat(200), value: 'v', setBy: 'Alice' });
    const err = await waitFor(w1, (m) => m.kind === 'error');
    if (err.kind === 'error') expect(err.message).toContain('key too long');
    w1.close();
  });
});

// ─── Activity Log ────────────────────────────────────────────────────

describe('activity log', () => {
  it('records join events', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await sleep(100);

    const logPromise = waitFor(w1, (m) => m.kind === 'activity_log');
    sendMsg(w1, { kind: 'activity_log_request', limit: 50 });
    const log = await logPromise;

    if (log.kind === 'activity_log') {
      expect(log.entries.some((e) => e.action === 'joined' && e.actor === 'Alice')).toBe(true);
    }
    w1.close();
  });

  it('records task operations', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-log', title: 'Logged task', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    await sleep(100);
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-log',
        title: '',
        status: 'claimed',
        assignee: 'Alice',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await sleep(100);

    const logPromise = waitFor(w1, (m) => m.kind === 'activity_log');
    sendMsg(w1, { kind: 'activity_log_request' });
    const log = await logPromise;

    if (log.kind === 'activity_log') {
      const actions = log.entries.map((e) => e.action);
      expect(actions).toContain('task_create');
      expect(actions).toContain('task_update');
    }
    w1.close();
  });

  it('records message events', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'message',
      payload: { type: 'status', from: 'Alice', content: 'hello', timestamp: Date.now() },
    });
    await sleep(100);

    const logPromise = waitFor(w1, (m) => m.kind === 'activity_log');
    sendMsg(w1, { kind: 'activity_log_request' });
    const log = await logPromise;

    if (log.kind === 'activity_log') {
      expect(log.entries.some((e) => e.action === 'message')).toBe(true);
    }
    w1.close();
  });

  it('respects limit parameter', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    // Generate some activity
    for (let i = 0; i < 10; i++) {
      sendMsg(w1, {
        kind: 'message',
        payload: { type: 'chat', from: 'Alice', content: `msg ${i}`, timestamp: Date.now() },
      });
    }
    await sleep(200);

    const logPromise = waitFor(w1, (m) => m.kind === 'activity_log');
    sendMsg(w1, { kind: 'activity_log_request', limit: 3 });
    const log = await logPromise;

    if (log.kind === 'activity_log') {
      expect(log.entries.length).toBeLessThanOrEqual(3);
    }
    w1.close();
  });
});

// ─── Security ────────────────────────────────────────────────────────

describe('security', () => {
  it('closes connection on oversized payload (H4 fix)', async () => {
    const ws = await new Promise<WebSocket>((resolve) => {
      const w = new WebSocket(th.url);
      w.on('open', () => resolve(w));
    });

    const closed = new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    try {
      ws.send('x'.repeat(70_000));
    } catch {
      // expected
    }

    expect(await closed).toBe(true);
  });

  it('enforces createdBy on new tasks (H5 fix)', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w2, 200);

    // Bob tries to create task claiming Alice created it
    const updatePromise = waitFor(w2, (m) => m.kind === 'board_update');
    sendMsg(w2, {
      kind: 'board_update',
      task: {
        id: 'T-spoof',
        title: 'Spoofed creator',
        status: 'open',
        createdBy: 'Alice',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    // Hub should enforce — we check on broadcast
    const update = await updatePromise;
    if (update.kind === 'board_update') {
      expect(update.task.createdBy).toBe('Bob'); // hub overwrites
    }
    w1.close();
    w2.close();
  });
});

// ─── Task Results ────────────────────────────────────────────────────

describe('task results', () => {
  it('attaches result when completing a task', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w2, 200);

    // Create and claim task
    sendMsg(w1, {
      kind: 'board_update',
      task: { id: 'T-result', title: 'Review logs', status: 'open', createdBy: 'Alice', createdAt: 1, updatedAt: 1 },
    });
    await sleep(100);
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-result',
        title: '',
        status: 'claimed',
        assignee: 'Alice',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    await sleep(100);

    // Complete with result
    const updatePromise = waitFor(
      w2,
      (m) => m.kind === 'board_update' && (m as any).task.id === 'T-result' && (m as any).task.result,
    );
    sendMsg(w1, {
      kind: 'board_update',
      task: {
        id: 'T-result',
        title: '',
        status: 'done',
        result: '58 insurance records missing from V1 sync',
        createdBy: '',
        createdAt: 0,
        updatedAt: Date.now(),
      },
    });
    const update = await updatePromise;
    if (update.kind === 'board_update') {
      expect(update.task.result).toBe('58 insurance records missing from V1 sync');
      expect(update.task.status).toBe('done');
    }

    // Verify result persists on board
    const boardPromise = waitFor(w1, (m) => m.kind === 'board');
    sendMsg(w1, { kind: 'board', tasks: [] });
    const board = await boardPromise;
    if (board.kind === 'board') {
      const task = board.tasks.find((t) => t.id === 'T-result');
      expect(task!.result).toBe('58 insurance records missing from V1 sync');
    }

    w1.close();
    w2.close();
  });
});

// ─── Structured Findings ─────────────────────────────────────────────

describe('structured findings', () => {
  it('submits a finding and broadcasts to peers', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);
    await collect(w2, 200);

    const broadcastPromise = waitFor(w1, (m) => m.kind === 'finding_broadcast');
    sendMsg(w2, {
      kind: 'finding_submit',
      finding: {
        id: 'F-test01',
        service: 'payment-service',
        severity: 'high',
        summary: 'Insurance records not found for legacy lab groups',
        category: 'data_missing',
        count: 58,
        patterns: [{ pattern: 'Insurance records not found', count: 58, source: 'LegacyInsuranceServiceImpl' }],
        recommendation: 'Investigate V1 data sync gap',
        reportedBy: 'Bob',
        timestamp: Date.now(),
      },
    });

    const broadcast = await broadcastPromise;
    expect(broadcast.kind).toBe('finding_broadcast');
    if (broadcast.kind === 'finding_broadcast') {
      expect(broadcast.finding.service).toBe('payment-service');
      expect(broadcast.finding.severity).toBe('high');
      expect(broadcast.finding.summary).toBe('Insurance records not found for legacy lab groups');
      expect(broadcast.finding.count).toBe(58);
      expect(broadcast.finding.reportedBy).toBe('Bob'); // hub enforces identity
    }
    w1.close();
    w2.close();
  });

  it('queries findings without filters', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    // Submit two findings
    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-q1',
        service: 'auth',
        severity: 'critical',
        summary: 'JWKS resolution failing',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-q2',
        service: 'payment',
        severity: 'high',
        summary: 'Insurance records missing',
        count: 58,
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    await sleep(200);

    const listPromise = waitFor(w1, (m) => m.kind === 'findings_list');
    sendMsg(w1, { kind: 'findings_request' });
    const list = await listPromise;

    if (list.kind === 'findings_list') {
      expect(list.findings.length).toBeGreaterThanOrEqual(2);
    }
    w1.close();
  });

  it('filters findings by severity', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-sev1',
        service: 'svc',
        severity: 'critical',
        summary: 'Critical thing',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-sev2',
        service: 'svc',
        severity: 'low',
        summary: 'Minor thing',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    await sleep(200);

    const listPromise = waitFor(w1, (m) => m.kind === 'findings_list');
    sendMsg(w1, { kind: 'findings_request', severity: 'critical' });
    const list = await listPromise;

    if (list.kind === 'findings_list') {
      expect(list.findings.every((f) => f.severity === 'critical')).toBe(true);
    }
    w1.close();
  });

  it('filters findings by service', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-fs1',
        service: 'kit',
        severity: 'high',
        summary: 'Kit issue',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-fs2',
        service: 'order',
        severity: 'high',
        summary: 'Order issue',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    await sleep(200);

    const listPromise = waitFor(w1, (m) => m.kind === 'findings_list');
    sendMsg(w1, { kind: 'findings_request', service: 'kit' });
    const list = await listPromise;

    if (list.kind === 'findings_list') {
      expect(list.findings.every((f) => f.service === 'kit')).toBe(true);
    }
    w1.close();
  });

  it('enforces reporter identity', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    const { ws: w2 } = await connectAndAuth(th.url, th.token, 'Bob', 'sess-bob');
    await collect(w1, 200);

    const broadcastPromise = waitFor(w1, (m) => m.kind === 'finding_broadcast');
    sendMsg(w2, {
      kind: 'finding_submit',
      finding: {
        id: 'F-spoof',
        service: 'svc',
        severity: 'info',
        summary: 'Spoofed reporter',
        reportedBy: 'FakeUser', // try to spoof
        timestamp: Date.now(),
      },
    });
    const broadcast = await broadcastPromise;
    if (broadcast.kind === 'finding_broadcast') {
      expect(broadcast.finding.reportedBy).toBe('Bob'); // hub enforces real identity
    }
    w1.close();
    w2.close();
  });

  it('links finding to task', async () => {
    const { ws: w1 } = await connectAndAuth(th.url, th.token, 'Alice');
    await collect(w1, 100);

    sendMsg(w1, {
      kind: 'finding_submit',
      finding: {
        id: 'F-link',
        service: 'payment',
        severity: 'high',
        summary: 'Linked to task',
        taskId: 'T-abc123',
        reportedBy: 'Alice',
        timestamp: Date.now(),
      },
    });
    await sleep(200);

    const listPromise = waitFor(w1, (m) => m.kind === 'findings_list');
    sendMsg(w1, { kind: 'findings_request' });
    const list = await listPromise;

    if (list.kind === 'findings_list') {
      const f = list.findings.find((f) => f.id === 'F-link');
      expect(f).toBeDefined();
      expect(f!.taskId).toBe('T-abc123');
    }
    w1.close();
  });
});
