import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { TaskItem } from '../shared/types.js';

const DATA_DIR = join(homedir(), '.tandem', 'data');

export class TandemDB {
  private db: Database.Database;

  constructor(workspaceId: string) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    // Sanitize workspace ID for filename
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
        assignee TEXT,
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
    `);
  }

  // Task operations
  createTask(task: TaskItem): void {
    this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, assignee, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.title, task.description ?? null, task.status, task.assignee ?? null, task.createdBy, task.createdAt, task.updatedAt);
  }

  updateTask(id: string, updates: Partial<Pick<TaskItem, 'status' | 'assignee' | 'title' | 'description'>>): TaskItem | null {
    const task = this.getTask(id);
    if (!task) return null;

    const now = Date.now();
    if (updates.status !== undefined) {
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(updates.status, now, id);
    }
    if (updates.assignee !== undefined) {
      this.db.prepare('UPDATE tasks SET assignee = ?, updated_at = ? WHERE id = ?').run(updates.assignee, now, id);
    }
    if (updates.title !== undefined) {
      this.db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?').run(updates.title, now, id);
    }
    if (updates.description !== undefined) {
      this.db.prepare('UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?').run(updates.description ?? null, now, id);
    }
    return this.getTask(id);
  }

  getTask(id: string): TaskItem | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignee: row.assignee,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getAllTasks(): TaskItem[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignee: row.assignee,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Message log (recent messages for context when a new peer joins)
  logMessage(msg: { type: string; from: string; to?: string; content: string; timestamp: number }): void {
    this.db.prepare(`
      INSERT INTO messages (type, from_user, to_user, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(msg.type, msg.from, msg.to ?? null, msg.content, msg.timestamp);

    // Keep only last 100 messages
    this.db.prepare(`
      DELETE FROM messages WHERE id NOT IN (
        SELECT id FROM messages ORDER BY id DESC LIMIT 100
      )
    `).run();
  }

  getRecentMessages(limit = 20): Array<{ type: string; from: string; to?: string; content: string; timestamp: number }> {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit) as any[];
    return rows.reverse().map(row => ({
      type: row.type,
      from: row.from_user,
      to: row.to_user ?? undefined,
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  close(): void {
    this.db.close();
  }
}
