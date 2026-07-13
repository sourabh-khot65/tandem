#!/usr/bin/env node
import { startChannelServer } from './channel/server.js';
import { generateUsername } from './shared/names.js';
import { saveUsername, loadUsername, clearWorkspaceConfig, cleanStaleSessions } from './shared/config.js';
import { findRunningHub, stopHub } from './shared/hub-lifecycle.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

function printBanner(): void {
  console.log(`
  ╔════════════════════════════════════╗
  ║        I N   T A N D E M          ║
  ║   Pair Programming for Claude Code ║
  ╚════════════════════════════════════╝
`);
}

function cmdInit(): void {
  printBanner();
  const username = getOrCreateUsername();

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

  (mcpConfig.mcpServers as Record<string, unknown>).intandem = {
    command: 'npx',
    args: ['intandem', 'channel'],
  };

  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');

  console.log(`  ✓ Your username: ${username}`);
  console.log(`  ✓ .mcp.json configured`);
  console.log();
  console.log(`  Now start Claude Code:`);
  console.log(`  claude --dangerously-load-development-channels server:intandem`);
  console.log();
  console.log(`  Then inside Claude, say:`);
  console.log(`  "Create an intandem workspace called fix-auth-bug"`);
  console.log(`  or`);
  console.log(`  "Join this intandem workspace: <paste join code>"`);
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
  console.log(`  ✓ Username changed to: ${newName}`);
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
        console.log('  ✓ Hub daemon stopped.');
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
        console.log('  No hub daemon running. Start one with: intandem init');
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
      console.log(`  Usage:`);
      console.log(`    intandem hub status          Show running hub daemon info`);
      console.log(`    intandem hub stop            Stop the hub daemon`);
      console.log(`    intandem hub logs            Show recent hub daemon logs`);
      console.log(`    intandem hub dashboard       Open the workspace dashboard in a browser`);
      break;
  }
}

function printHelp(): void {
  printBanner();
  console.log(`  Setup:`);
  console.log();
  console.log(`    intandem init                Add InTandem to .mcp.json in current directory`);
  console.log(`    intandem whoami              Show your username`);
  console.log(`    intandem rename <name>       Change your username`);
  console.log();
  console.log(`  Hub:`);
  console.log();
  console.log(`    intandem hub status          Show running hub daemon info`);
  console.log(`    intandem hub stop            Stop the hub daemon`);
  console.log(`    intandem hub logs            Show recent hub daemon logs`);
  console.log(`    intandem hub dashboard       Open the workspace dashboard in a browser`);
  console.log();
  console.log(`  Usage:`);
  console.log();
  console.log(`    1. Run "intandem init" in your project directory`);
  console.log(`    2. Start Claude Code with: claude --dangerously-load-development-channels server:intandem`);
  console.log(`    3. Tell Claude: "Create an intandem workspace" or "Join intandem workspace: <code>"`);
  console.log(`    4. Everything else happens inside Claude — sharing, tasks, coordination`);
  console.log();
  console.log(`  Internal:`);
  console.log();
  console.log(`    intandem channel             (used by Claude Code — don't run manually)`);
  console.log();
}

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'whoami':
    cmdWhoami();
    break;
  case 'rename':
    cmdRename();
    break;
  case 'channel':
    cmdChannel();
    break;
  case 'hub-daemon':
    cmdHubDaemon();
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
