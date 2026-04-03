import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { TaskItem } from '../shared/types.js';

const DATA_DIR = join(homedir(), '.tandem', 'data');

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assignee: string | null;
  depends_on: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: number;
  type: string;
  from_user: string;
  to_user: string | null;
  content: string;
  timestamp: number;
}

function rowToTask(row: TaskRow): TaskItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskItem['status'],
    priority: (row.priority as TaskItem['priority']) ?? undefined,
    assignee: row.assignee ?? undefined,
    dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TandemDB {
  private db: Database.Database;

  constructor(workspaceId: string) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const safeId = workspaceId.replace(/[^a-zA-Z0-9-]/g, '_');
    this.db = new Database(join(DATA_DIR, `${safeId}.db`));
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT DEFAULT 'medium',
        assignee TEXT,
        depends_on TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        from_user TEXT NOT NULL,
        to_user TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT
      );

      CREATE TABLE IF NOT EXISTS vars (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        set_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  createTask(task: TaskItem): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, status, priority, assignee, depends_on, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.description ?? null,
        task.status,
        task.priority ?? 'medium',
        task.assignee ?? null,
        task.dependsOn ? JSON.stringify(task.dependsOn) : null,
        task.createdBy,
        task.createdAt,
        task.updatedAt,
      );
  }

  updateTask(
    id: string,
    updates: Partial<Pick<TaskItem, 'status' | 'assignee' | 'title' | 'description' | 'priority' | 'dependsOn'>>,
  ): TaskItem | null {
    const task = this.getTask(id);
    if (!task) return null;

    const sets: string[] = [];
    const values: unknown[] = [];
    const now = Date.now();

    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.assignee !== undefined) {
      sets.push('assignee = ?');
      values.push(updates.assignee || null); // empty string clears assignee
    }
    if (updates.title !== undefined) {
      sets.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      values.push(updates.description ?? null);
    }
    if (updates.priority !== undefined) {
      sets.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.dependsOn !== undefined) {
      sets.push('depends_on = ?');
      values.push(updates.dependsOn ? JSON.stringify(updates.dependsOn) : null);
    }

    if (sets.length === 0) return task;

    sets.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getTask(id);
  }

  getTask(id: string): TaskItem | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return rowToTask(row);
  }

  getAllTasks(): TaskItem[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRow[];
    return rows.map(rowToTask);
  }

  logMessage(msg: { type: string; from: string; to?: string; content: string; timestamp: number }): void {
    this.db
      .prepare(
        `INSERT INTO messages (type, from_user, to_user, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(msg.type, msg.from, msg.to ?? null, msg.content, msg.timestamp);

    this.db
      .prepare(
        `DELETE FROM messages WHERE id NOT IN (
          SELECT id FROM messages ORDER BY id DESC LIMIT 100
        )`,
      )
      .run();
  }

  getRecentMessages(
    limit = 20,
  ): Array<{ type: string; from: string; to?: string; content: string; timestamp: number }> {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit) as MessageRow[];
    return rows.reverse().map((row) => ({
      type: row.type,
      from: row.from_user,
      to: row.to_user ?? undefined,
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  logActivity(actor: string, action: string, detail?: string): void {
    this.db
      .prepare('INSERT INTO activity_log (timestamp, actor, action, detail) VALUES (?, ?, ?, ?)')
      .run(Date.now(), actor, action, detail ?? null);
    // Keep last 200 entries
    this.db
      .prepare('DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 200)')
      .run();
  }

  getActivityLog(limit = 30): Array<{ timestamp: number; actor: string; action: string; detail?: string }> {
    const rows = this.db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit) as Array<{
      timestamp: number;
      actor: string;
      action: string;
      detail: string | null;
    }>;
    return rows.reverse().map((r) => ({
      timestamp: r.timestamp,
      actor: r.actor,
      action: r.action,
      detail: r.detail ?? undefined,
    }));
  }

  setVar(key: string, value: string, setBy: string): void {
    this.db
      .prepare(
        `INSERT INTO vars (key, value, set_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, updated_at = excluded.updated_at`,
      )
      .run(key, value, setBy, Date.now());
  }

  getVar(key: string): { value: string; setBy: string; updatedAt: number } | null {
    const row = this.db.prepare('SELECT value, set_by, updated_at FROM vars WHERE key = ?').get(key) as
      | { value: string; set_by: string; updated_at: number }
      | undefined;
    if (!row) return null;
    return { value: row.value, setBy: row.set_by, updatedAt: row.updated_at };
  }

  getAllVars(): Array<{ key: string; value: string; setBy: string; updatedAt: number }> {
    const rows = this.db.prepare('SELECT key, value, set_by, updated_at FROM vars ORDER BY key').all() as Array<{
      key: string;
      value: string;
      set_by: string;
      updated_at: number;
    }>;
    return rows.map((r) => ({ key: r.key, value: r.value, setBy: r.set_by, updatedAt: r.updated_at }));
  }

  close(): void {
    this.db.close();
  }
}
