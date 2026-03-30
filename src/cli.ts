#!/usr/bin/env node
import { startChannelServer } from './channel/server.js';
import { generateUsername } from './shared/names.js';
import { saveUsername, loadUsername } from './shared/config.js';
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
  let mcpConfig: any = {};

  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // Start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  mcpConfig.mcpServers.intandem = {
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

function printHelp(): void {
  printBanner();
  console.log(`  Setup:`);
  console.log();
  console.log(`    intandem init                Add InTandem to .mcp.json in current directory`);
  console.log(`    intandem whoami              Show your username`);
  console.log(`    intandem rename <name>       Change your username`);
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
