import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.tandem');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
const USERNAME_FILE = join(CONFIG_DIR, 'username');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  }
}

function sessionFile(pid?: number): string {
  const id = pid ?? process.pid;
  return join(SESSIONS_DIR, `${id}.json`);
}

export function saveWorkspaceConfig(config: WorkspaceConfig): void {
  ensureConfigDir();
  // H3 fix: restrict file permissions — token-containing files must not be world-readable
  writeFileSync(sessionFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
  writeFileSync(join(CONFIG_DIR, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function loadWorkspaceConfig(): WorkspaceConfig | null {
  // Try our own session file first
  try {
    const data = readFileSync(sessionFile(), 'utf-8');
    return JSON.parse(data);
  } catch {
    // Fall back to global config
  }
  try {
    const data = readFileSync(join(CONFIG_DIR, 'config.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function clearWorkspaceConfig(): void {
  try {
    unlinkSync(sessionFile());
  } catch {
    /* already gone */
  }
  try {
    unlinkSync(join(CONFIG_DIR, 'config.json'));
  } catch {
    /* already gone */
  }
}

/** Remove session files whose PIDs are no longer running. */
export function cleanStaleSessions(): void {
  ensureConfigDir();
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const pid = parseInt(f.replace('.json', ''), 10);
      if (isNaN(pid)) continue;
      try {
        process.kill(pid, 0); // throws if process doesn't exist
      } catch {
        try {
          unlinkSync(join(SESSIONS_DIR, f));
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* dir doesn't exist */
  }
}

/**
 * Find the most recent creator session config with a localUrl,
 * useful for finding the hub's actual local address from another session.
 */
export function findLocalHubConfig(): WorkspaceConfig | null {
  ensureConfigDir();
  cleanStaleSessions();
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    let best: { config: WorkspaceConfig; mtime: number } | null = null;
    for (const f of files) {
      try {
        const filePath = join(SESSIONS_DIR, f);
        const data = readFileSync(filePath, 'utf-8');
        const config: WorkspaceConfig = JSON.parse(data);
        if (config.isCreator && config.localUrl) {
          const mtime = statSync(filePath).mtimeMs;
          if (!best || mtime > best.mtime) {
            best = { config, mtime };
          }
        }
      } catch {
        /* skip bad files */
      }
    }
    return best?.config ?? null;
  } catch {
    /* dir doesn't exist */
  }
  return null;
}

export function saveUsername(username: string): void {
  ensureConfigDir();
  writeFileSync(USERNAME_FILE, username);
}

export function loadUsername(): string | null {
  try {
    return readFileSync(USERNAME_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}
