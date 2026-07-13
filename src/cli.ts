#!/usr/bin/env node
import { startChannelServer } from './channel/server.js';
import { generateUsername } from './shared/names.js';
import {
  saveUsername,
  loadUsername,
  saveWorkspaceConfig,
  clearWorkspaceConfig,
  cleanStaleSessions,
} from './shared/config.js';
import { findRunningHub, spawnHub, stopHub } from './shared/hub-lifecycle.js';
import { parseInvite, createShortInvite } from './shared/crypto.js';
import { resolveShortCode, validateConnection } from './shared/invite.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0];

function getOrCreateUsername(): string {
  let username = loadUsername();
  if (!username) {
    username = generateUsername();
    saveUsername(username);
  }
  return username;
}

function ensureMcpJson(): void {
  const mcpPath = join(process.cwd(), '.mcp.json');
  let mcpConfig: Record<string, unknown> = {};

  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // Start fresh
    }
  }

  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
    mcpConfig.mcpServers = {};
  }

  const servers = mcpConfig.mcpServers as Record<string, unknown>;
  if (!servers.intandem) {
    servers.intandem = {
      command: 'npx',
      args: ['intandem', 'channel'],
    };
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    console.log('  .mcp.json configured');
  }
}

function printClaude(): void {
  console.log();
  console.log('  Start Claude Code with InTandem enabled:');
  console.log('    claude --dangerously-load-development-channels server:intandem');
}

async function cmdStart(): Promise<void> {
  const username = getOrCreateUsername();
  ensureMcpJson();

  // Idempotent: if hub already running, just print info
  const existing = findRunningHub();
  if (existing) {
    const shortInvite = createShortInvite(existing.inviteCode, existing.tunnelUrl);
    const dashboardUrl =
      existing.dashboardUrl ??
      `http://127.0.0.1:${existing.port}/dashboard?token=${encodeURIComponent(existing.token)}`;

    console.log();
    console.log(`  Workspace "${existing.workspaceName}" already running.`);
    console.log();
    console.log(`  Join code:  ${shortInvite}`);
    console.log(`  Dashboard:  ${dashboardUrl}`);
    printClaude();
    console.log();
    return;
  }

  const name = args[1] ?? basename(process.cwd());
  console.log(`  Starting workspace "${name}"...`);

  const info = await spawnHub({ name });

  saveWorkspaceConfig({
    hubUrl: info.tunnelUrl ?? info.localUrl,
    localUrl: info.localUrl,
    workspaceId: info.workspaceId,
    token: info.token,
    username,
    workspaceName: name,
    isCreator: true,
    maxPeers: info.maxPeers,
  });

  const shortInvite = createShortInvite(info.inviteCode, info.tunnelUrl);
  const dashboardUrl =
    info.dashboardUrl ?? `http://127.0.0.1:${info.port}/dashboard?token=${encodeURIComponent(info.token)}`;

  console.log();
  console.log(`  Workspace "${name}" started.`);
  console.log();
  console.log(`  Join code:  ${shortInvite}`);
  console.log(`  Dashboard:  ${dashboardUrl}`);
  printClaude();
  console.log();
  console.log('  Share the join code with teammates. They run:');
  console.log(`    intandem join ${shortInvite}`);
  console.log();
}

async function cmdJoin(): Promise<void> {
  const code = args[1];
  if (!code) {
    console.error('  Usage: intandem join <code>');
    process.exit(1);
  }

  const username = getOrCreateUsername();
  ensureMcpJson();

  const invite = parseInvite(code);
  if (!invite) {
    console.error('  Invalid invite code. Ask your teammate for a new one.');
    process.exit(1);
  }

  let hubUrl: string;
  let workspaceId: string;
  let token: string;

  if (invite.type === 'full') {
    hubUrl = invite.hubUrl;
    workspaceId = invite.workspaceId;
    token = invite.token;
  } else {
    // Short code — resolve via hub
    const urlsToTry: string[] = [];
    if (invite.host) {
      urlsToTry.push(`wss://${invite.host}`, `ws://${invite.host}`);
    }
    const daemon = findRunningHub();
    if (daemon?.localUrl) {
      urlsToTry.push(daemon.localUrl);
    }

    if (urlsToTry.length === 0) {
      console.error('  Short code needs a hub to resolve against.');
      console.error('  Use the full join code, or ensure the hub is running locally.');
      process.exit(1);
    }

    let resolved: { workspaceId: string; token: string } | null = null;
    for (const url of urlsToTry) {
      resolved = await resolveShortCode(url, invite.code);
      if (resolved) {
        hubUrl = url;
        break;
      }
    }

    if (!resolved) {
      console.error('  Could not resolve invite code. The hub may be offline.');
      console.error('  Ask your teammate for a new code or try again later.');
      process.exit(1);
    }

    hubUrl = hubUrl!;
    workspaceId = resolved.workspaceId;
    token = resolved.token;
  }

  // Validate by connecting — exchanges one-time ticket for real token
  const result = await validateConnection(hubUrl, token, username);
  if (result) {
    token = result.token;
  }

  saveWorkspaceConfig({
    hubUrl,
    localUrl: hubUrl.startsWith('ws://127.0.0.1') ? hubUrl : undefined,
    workspaceId,
    token,
    username,
    workspaceName: result?.workspaceName ?? 'unknown',
  });

  if (result) {
    const peerCount = result.peers.length;
    const peerStr = peerCount === 1 ? '1 peer online' : `${peerCount} peers online`;
    console.log();
    console.log(`  Joined workspace "${result.workspaceName}" (${peerStr}).`);
  } else {
    console.log();
    console.log('  Saved join config (hub unreachable — will retry on connect).');
  }

  printClaude();
  console.log();
}

