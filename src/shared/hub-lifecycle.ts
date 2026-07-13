import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = join(homedir(), '.tandem');
export const HUB_FILE = join(CONFIG_DIR, 'hub.json');

export interface HubDaemonInfo {
  pid: number;
  port: number;
  localUrl: string;
  tunnelUrl?: string;
  workspaceId: string;
  workspaceName: string;
  token: string;
  inviteCode: string;
  startedAt: number;
  maxPeers: number;
  dashboardUrl?: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function findRunningHub(): HubDaemonInfo | null {
  try {
    if (!existsSync(HUB_FILE)) return null;
    const data = JSON.parse(readFileSync(HUB_FILE, 'utf-8')) as HubDaemonInfo;
    if (!isProcessAlive(data.pid)) {
      try {
        unlinkSync(HUB_FILE);
      } catch {
        /* already gone */
      }
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function spawnHub(opts: {
  name: string;
  maxPeers?: number;
  adopt?: { workspaceId: string; token: string };
}): Promise<HubDaemonInfo> {
  const existing = findRunningHub();
  if (existing) {
    stopHub();
    await new Promise<void>((r) => setTimeout(r, 1000));
  }
  try {
    unlinkSync(HUB_FILE);
  } catch {
    /* already gone */
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Resolve cli.js — works both from dist/ (production) and src/ (vitest)
  const candidate = join(__dirname, '..', 'cli.js');
  const cliPath = existsSync(candidate) ? candidate : join(__dirname, '..', '..', 'dist', 'cli.js');

  const cliArgs = ['hub-daemon'];
  if (opts.adopt) {
    cliArgs.push('adopt', '--workspace-id', opts.adopt.workspaceId, '--token', opts.adopt.token);
  } else {
    cliArgs.push('create');
  }
  cliArgs.push('--name', opts.name, '--max-peers', String(opts.maxPeers ?? 5));

  const logFile = join(CONFIG_DIR, 'hub.log');
  const logFd = openSync(logFile, 'a');

  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);

  // Phase 1: Wait for hubfile (daemon ready)
  let info: HubDaemonInfo | null = null;
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    await new Promise<void>((r) => setTimeout(r, 200));
    info = findRunningHub();
    if (info) break;
  }
  if (!info) throw new Error('Hub daemon failed to start within 30 seconds');

  // Phase 2: Brief wait for tunnel URL (daemon starts tunnel in background)
  if (!info.tunnelUrl && !process.env.INTANDEM_NO_TUNNEL) {
    const tStart = Date.now();
    while (Date.now() - tStart < 5_000) {
      await new Promise<void>((r) => setTimeout(r, 500));
      const updated = findRunningHub();
      if (updated?.tunnelUrl) {
        info = updated;
        break;
      }
    }
  }

  return info;
}

export function stopHub(): boolean {
  const info = findRunningHub();
  if (!info) return false;
  try {
    process.kill(info.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
