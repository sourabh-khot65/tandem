import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { handleToolCall, type ChannelState } from '../../src/channel/handlers.js';
import { HubConnection } from '../../src/channel/connection.js';
import { type TestHub, createTestHub, sendMsg, waitFor, collect, sleep } from '../helpers.js';
import type { HubMessage } from '../../src/shared/types.js';

// ─── State factory ───────────────────────────────────────────────────

function createState(overrides: Partial<ChannelState> = {}): ChannelState {
  return {
    hub: null,
    tunnel: null,
    currentPeers: [],
    workspaceName: '',
    myUsername: 'TestUser',
    workspaceToken: '',
    inviteCode: '',
    pendingBoardResolve: null,
    pendingVarResolve: null,
    pendingActivityResolve: null,
    pendingFindingsResolve: null,
    stats: {
      connectedAt: 0,
      toolCallCount: 0,
      intandemToolCallCount: 0,
      messagesSent: 0,
      messagesReceived: 0,
      tasksClaimed: 0,
      tasksCompleted: 0,
      peersSeenCount: 0,
    },
    ...overrides,
  };
}

function getResultText(result: { content: [{ type: 'text'; text: string }] }): string {
  return result.content[0].text;
}

// ─── Tests with real hub (end-to-end handler tests) ──────────────────

