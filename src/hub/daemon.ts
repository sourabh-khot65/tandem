/**
 * Hub daemon — standalone process that survives MCP channel reconnects.
 * Spawned detached by hub-lifecycle, manages TandemHub + cloudflared tunnel.
 *
 * Invoked via: node cli.js hub-daemon create --name <n> [--max-peers <n>]
 *              node cli.js hub-daemon adopt --workspace-id <id> --token <t> --name <n>
 */
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TandemHub } from './server.js';
import { openTunnel, type TunnelHandle } from '../shared/tunnel.js';
import { generateInviteCode } from '../shared/crypto.js';
import { HUB_FILE, type HubDaemonInfo } from '../shared/hub-lifecycle.js';

const CONFIG_DIR = join(homedir(), '.tandem');
const IDLE_TIMEOUT = 10 * 60_000; // auto-shutdown after 10 min with no peers
const MAX_TUNNEL_RETRIES = 5;
const TUNNEL_RETRY_DELAY = 5_000;

function log(msg: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [hub-daemon] ${msg}\n`);
}

function writeHubFile(info: HubDaemonInfo): void {
  writeFileSync(HUB_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
}

function removeHubFile(): void {
  try {
    unlinkSync(HUB_FILE);
  } catch {
    /* already gone */
  }
}

async function manageTunnel(port: number, info: HubDaemonInfo, retryCount = 0): Promise<TunnelHandle | null> {
  try {
    const tunnel = await openTunnel(port);
    log(`Tunnel open: ${tunnel.url}`);
    info.tunnelUrl = tunnel.url;
    writeHubFile(info);

    tunnel.on('close', () => {
      log('Tunnel closed, attempting to reopen...');
      info.tunnelUrl = undefined;
      writeHubFile(info);
      const next = retryCount + 1;
      if (next <= MAX_TUNNEL_RETRIES) {
        setTimeout(() => {
          manageTunnel(port, info, next).catch(() => {
            log(`Tunnel reopen failed after ${next} retries — local-only mode`);
          });
        }, TUNNEL_RETRY_DELAY * next);
      } else {
        log(`Tunnel reopen exhausted ${MAX_TUNNEL_RETRIES} retries — local-only mode`);
      }
    });

    return tunnel;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Tunnel attempt ${retryCount + 1} failed: ${message}`);
    if (retryCount < MAX_TUNNEL_RETRIES) {
      await new Promise<void>((r) => setTimeout(r, TUNNEL_RETRY_DELAY));
      return manageTunnel(port, info, retryCount + 1);
    }
    return null;
  }
}

export interface DaemonArgs {
  mode: 'create' | 'adopt';
  name: string;
  maxPeers: number;
  workspaceId?: string;
  token?: string;
}

export function parseDaemonArgs(argv: string[]): DaemonArgs {
  const mode = argv[0] === 'adopt' ? ('adopt' as const) : ('create' as const);
  const rest = argv.slice(1);
  const getFlag = (flag: string): string | undefined => {
    const idx = rest.indexOf(flag);
    return idx >= 0 && idx + 1 < rest.length ? rest[idx + 1] : undefined;
  };
  return {
    mode,
    name: getFlag('--name') ?? 'intandem-session',
    maxPeers: Math.min(parseInt(getFlag('--max-peers') ?? '5', 10), 5),
    workspaceId: getFlag('--workspace-id'),
    token: getFlag('--token'),
  };
}

export async function startHubDaemon(opts: DaemonArgs): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  log(`Starting in ${opts.mode} mode: "${opts.name}" (max ${opts.maxPeers} peers)`);

  const hub = new TandemHub();
  let workspaceId: string;
  let token: string;

  if (opts.mode === 'adopt' && opts.workspaceId && opts.token) {
    workspaceId = opts.workspaceId;
    token = opts.token;
    hub.adoptWorkspace(workspaceId, opts.name, token, opts.maxPeers);
    log(`Adopted workspace ${workspaceId}`);
  } else {
    const ws = hub.createWorkspace(opts.name, opts.maxPeers);
    workspaceId = ws.workspaceId;
    token = ws.token;
    log(`Created workspace ${workspaceId}`);
  }

  const { port } = await hub.start({ port: 0, host: '127.0.0.1' });
  log(`Hub listening on port ${port}`);

  const inviteCode = generateInviteCode();
  hub.registerInviteCode(workspaceId, inviteCode);

  const info: HubDaemonInfo = {
    pid: process.pid,
    port,
    localUrl: `ws://127.0.0.1:${port}`,
    workspaceId,
    workspaceName: opts.name,
    token,
    inviteCode,
    startedAt: Date.now(),
    maxPeers: opts.maxPeers,
  };

  writeHubFile(info);
  log('Hub file written');

  // Start tunnel in background — don't block the daemon startup
  let tunnel: TunnelHandle | null = null;
  if (process.env.INTANDEM_NO_TUNNEL) {
    log('Tunnel disabled via INTANDEM_NO_TUNNEL');
  } else {
    manageTunnel(port, info)
      .then((t) => {
        tunnel = t;
      })
      .catch(() => {
        log('All tunnel attempts failed — local-only mode');
      });
  }

  // Idle shutdown: no peers for IDLE_TIMEOUT → exit
  let idleStart: number | null = Date.now();
  const idleCheck = setInterval(() => {
    if (hub.totalPeerCount === 0) {
      if (!idleStart) idleStart = Date.now();
      else if (Date.now() - idleStart > IDLE_TIMEOUT) {
        log(`No peers for ${IDLE_TIMEOUT / 60_000} minutes, shutting down`);
        cleanup();
      }
    } else {
      idleStart = null;
    }
  }, 30_000);

  // Periodic hubfile refresh (tunnel URL can change)
  const refreshInterval = setInterval(() => {
    info.tunnelUrl = tunnel?.url;
    writeHubFile(info);
  }, 30_000);

  const cleanup = () => {
    log('Shutting down...');
    clearInterval(idleCheck);
    clearInterval(refreshInterval);
    if (tunnel) tunnel.close();
    hub.stop();
    removeHubFile();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  log('Hub daemon ready');
}
