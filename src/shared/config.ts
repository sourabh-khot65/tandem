import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.tandem');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const USERNAME_FILE = join(CONFIG_DIR, 'username');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveWorkspaceConfig(config: WorkspaceConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function loadWorkspaceConfig(): WorkspaceConfig | null {
  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function clearWorkspaceConfig(): void {
  try {
    const { unlinkSync } = require('node:fs');
    unlinkSync(CONFIG_FILE);
  } catch {
    // already gone
  }
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
