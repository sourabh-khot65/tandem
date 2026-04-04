import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TandemDB } from '../../src/hub/db.js';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.tandem', 'data');

describe('TandemDB', () => {
  let db: TandemDB;
  const testId = `test-${randomBytes(4).toString('hex')}`;
  const dbPath = join(DATA_DIR, `${testId}.db`);

  beforeEach(() => {
    db = new TandemDB(testId);
  });

  afterEach(() => {
    db.close();
    // Cleanup test DB files
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  // ─── Tasks ───────────────────────────────────────────────────────

  describe('tasks', () => {
    it('creates and retrieves a task', () => {
      db.createTask({
        id: 'T-001',
        title: 'Test task',
        description: 'A description',
        status: 'open',
        priority: 'high',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });

      const task = db.getTask('T-001');
      expect(task).not.toBeNull();
      expect(task!.title).toBe('Test task');
      expect(task!.description).toBe('A description');
      expect(task!.status).toBe('open');
      expect(task!.priority).toBe('high');
      expect(task!.createdBy).toBe('alice');
    });

    it('returns null for non-existent task', () => {
      expect(db.getTask('T-nope')).toBeNull();
    });

    it('creates task with dependencies', () => {
      db.createTask({
        id: 'T-parent',
        title: 'Parent',
        status: 'open',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });
      db.createTask({
        id: 'T-child',
        title: 'Child',
        status: 'blocked',
        dependsOn: ['T-parent'],
        createdBy: 'alice',
        createdAt: 1001,
        updatedAt: 1001,
      });

      const child = db.getTask('T-child');
      expect(child!.status).toBe('blocked');
      expect(child!.dependsOn).toEqual(['T-parent']);
    });

    it('updates task status', () => {
      db.createTask({
        id: 'T-002',
        title: 'Update me',
        status: 'open',
        createdBy: 'bob',
        createdAt: 1000,
        updatedAt: 1000,
      });

      const updated = db.updateTask('T-002', { status: 'in_progress' });
      expect(updated!.status).toBe('in_progress');
      expect(updated!.updatedAt).toBeGreaterThan(1000);
    });

    it('updates task assignee', () => {
      db.createTask({
        id: 'T-003',
        title: 'Claim me',
        status: 'open',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });

      db.updateTask('T-003', { status: 'claimed', assignee: 'bob' });
      expect(db.getTask('T-003')!.assignee).toBe('bob');
    });

    it('clears assignee with empty string', () => {
      db.createTask({
        id: 'T-004',
        title: 'Unclaim me',
        status: 'claimed',
        assignee: 'bob',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });

      db.updateTask('T-004', { status: 'open', assignee: '' });
      const task = db.getTask('T-004');
      expect(task!.assignee).toBeUndefined();
      expect(task!.status).toBe('open');
    });

    it('updates priority', () => {
      db.createTask({
        id: 'T-005',
        title: 'Prioritize me',
        status: 'open',
        priority: 'low',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });

      db.updateTask('T-005', { priority: 'critical' });
      expect(db.getTask('T-005')!.priority).toBe('critical');
    });

    it('returns null when updating non-existent task', () => {
      expect(db.updateTask('T-nope', { status: 'done' })).toBeNull();
    });

    it('getAllTasks returns all tasks ordered by created_at DESC', () => {
      db.createTask({ id: 'T-a', title: 'First', status: 'open', createdBy: 'x', createdAt: 100, updatedAt: 100 });
      db.createTask({ id: 'T-b', title: 'Second', status: 'open', createdBy: 'x', createdAt: 200, updatedAt: 200 });
      db.createTask({ id: 'T-c', title: 'Third', status: 'open', createdBy: 'x', createdAt: 300, updatedAt: 300 });

      const all = db.getAllTasks();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('T-c'); // newest first
      expect(all[2].id).toBe('T-a');
    });
  });

  // ─── Messages ──────────────────────────────────────────────────────

  describe('messages', () => {
    it('logs and retrieves messages', () => {
      db.logMessage({ type: 'finding', from: 'alice', content: 'Found a bug', timestamp: 1000 });
      db.logMessage({ type: 'status', from: 'bob', to: 'alice', content: 'On it', timestamp: 2000 });

      const msgs = db.getRecentMessages(10);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].from).toBe('alice');
      expect(msgs[1].to).toBe('alice');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        db.logMessage({ type: 'chat', from: 'alice', content: `msg ${i}`, timestamp: i });
      }
      expect(db.getRecentMessages(3)).toHaveLength(3);
    });

    it('auto-prunes old messages beyond 100', () => {
      for (let i = 0; i < 110; i++) {
        db.logMessage({ type: 'chat', from: 'alice', content: `msg ${i}`, timestamp: i });
      }
      const all = db.getRecentMessages(200);
      expect(all.length).toBeLessThanOrEqual(100);
    });
  });

  // ─── Variables ─────────────────────────────────────────────────────

  describe('variables', () => {
    it('sets and gets a variable', () => {
      db.setVar('key1', 'value1', 'alice');
      const v = db.getVar('key1');
      expect(v).not.toBeNull();
      expect(v!.value).toBe('value1');
      expect(v!.setBy).toBe('alice');
    });

    it('returns null for non-existent variable', () => {
      expect(db.getVar('nope')).toBeNull();
    });

    it('upserts existing variable', () => {
      db.setVar('key1', 'old', 'alice');
      db.setVar('key1', 'new', 'bob');
      const v = db.getVar('key1');
      expect(v!.value).toBe('new');
      expect(v!.setBy).toBe('bob');
    });

    it('getAllVars returns all variables sorted by key', () => {
      db.setVar('z-var', 'z', 'alice');
      db.setVar('a-var', 'a', 'bob');
      db.setVar('m-var', 'm', 'alice');

      const vars = db.getAllVars();
      expect(vars).toHaveLength(3);
      expect(vars[0].key).toBe('a-var');
      expect(vars[2].key).toBe('z-var');
    });
  });

  // ─── Activity Log ──────────────────────────────────────────────────

  describe('activity log', () => {
    it('logs and retrieves activity', () => {
      db.logActivity('alice', 'joined');
      db.logActivity('bob', 'task_create', '[T-001] Fix bug');

      const log = db.getActivityLog(10);
      expect(log).toHaveLength(2);
      expect(log[0].actor).toBe('alice');
      expect(log[0].action).toBe('joined');
      expect(log[1].actor).toBe('bob');
      expect(log[1].detail).toBe('[T-001] Fix bug');
    });

    it('returns in chronological order', () => {
      db.logActivity('first', 'a');
      db.logActivity('second', 'b');
      db.logActivity('third', 'c');

      const log = db.getActivityLog(10);
      expect(log[0].actor).toBe('first');
      expect(log[2].actor).toBe('third');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        db.logActivity('user', `action-${i}`);
      }
      expect(db.getActivityLog(3)).toHaveLength(3);
    });

    it('auto-prunes beyond 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        db.logActivity('user', `action-${i}`);
      }
      const log = db.getActivityLog(300);
      expect(log.length).toBeLessThanOrEqual(200);
    });
  });

  // ─── Task Results ──────────────────────────────────────────────────

  describe('task results', () => {
    it('creates a task with result', () => {
      db.createTask({
        id: 'T-res1',
        title: 'Task with result',
        status: 'done',
        result: '58 insurance records missing',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });
      const task = db.getTask('T-res1');
      expect(task!.result).toBe('58 insurance records missing');
    });

    it('updates task with result on completion', () => {
      db.createTask({
        id: 'T-res2',
        title: 'Complete me',
        status: 'in_progress',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });
      db.updateTask('T-res2', { status: 'done', result: 'Fixed the Redis pool config' });
      const task = db.getTask('T-res2');
      expect(task!.status).toBe('done');
      expect(task!.result).toBe('Fixed the Redis pool config');
    });

    it('result is undefined when not set', () => {
      db.createTask({
        id: 'T-res3',
        title: 'No result',
        status: 'open',
        createdBy: 'alice',
        createdAt: 1000,
        updatedAt: 1000,
      });
      expect(db.getTask('T-res3')!.result).toBeUndefined();
    });
  });

  // ─── Findings ──────────────────────────────────────────────────────

  describe('findings', () => {
    it('creates and retrieves a finding', () => {
      db.createFinding({
        id: 'F-001',
        service: 'payment-service',
        severity: 'high',
        summary: 'Insurance records not found for legacy lab groups',
        category: 'data_missing',
        count: 58,
        patterns: [{ pattern: 'Insurance records not found', count: 58, source: 'LegacyInsuranceServiceImpl' }],
        recommendation: 'Investigate V1 data sync gap',
        reportedBy: 'alice',
        timestamp: 1000,
      });

      const findings = db.getFindings();
      expect(findings).toHaveLength(1);
      expect(findings[0].service).toBe('payment-service');
      expect(findings[0].severity).toBe('high');
      expect(findings[0].summary).toBe('Insurance records not found for legacy lab groups');
      expect(findings[0].count).toBe(58);
      expect(findings[0].patterns).toHaveLength(1);
      expect(findings[0].patterns![0].pattern).toBe('Insurance records not found');
      expect(findings[0].recommendation).toBe('Investigate V1 data sync gap');
    });

    it('creates finding with minimal fields', () => {
      db.createFinding({
        id: 'F-002',
        service: 'auth-service',
        severity: 'critical',
        summary: 'JWKS key resolution failing',
        reportedBy: 'bob',
        timestamp: 2000,
      });

      const findings = db.getFindings();
      const f = findings.find((f) => f.id === 'F-002');
      expect(f).toBeDefined();
      expect(f!.summary).toBe('JWKS key resolution failing');
      expect(f!.category).toBeUndefined();
      expect(f!.count).toBeUndefined();
      expect(f!.patterns).toBeUndefined();
    });

    it('filters by severity', () => {
      db.createFinding({
        id: 'F-hi',
        service: 'svc-a',
        severity: 'high',
        summary: 'High issue',
        reportedBy: 'alice',
        timestamp: 1000,
      });
      db.createFinding({
        id: 'F-lo',
        service: 'svc-b',
        severity: 'low',
        summary: 'Low issue',
        reportedBy: 'alice',
        timestamp: 2000,
      });

      const high = db.getFindings({ severity: 'high' });
      expect(high.every((f) => f.severity === 'high')).toBe(true);

      const low = db.getFindings({ severity: 'low' });
      expect(low.every((f) => f.severity === 'low')).toBe(true);
    });

    it('filters by service', () => {
      db.createFinding({
        id: 'F-svc1',
        service: 'payment',
        severity: 'medium',
        summary: 'Payment issue',
        reportedBy: 'alice',
        timestamp: 1000,
      });
      db.createFinding({
        id: 'F-svc2',
        service: 'order',
        severity: 'medium',
        summary: 'Order issue',
        reportedBy: 'alice',
        timestamp: 2000,
      });

      const payment = db.getFindings({ service: 'payment' });
      expect(payment.every((f) => f.service === 'payment')).toBe(true);
    });

    it('filters by both severity and service', () => {
      db.createFinding({
        id: 'F-both1',
        service: 'kit',
        severity: 'high',
        summary: 'Kit high',
        reportedBy: 'alice',
        timestamp: 1000,
      });
      db.createFinding({
        id: 'F-both2',
        service: 'kit',
        severity: 'low',
        summary: 'Kit low',
        reportedBy: 'alice',
        timestamp: 2000,
      });
      db.createFinding({
        id: 'F-both3',
        service: 'order',
        severity: 'high',
        summary: 'Order high',
        reportedBy: 'alice',
        timestamp: 3000,
      });

      const result = db.getFindings({ severity: 'high', service: 'kit' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('F-both1');
    });

    it('returns empty array when no findings match', () => {
      expect(db.getFindings({ severity: 'critical' })).toHaveLength(0);
    });

    it('links finding to task', () => {
      db.createFinding({
        id: 'F-linked',
        service: 'payment',
        severity: 'high',
        summary: 'Linked finding',
        taskId: 'T-abc123',
        reportedBy: 'alice',
        timestamp: 1000,
      });

      const findings = db.getFindings();
      const f = findings.find((f) => f.id === 'F-linked');
      expect(f!.taskId).toBe('T-abc123');
    });

    it('returns findings ordered by timestamp DESC', () => {
      db.createFinding({
        id: 'F-old',
        service: 'svc',
        severity: 'info',
        summary: 'Old',
        reportedBy: 'alice',
        timestamp: 100,
      });
      db.createFinding({
        id: 'F-new',
        service: 'svc',
        severity: 'info',
        summary: 'New',
        reportedBy: 'alice',
        timestamp: 200,
      });

      const findings = db.getFindings();
      const oldIdx = findings.findIndex((f) => f.id === 'F-old');
      const newIdx = findings.findIndex((f) => f.id === 'F-new');
      expect(newIdx).toBeLessThan(oldIdx);
    });
  });
});