describe('handleToolCall — disconnected state', () => {
  let state: ChannelState;
  let conn: HubConnection;

  beforeEach(() => {
    state = createState();
    conn = new HubConnection(() => {});
  });

  afterEach(() => {
    conn.disconnect();
  });

  it('intandem_send returns error when not connected', async () => {
    const result = await handleToolCall('intandem_send', { type: 'status', message: 'hello' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_board returns error when not connected', async () => {
    const result = await handleToolCall('intandem_board', {}, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_add_task returns error when not connected', async () => {
    const result = await handleToolCall('intandem_add_task', { title: 'Test' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_claim_task returns error when not connected', async () => {
    const result = await handleToolCall('intandem_claim_task', { task_id: 'T-1' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_unclaim_task returns error when not connected', async () => {
    const result = await handleToolCall('intandem_unclaim_task', { task_id: 'T-1' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_update_task returns error when not connected', async () => {
    const result = await handleToolCall('intandem_update_task', { task_id: 'T-1', status: 'done' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_plan returns error when not connected', async () => {
    const result = await handleToolCall('intandem_plan', { tasks: [{ title: 'x' }] }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_share returns error when not connected', async () => {
    const result = await handleToolCall('intandem_share', { file: 'test.ts' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_set_var returns error when not connected', async () => {
    const result = await handleToolCall('intandem_set_var', { key: 'k', value: 'v' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_get_var returns error when not connected', async () => {
    const result = await handleToolCall('intandem_get_var', { key: 'k' }, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_peers returns error when not connected', async () => {
    const result = await handleToolCall('intandem_peers', {}, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_activity_log returns error when not connected', async () => {
    const result = await handleToolCall('intandem_activity_log', {}, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_leave returns error when not connected', async () => {
    const result = await handleToolCall('intandem_leave', {}, conn, state);
    expect(getResultText(result)).toContain('Not connected');
  });

  it('intandem_rejoin returns result (may find stale config or fail)', async () => {
    const result = await handleToolCall('intandem_rejoin', {}, conn, state);
    const text = getResultText(result);
    // May find a stale config from previous sessions or fail — both are valid
    expect(text.length).toBeGreaterThan(0);
  });

  it('throws on unknown tool', async () => {
    await expect(handleToolCall('intandem_nope', {}, conn, state)).rejects.toThrow('Unknown tool');
  });

  it('increments intandemToolCallCount', async () => {
    expect(state.stats.intandemToolCallCount).toBe(0);
    await handleToolCall('intandem_board', {}, conn, state);
    expect(state.stats.intandemToolCallCount).toBe(1);
    await handleToolCall('intandem_peers', {}, conn, state);
    expect(state.stats.intandemToolCallCount).toBe(2);
  });

  it('intandem_send rejects invalid type', async () => {
    // Temporarily mark connected
    (conn as any).connected = true;
    const result = await handleToolCall('intandem_send', { type: 'invalid', message: 'hi' }, conn, state);
    expect(getResultText(result)).toContain('Invalid type');
    (conn as any).connected = false;
  });
});

// ─── Tests with real hub connection ──────────────────────────────────

describe('handleToolCall — connected state', () => {
  let th: TestHub;
  let state: ChannelState;
  let conn: HubConnection;
  const hubMessages: HubMessage[] = [];

  beforeEach(async () => {
    th = await createTestHub();
    hubMessages.length = 0;
    state = createState({ myUsername: 'Handler' });
    conn = new HubConnection((msg) => {
      hubMessages.push(msg);
      // Wire up board resolve
      if (msg.kind === 'board' && state.pendingBoardResolve) {
        state.pendingBoardResolve(msg.tasks);
        state.pendingBoardResolve = null;
      }
      if (msg.kind === 'var_result' && state.pendingVarResolve) {
        if (msg.value !== null) {
          state.pendingVarResolve(`${msg.key} = ${msg.value} (set by ${msg.setBy})`);
        } else {
          state.pendingVarResolve(`Variable "${msg.key}" not found.`);
        }
        state.pendingVarResolve = null;
      }
      if (msg.kind === 'vars_list' && state.pendingVarResolve) {
        const lines = msg.vars.map((v) => `  ${v.key} = ${v.value}`);
        state.pendingVarResolve(`Workspace variables:\n${lines.join('\n')}`);
        state.pendingVarResolve = null;
      }
      if (msg.kind === 'activity_log' && state.pendingActivityResolve) {
        const lines = msg.entries.map((e) => `${e.actor}: ${e.action}`);
        state.pendingActivityResolve(`Activity Log:\n${lines.join('\n')}`);
        state.pendingActivityResolve = null;
      }
      if (msg.kind === 'findings_list' && state.pendingFindingsResolve) {
        if (msg.findings.length === 0) {
          state.pendingFindingsResolve('No findings recorded.');
        } else {
          const lines = msg.findings.map((f) => `[${f.id}] [${f.severity.toUpperCase()}] ${f.service}: ${f.summary}`);
          state.pendingFindingsResolve(`Findings (${msg.findings.length}):\n${lines.join('\n')}`);
        }
        state.pendingFindingsResolve = null;
      }
      if (msg.kind === 'auth_ok') {
        state.workspaceName = msg.workspace.name;
        state.workspaceToken = msg.token;
      }
    });
    const ok = await conn.connect(th.url, th.token, 'Handler');
    expect(ok).toBe(true);
  });

  afterEach(() => {
    conn.intentionalLeave = true;
    conn.disconnect();
    th.hub.stop();
  });

  // ─── Send ────────────────────────────────────────────────────────

  it('intandem_send broadcasts a message', async () => {
    const result = await handleToolCall('intandem_send', { type: 'status', message: 'hello world' }, conn, state);
    const text = getResultText(result);
    expect(text).toContain('Sent status');
    expect(text).toContain('hello world');
    expect(state.stats.messagesSent).toBe(1);
  });

  it('intandem_send with to routes to specific peer', async () => {
    const result = await handleToolCall(
      'intandem_send',
      { type: 'finding', message: 'bug found', to: 'PeerX' },
      conn,
      state,
    );
    expect(getResultText(result)).toContain('to PeerX');
  });

  // ─── Tasks ───────────────────────────────────────────────────────

  it('intandem_add_task creates a task', async () => {
    const result = await handleToolCall(
      'intandem_add_task',
      { title: 'Fix bug', description: 'It is broken', priority: 'high' },
      conn,
      state,
    );
    const text = getResultText(result);
    expect(text).toContain('Task created');
    expect(text).toContain('Fix bug');
    expect(text).toMatch(/T-[0-9a-f]{6}/);
  });

  it('intandem_add_task with depends_on creates blocked task', async () => {
    const result = await handleToolCall(
      'intandem_add_task',
      { title: 'Child task', depends_on: ['T-parent'] },
      conn,
      state,
    );
    expect(getResultText(result)).toContain('blocked by T-parent');
  });

  it('intandem_claim_task claims a task', async () => {
    await handleToolCall('intandem_add_task', { title: 'Claimable' }, conn, state);
    await sleep(100);

    // Get task ID from board
    const boardResult = await handleToolCall('intandem_board', {}, conn, state);
    const boardText = getResultText(boardResult);
    const match = boardText.match(/\[(T-[0-9a-f]+)\]/);
    expect(match).not.toBeNull();

    const result = await handleToolCall('intandem_claim_task', { task_id: match![1] }, conn, state);
    expect(getResultText(result)).toContain('Claimed task');
    expect(state.stats.tasksClaimed).toBe(1);
  });

  it('intandem_update_task changes status', async () => {
    await handleToolCall('intandem_add_task', { title: 'Update me' }, conn, state);
    await sleep(100);

    const boardResult = await handleToolCall('intandem_board', {}, conn, state);
    const match = getResultText(boardResult).match(/\[(T-[0-9a-f]+)\]/);

    // Claim first
    await handleToolCall('intandem_claim_task', { task_id: match![1] }, conn, state);
    await sleep(100);

    const result = await handleToolCall('intandem_update_task', { task_id: match![1], status: 'done' }, conn, state);
    expect(getResultText(result)).toContain('done');
    expect(state.stats.tasksCompleted).toBe(1);
  });

  it('intandem_unclaim_task releases a task', async () => {
    await handleToolCall('intandem_add_task', { title: 'Release me' }, conn, state);
    await sleep(100);

    const boardResult = await handleToolCall('intandem_board', {}, conn, state);
    const match = getResultText(boardResult).match(/\[(T-[0-9a-f]+)\]/);

    await handleToolCall('intandem_claim_task', { task_id: match![1] }, conn, state);
    await sleep(100);

    const result = await handleToolCall('intandem_unclaim_task', { task_id: match![1] }, conn, state);
    expect(getResultText(result)).toContain('Released task');
    expect(getResultText(result)).toContain('open');
  });

  // ─── Plan ────────────────────────────────────────────────────────

  it('intandem_plan creates multiple tasks', async () => {
    const result = await handleToolCall(
      'intandem_plan',
      {
        tasks: [
          { title: 'Task A', assignee: 'Handler' },
          { title: 'Task B', priority: 'critical' },
          { title: 'Task C', depends_on: ['T-999'] },
        ],
      },
      conn,
      state,
    );
    const text = getResultText(result);
    expect(text).toContain('3 tasks');
    expect(text).toContain('Task A');
    expect(text).toContain('Task B');
    expect(text).toContain('Task C');
  });

  it('intandem_plan rejects empty tasks', async () => {
    const result = await handleToolCall('intandem_plan', { tasks: [] }, conn, state);
    expect(getResultText(result)).toContain('No tasks');
  });

  // ─── Board ───────────────────────────────────────────────────────

  it('intandem_board shows tasks sorted by priority', async () => {
    await handleToolCall('intandem_add_task', { title: 'Low task', priority: 'low' }, conn, state);
    await handleToolCall('intandem_add_task', { title: 'Critical task', priority: 'critical' }, conn, state);
    await sleep(200);

    const result = await handleToolCall('intandem_board', {}, conn, state);
    const text = getResultText(result);
    const criticalIdx = text.indexOf('Critical task');
    const lowIdx = text.indexOf('Low task');
    expect(criticalIdx).toBeLessThan(lowIdx);
  });

  it('intandem_board returns empty message', async () => {
    // Board should be empty on fresh workspace — but we might have auto-pushed tasks from plan
    // Use a fresh hub
    conn.intentionalLeave = true;
    conn.disconnect();
    th.hub.stop();

    const th2 = await createTestHub('empty-board');
    const conn2 = new HubConnection((msg) => {
      if (msg.kind === 'board' && state.pendingBoardResolve) {
        state.pendingBoardResolve(msg.tasks);
        state.pendingBoardResolve = null;
      }
    });
    await conn2.connect(th2.url, th2.token, 'Handler');
    // Drain auto-pushed empty board
    await sleep(200);

    const result = await handleToolCall('intandem_board', {}, conn2, state);
    expect(getResultText(result)).toContain('empty');
    conn2.intentionalLeave = true;
    conn2.disconnect();
    th2.hub.stop();
  });

  // ─── Share ───────────────────────────────────────────────────────

  it('intandem_share shares a file snippet', async () => {
    // Create a temp file to share
    const tmpDir = join(process.cwd(), '__test_share_tmp');
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\nconst y = 2;\nconst z = 3;\n');

    try {
      const result = await handleToolCall(
        'intandem_share',
        { file: '__test_share_tmp/test.ts', start_line: 1, end_line: 2 },
        conn,
        state,
      );
      expect(getResultText(result)).toContain('Shared __test_share_tmp/test.ts');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('intandem_share rejects path traversal', async () => {
    const result = await handleToolCall('intandem_share', { file: '../../../etc/passwd' }, conn, state);
    expect(getResultText(result)).toMatch(/denied|not found/i);
  });

  it('intandem_share requires file argument', async () => {
    const result = await handleToolCall('intandem_share', {}, conn, state);
    expect(getResultText(result)).toContain('Specify a file');
  });

  // ─── Variables ───────────────────────────────────────────────────

  it('intandem_set_var sets a variable', async () => {
    const result = await handleToolCall('intandem_set_var', { key: 'uid', value: 'ABC123' }, conn, state);
    expect(getResultText(result)).toContain('Set variable');
    expect(getResultText(result)).toContain('uid');
  });

  it('intandem_get_var retrieves a variable', async () => {
    await handleToolCall('intandem_set_var', { key: 'testkey', value: 'testval' }, conn, state);
    await sleep(100);

    const result = await handleToolCall('intandem_get_var', { key: 'testkey' }, conn, state);
    expect(getResultText(result)).toContain('testval');
  });

  it('intandem_get_var with * lists all variables', async () => {
    await handleToolCall('intandem_set_var', { key: 'a', value: '1' }, conn, state);
    await handleToolCall('intandem_set_var', { key: 'b', value: '2' }, conn, state);
    await sleep(100);

    const result = await handleToolCall('intandem_get_var', { key: '*' }, conn, state);
    expect(getResultText(result)).toContain('Workspace variables');
  });

  it('intandem_set_var requires both key and value', async () => {
    const result = await handleToolCall('intandem_set_var', { key: '', value: '' }, conn, state);
    expect(getResultText(result)).toContain('required');
  });

  it('intandem_get_var requires key', async () => {
    const result = await handleToolCall('intandem_get_var', { key: '' }, conn, state);
    expect(getResultText(result)).toContain('required');
  });

  // ─── Findings ─────────────────────────────────────────────────────

  it('intandem_finding reports a structured finding', async () => {
    const result = await handleToolCall(
      'intandem_finding',
      {
        service: 'payment-service',
        severity: 'high',
        summary: 'Insurance records not found for legacy lab groups',
        category: 'data_missing',
        count: 58,
        patterns: [{ pattern: 'Insurance records not found', count: 58 }],
        recommendation: 'Investigate V1 data sync',
      },
      conn,
      state,
    );
    const text = getResultText(result);
    expect(text).toContain('[HIGH]');
    expect(text).toContain('payment-service');
    expect(text).toContain('58 occurrences');
    expect(text).toContain('1 pattern(s)');
  });

  it('intandem_finding requires service, severity, and summary', async () => {
    const r1 = await handleToolCall('intandem_finding', { service: '', severity: 'high', summary: 'x' }, conn, state);
    expect(getResultText(r1)).toContain('required');

    const r2 = await handleToolCall('intandem_finding', { service: 'svc', severity: '', summary: 'x' }, conn, state);
    expect(getResultText(r2)).toContain('required');

    const r3 = await handleToolCall('intandem_finding', { service: 'svc', severity: 'high', summary: '' }, conn, state);
    expect(getResultText(r3)).toContain('required');
  });

  it('intandem_finding links to task', async () => {
    const result = await handleToolCall(
      'intandem_finding',
      { service: 'kit', severity: 'medium', summary: 'BioTouch API issue', task_id: 'T-xyz' },
      conn,
      state,
    );
    expect(getResultText(result)).toContain('linked to T-xyz');
  });

  it('intandem_findings queries findings', async () => {
    // Submit a finding first
    await handleToolCall(
      'intandem_finding',
      { service: 'auth', severity: 'critical', summary: 'JWKS failing' },
      conn,
      state,
    );
    await sleep(200);

    const result = await handleToolCall('intandem_findings', {}, conn, state);
    const text = getResultText(result);
    expect(text).toContain('Findings');
    expect(text).toContain('auth');
  });

  it('intandem_findings filters by severity', async () => {
    await handleToolCall('intandem_finding', { service: 'svc1', severity: 'info', summary: 'Info thing' }, conn, state);
    await sleep(200);

    const result = await handleToolCall('intandem_findings', { severity: 'info' }, conn, state);
    expect(getResultText(result)).toContain('INFO');
  });

  // ─── Task Results ──────────────────────────────────────────────────

  it('intandem_update_task attaches result on done', async () => {
    await handleToolCall('intandem_add_task', { title: 'Result task' }, conn, state);
    await sleep(100);

    const boardResult = await handleToolCall('intandem_board', {}, conn, state);
    const match = getResultText(boardResult).match(/\[(T-[0-9a-f]+)\]/);
    expect(match).not.toBeNull();

    await handleToolCall('intandem_claim_task', { task_id: match![1] }, conn, state);
    await sleep(100);

    const result = await handleToolCall(
      'intandem_update_task',
      { task_id: match![1], status: 'done', result: 'Fixed the issue by updating pool config' },
      conn,
      state,
    );
    expect(getResultText(result)).toContain('done');
    expect(getResultText(result)).toContain('result attached');
  });

  it('intandem_board shows task results', async () => {
    await handleToolCall('intandem_add_task', { title: 'Board result task' }, conn, state);
    await sleep(100);

    const boardResult = await handleToolCall('intandem_board', {}, conn, state);
    const match = getResultText(boardResult).match(/\[(T-[0-9a-f]+)\].*Board result task/);
    expect(match).not.toBeNull();

    await handleToolCall('intandem_claim_task', { task_id: match![1] }, conn, state);
    await sleep(100);
    await handleToolCall(
      'intandem_update_task',
      { task_id: match![1], status: 'done', result: 'Pool config updated to 20 connections' },
      conn,
      state,
    );
    await sleep(100);

    const board2 = await handleToolCall('intandem_board', {}, conn, state);
    const text = getResultText(board2);
    expect(text).toContain('Result: Pool config updated to 20 connections');
  });

  // ─── Activity Log ──────────────────────────────────────────────────

  it('intandem_activity_log returns entries', async () => {
    // Generate some activity
    await handleToolCall('intandem_add_task', { title: 'Log this' }, conn, state);
    await sleep(100);

    const result = await handleToolCall('intandem_activity_log', {}, conn, state);
    const text = getResultText(result);
    expect(text).toContain('Activity Log');
    expect(text).toContain('joined');
  });

  // ─── Peers ───────────────────────────────────────────────────────

  it('intandem_peers shows connection health', async () => {
    const result = await handleToolCall('intandem_peers', {}, conn, state);
    const text = getResultText(result);
    expect(text).toContain('Online peers');
    expect(text).toContain('Connection health');
  });

  // ─── Leave ───────────────────────────────────────────────────────

  it('intandem_leave disconnects and shows session summary', async () => {
    // Do some work first
    await handleToolCall('intandem_send', { type: 'status', message: 'working' }, conn, state);
    await handleToolCall('intandem_add_task', { title: 'Summary task' }, conn, state);

    const result = await handleToolCall('intandem_leave', {}, conn, state);
    const text = getResultText(result);
    expect(text).toContain('Disconnected');
    expect(text).toContain('Session Summary');
    expect(text).toContain('Duration');
    expect(text).toContain('Messages sent');
    expect(conn.connected).toBe(false);
  });
});