function cmdWhoami(): void {
  console.log(getOrCreateUsername());
}

function cmdRename(): void {
  const newName = args[1];
  if (!newName) {
    console.error('Usage: intandem rename <new-username>');
    process.exit(1);
  }
  saveUsername(newName);
  console.log(`  Username changed to: ${newName}`);
}

async function cmdChannel(): Promise<void> {
  await startChannelServer();
}

async function cmdHubDaemon(): Promise<void> {
  const { parseDaemonArgs, startHubDaemon } = await import('./hub/daemon.js');
  const daemonArgs = parseDaemonArgs(args.slice(1));
  await startHubDaemon(daemonArgs);
}

function cmdHub(): void {
  const sub = args[1];
  switch (sub) {
    case 'status': {
      const info = findRunningHub();
      if (!info) {
        console.log('  No hub daemon running.');
        return;
      }
      const uptime = Math.floor((Date.now() - info.startedAt) / 1000);
      const uptimeStr =
        uptime >= 3600
          ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
          : uptime >= 60
            ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
            : `${uptime}s`;
      console.log(`  Hub daemon running (PID ${info.pid})`);
      console.log(`  Workspace: ${info.workspaceName} (${info.workspaceId})`);
      console.log(`  Local:     ${info.localUrl}`);
      console.log(`  Tunnel:    ${info.tunnelUrl ?? 'none (local-only mode)'}`);
      console.log(
        `  Dashboard: ${info.dashboardUrl ?? `http://127.0.0.1:${info.port}/dashboard?token=${encodeURIComponent(info.token)}`}`,
      );
      console.log(`  Uptime:    ${uptimeStr}`);
      console.log(`  Max peers: ${info.maxPeers}`);
      break;
    }
    case 'stop': {
      const stopped = stopHub();
      if (stopped) {
        console.log('  Hub daemon stopped.');
      } else {
        console.log('  No hub daemon running.');
      }
      break;
    }
    case 'log':
    case 'logs': {
      const logPath = join(process.env.HOME ?? '', '.tandem', 'hub.log');
      if (!existsSync(logPath)) {
        console.log('  No hub log file found.');
        return;
      }
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split('\n');
      const tail = lines.slice(-50).join('\n');
      console.log(tail);
      break;
    }
    case 'dashboard': {
      const info = findRunningHub();
      if (!info) {
        console.log('  No hub daemon running. Start one with: intandem start');
        return;
      }
      const url =
        info.dashboardUrl ?? `http://127.0.0.1:${info.port}/dashboard?token=${encodeURIComponent(info.token)}`;
      console.log(`  Opening dashboard: ${url}`);
      const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(openCmd, [url], { detached: true, stdio: 'ignore' }).unref();
      break;
    }
    default:
      console.log('  Usage:');
      console.log('    intandem hub status          Show running hub daemon info');
      console.log('    intandem hub stop            Stop the hub daemon');
      console.log('    intandem hub logs            Show recent hub daemon logs');
      console.log('    intandem hub dashboard       Open the workspace dashboard in a browser');
      break;
  }
}

function printHelp(): void {
  console.log(`
  I N   T A N D E M
  Pair programming for Claude Code
`);
  console.log('  Commands:');
  console.log();
  console.log('    intandem start [name]           Start a workspace (default: directory name)');
  console.log("    intandem join <code>            Join a teammate's workspace");
  console.log('    intandem hub status             Show running hub info');
  console.log('    intandem hub stop               Stop the hub');
  console.log('    intandem hub logs               Show recent hub logs');
  console.log('    intandem hub dashboard          Open dashboard in browser');
  console.log();
  console.log('  Other:');
  console.log();
  console.log('    intandem whoami                 Show your username');
  console.log('    intandem rename <name>          Change your username');
  console.log();
}

async function main(): Promise<void> {
  switch (command) {
    case 'start':
      await cmdStart();
      break;
    case 'join':
      await cmdJoin();
      break;
    case 'whoami':
      cmdWhoami();
      break;
    case 'rename':
      cmdRename();
      break;
    case 'channel':
      await cmdChannel();
      break;
    case 'hub-daemon':
      await cmdHubDaemon();
      break;
    case 'hub':
      cmdHub();
      break;
    case 'cleanup':
      clearWorkspaceConfig();
      cleanStaleSessions();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`  Error: ${message}`);
  process.exit(1);
});
