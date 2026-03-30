#!/usr/bin/env node
import { TandemHub } from './hub/server.js';
import { startChannelServer } from './channel/server.js';
import { generateUsername } from './shared/names.js';
import { decodeJoinCode, createJoinCode } from './shared/crypto.js';
import {
  saveWorkspaceConfig,
  loadWorkspaceConfig,
  clearWorkspaceConfig,
  saveUsername,
  loadUsername,
  getConfigDir,
} from './shared/config.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function printBanner(): void {
  console.log(`
  ╔════════════════════════════════╗
  ║          T A N D E M           ║
  ║   Pair Programming for Claude  ║
  ╚════════════════════════════════╝
`);
}

async function cmdCreate(): Promise<void> {
  printBanner();
  const name = parseFlag('--name') ?? 'tandem-session';
  const port = parseInt(parseFlag('--port') ?? '9900', 10);
  const maxPeers = parseInt(parseFlag('--max-peers') ?? '5', 10);
  const host = parseFlag('--host') ?? '127.0.0.1';
  const username = getOrCreateUsername();

  console.log(`  Creating workspace "${name}"...`);
  console.log(`  Your username: ${username}`);
  console.log();

  const hub = new TandemHub();
  const { workspaceId, token } = hub.createWorkspace(name, maxPeers);
  const { port: actualPort, joinCodes } = await hub.start({ port, host });

  const hubUrl = `ws://${host}:${actualPort}`;
  const joinCode = createJoinCode(hubUrl, workspaceId, token);

  // Save config so the channel server can connect
  saveWorkspaceConfig({
    hubUrl,
    workspaceId,
    token,
    username,
    workspaceName: name,
  });

  // Write .mcp.json in current directory
  writeMcpConfig();

  console.log(`  ✓ Hub running on ${host}:${actualPort}`);
  console.log(`  ✓ Workspace: ${workspaceId}`);
  console.log();
  console.log(`  ┌──────────────────────────────────────────┐`);
  console.log(`  │  Share this code with your team:          │`);
  console.log(`  │                                          │`);
  console.log(`  │  ${joinCode}`);
  console.log(`  │                                          │`);
  console.log(`  │  They run: tandem join <code>             │`);
  console.log(`  └──────────────────────────────────────────┘`);
  console.log();
  console.log(`  ✓ .mcp.json configured`);
  console.log(`  ✓ Start Claude Code with: claude --dangerously-load-development-channels server:tandem`);
  console.log();
  console.log(`  Waiting for peers... (0/${maxPeers} slots)`);
  console.log(`  Press Ctrl+C to stop the hub.`);

  process.on('SIGINT', () => {
    console.log('\n  Shutting down hub...');
    hub.stop();
    process.exit(0);
  });
}

async function cmdJoin(): Promise<void> {
  printBanner();
  const code = args[1];
  if (!code) {
    console.error('  Usage: tandem join <code>');
    console.error('  Get the join code from whoever created the workspace.');
    process.exit(1);
  }

  const decoded = decodeJoinCode(code);
  if (!decoded) {
    console.error('  Invalid join code. Check with the workspace creator.');
    process.exit(1);
  }

  const username = getOrCreateUsername();

  saveWorkspaceConfig({
    hubUrl: decoded.hubUrl,
    workspaceId: decoded.workspaceId,
    token: decoded.token,
    username,
    workspaceName: 'tandem-session',
  });

  writeMcpConfig();

  console.log(`  ✓ Joined workspace`);
  console.log(`  ✓ Hub: ${decoded.hubUrl}`);
  console.log(`  ✓ Your username: ${username}`);
  console.log(`  ✓ .mcp.json configured`);
  console.log();
  console.log(`  Start Claude Code with:`);
  console.log(`  claude --dangerously-load-development-channels server:tandem`);
}

function cmdStatus(): void {
  printBanner();
  const config = loadWorkspaceConfig();
  if (!config) {
    console.log('  Not connected to any workspace.');
    console.log('  Run "tandem create" or "tandem join <code>" to get started.');
    return;
  }

  console.log(`  Workspace: ${config.workspaceName}`);
  console.log(`  Hub: ${config.hubUrl}`);
  console.log(`  Username: ${config.username}`);
  console.log(`  Workspace ID: ${config.workspaceId}`);
  console.log(`  Config dir: ${getConfigDir()}`);
}

function cmdLeave(): void {
  printBanner();
  clearWorkspaceConfig();
  console.log('  ✓ Disconnected from workspace.');
  console.log('  .mcp.json entry remains — remove it manually if needed.');
}

function cmdWhoami(): void {
  const username = getOrCreateUsername();
  console.log(username);
}

function cmdRename(): void {
  const newName = args[1];
  if (!newName) {
    console.error('Usage: tandem rename <new-username>');
    process.exit(1);
  }
  saveUsername(newName);

  // Also update workspace config if exists
  const config = loadWorkspaceConfig();
  if (config) {
    config.username = newName;
    saveWorkspaceConfig(config);
  }

  console.log(`  ✓ Username changed to: ${newName}`);
}

async function cmdChannel(): Promise<void> {
  // This is invoked by Claude Code as the MCP server subprocess
  await startChannelServer();
}

function writeMcpConfig(): void {
  const mcpPath = join(process.cwd(), '.mcp.json');
  let mcpConfig: any = {};

  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // Start fresh if corrupted
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  // Point to the tandem channel server
  mcpConfig.mcpServers.tandem = {
    command: 'npx',
    args: ['tandem-pair', 'channel'],
  };

  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
}

function printHelp(): void {
  printBanner();
  console.log(`  Commands:`);
  console.log();
  console.log(`    tandem create [options]     Create & host a workspace`);
  console.log(`      --name <name>             Workspace name (default: tandem-session)`);
  console.log(`      --port <port>             Hub port (default: 9900)`);
  console.log(`      --host <host>             Hub host (default: 127.0.0.1)`);
  console.log(`      --max-peers <n>           Max peers (default: 5, max: 5)`);
  console.log();
  console.log(`    tandem join <code>          Join a workspace using a share code`);
  console.log(`    tandem status               Show current workspace info`);
  console.log(`    tandem leave                Disconnect from workspace`);
  console.log(`    tandem whoami               Show your username`);
  console.log(`    tandem rename <name>        Change your username`);
  console.log(`    tandem channel              (internal) Start MCP channel server`);
  console.log();
}

// Route commands
switch (command) {
  case 'create':
    cmdCreate();
    break;
  case 'join':
    cmdJoin();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'leave':
    cmdLeave();
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
