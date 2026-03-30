import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.tandem');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');
const USERNAME_FILE = join(CONFIG_DIR, 'username');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionFile(pid?: number): string {
  const id = pid ?? process.pid;
  return join(SESSIONS_DIR, `${id}.json`);
}

export function saveWorkspaceConfig(config: WorkspaceConfig): void {
  ensureConfigDir();
  writeFileSync(sessionFile(), JSON.stringify(config, null, 2));
  // Also write a "latest" pointer for backwards compat / manual rejoin
  writeFileSync(join(CONFIG_DIR, 'config.json'), JSON.stringify(config, null, 2));
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

/**
 * Find any session config that has a localUrl with the given port,
 * useful for finding the hub's actual local address from another session.
 */
export function findLocalHubConfig(): WorkspaceConfig | null {
  ensureConfigDir();
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = readFileSync(join(SESSIONS_DIR, f), 'utf-8');
        const config: WorkspaceConfig = JSON.parse(data);
        if (config.isCreator && config.localUrl) {
          return config;
        }
      } catch {
        /* skip bad files */
      }
    }
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

export function getConfigDir(): string {
  return CONFIG_DIR;
}
