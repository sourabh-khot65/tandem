import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { TandemHub } from '../hub/server.js';
import { parseInvite, createShortInvite, generateInviteCode, encryptMessage, signMessage } from '../shared/crypto.js';
import {
  saveWorkspaceConfig,
  loadWorkspaceConfig,
  clearWorkspaceConfig,
  findLocalHubConfig,
} from '../shared/config.js';
import type { PeerMessage, MessageType, TaskItem, CodeReference } from '../shared/types.js';
import type { Tunnel } from 'localtunnel';
import localtunnel from 'localtunnel';
import { HubConnection } from './connection.js';
import { VALID_TYPES } from './tools.js';

type ToolResult = { content: [{ type: 'text'; text: string }] };

function text(t: string): ToolResult {
  return { content: [{ type: 'text' as const, text: t }] };
}

export interface ChannelState {
  hub: TandemHub | null;
  tunnel: Tunnel | null;
  currentPeers: string[];
  workspaceName: string;
  myUsername: string;
  workspaceToken: string; // for E2E encryption
  inviteCode: string; // short human-readable invite code
  pendingBoardResolve: ((tasks: TaskItem[]) => void) | null;
}

/**
 * Attempt to become the new hub when the original creator disconnects.
 * Starts a new TandemHub using the existing workspace DB, opens a tunnel,
 * and connects as a peer. Returns true if promotion succeeded.
 */
export interface PromotionResult {
  ok: boolean;
  joinCode?: string; // new join code for remote peers to reconnect
}

/**
 * Attempt to become the new hub when the original creator disconnects.
 * Starts a new TandemHub using the existing workspace DB, opens a tunnel,
 * and connects as a peer. Returns the new join code so remote peers can reconnect.
 */
export async function promoteToHub(conn: HubConnection, state: ChannelState): Promise<PromotionResult> {
  const config = loadWorkspaceConfig();
  if (!config) return { ok: false };

  process.stderr.write(`[intandem] Hub appears dead. Attempting to become new hub for "${config.workspaceName}"...\n`);

  // Clean up old state
  conn.disconnect();
  if (state.tunnel) {
    state.tunnel.close();
    state.tunnel = null;
  }
  if (state.hub) {
    state.hub.stop();
    state.hub = null;
  }

  try {
    state.hub = new TandemHub();
    state.hub.adoptWorkspace(config.workspaceId, config.workspaceName, config.token, config.maxPeers ?? 5);
    const { port } = await state.hub.start({ port: 0, host: '127.0.0.1' });

    // Try to open tunnel for remote peers
    try {
      state.tunnel = await localtunnel({ port });
      process.stderr.write(`[intandem] New tunnel open: ${state.tunnel.url}\n`);
      state.tunnel.on('close', () => {
        process.stderr.write('[intandem] Tunnel closed\n');
        state.tunnel = null;
      });
    } catch {
      process.stderr.write(`[intandem] Tunnel failed, local-only mode\n`);
    }

    const localUrl = `ws://127.0.0.1:${port}`;
    saveWorkspaceConfig({
      hubUrl: localUrl,
      localUrl,
      workspaceId: config.workspaceId,
      token: config.token,
      username: state.myUsername,
      workspaceName: config.workspaceName,
      isCreator: true,
      maxPeers: config.maxPeers ?? 5,
    });

    const ok = await conn.connect(localUrl, config.token, state.myUsername);
    if (ok) {
      state.inviteCode = generateInviteCode();
      conn.send({ kind: 'invite_register', inviteCode: state.inviteCode });
      const tunnelUrl = state.tunnel?.url;
      const shortInvite = createShortInvite(state.inviteCode, tunnelUrl);
      process.stderr.write(`[intandem] Promoted to hub owner for "${config.workspaceName}"\n`);
      return { ok: true, joinCode: shortInvite };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[intandem] Hub promotion failed: ${message}\n`);
  }

  return { ok: false };
}

function waitForBoard(state: ChannelState): Promise<TaskItem[]> {
  return new Promise((resolve) => {
    state.pendingBoardResolve = resolve;
    setTimeout(() => {
      if (state.pendingBoardResolve === resolve) {
        state.pendingBoardResolve = null;
        resolve([]);
      }
    }, 3000);
  });
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  switch (name) {
    case 'intandem_create':
      return handleCreate(args, conn, state);
    case 'intandem_join':
      return handleJoin(args, conn, state);
    case 'intandem_send':
      return handleSend(args, conn, state);
    case 'intandem_board':
      return handleBoard(conn, state);
    case 'intandem_add_task':
      return handleAddTask(args, conn, state);
    case 'intandem_claim_task':
      return handleClaimTask(args, conn, state);
    case 'intandem_update_task':
      return handleUpdateTask(args, conn, state);
    case 'intandem_plan':
      return handlePlan(args, conn, state);
    case 'intandem_share':
      return handleShare(args, conn, state);
    case 'intandem_peers':
      return handlePeers(conn, state);
    case 'intandem_leave':
      return handleLeave(conn, state);
    case 'intandem_rejoin':
      return handleRejoin(conn, state);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleCreate(
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  if (conn.connected) {
    return text('Already connected to a workspace. Use intandem_leave first.');
  }
  conn.cancelReconnect();
  conn.intentionalLeave = false;

  // Clean up any orphaned hub/tunnel from a previous create
  conn.disconnect();
  if (state.tunnel) {
    state.tunnel.close();
    state.tunnel = null;
  }
  if (state.hub) {
    state.hub.stop();
    state.hub = null;
  }

  const name = (args.name as string) ?? 'intandem-session';
  const maxPeers = Math.min((args.max_peers as number) ?? 5, 5);

  state.hub = new TandemHub();
  const { workspaceId, token } = state.hub.createWorkspace(name, maxPeers);
  const { port } = await state.hub.start({ port: 0, host: '127.0.0.1' });

  let tunnelUrl = '';
  try {
    state.tunnel = await localtunnel({ port });
    tunnelUrl = state.tunnel.url;
    process.stderr.write(`[intandem] Tunnel open: ${tunnelUrl}\n`);
    state.tunnel.on('close', () => {
      process.stderr.write('[intandem] Tunnel closed — remote peers may lose access. Local connections unaffected.\n');
      state.tunnel = null;
      // Try to reopen tunnel
      localtunnel({ port })
        .then((newTunnel) => {
          state.tunnel = newTunnel;
          process.stderr.write(`[intandem] Tunnel reopened: ${newTunnel.url}\n`);
          newTunnel.on('close', () => {
            process.stderr.write('[intandem] Tunnel closed again\n');
            state.tunnel = null;
          });
        })
        .catch(() => {
          process.stderr.write('[intandem] Tunnel reopen failed — local-only mode\n');
        });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[intandem] Tunnel failed (${message}), using local-only mode\n`);
  }

  const localUrl = `ws://127.0.0.1:${port}`;
  saveWorkspaceConfig({
    hubUrl: localUrl,
    localUrl,
    workspaceId,
    token,
    username: state.myUsername,
    workspaceName: name,
    isCreator: true,
    maxPeers,
  });

  state.workspaceToken = token;
  state.inviteCode = generateInviteCode();

  const ok = await conn.connect(`ws://127.0.0.1:${port}`, token, state.myUsername);
  if (!ok) {
    return text('Failed to connect to hub. Something went wrong.');
  }

  // Register the short invite code with the hub
  conn.send({ kind: 'invite_register', inviteCode: state.inviteCode });

  const shortInvite = createShortInvite(state.inviteCode, tunnelUrl);

  const lines = [
    `Workspace "${name}" created!`,
    `Your username: ${state.myUsername}`,
    ``,
    `Share this code with teammates:`,
    ``,
    `  ${shortInvite}`,
    ``,
    `They just tell their Claude: "Join intandem workspace: ${shortInvite}"`,
    ``,
    `Messages are end-to-end encrypted.`,
    `Waiting for peers... (0/${maxPeers} slots)`,
  ];

  return text(lines.join('\n'));
}

/**
 * Resolve a short invite code by connecting to the hub and asking it.
 * Returns the decoded join info, or null if resolution fails.
 */
function resolveShortCode(hubUrl: string, inviteCode: string): Promise<{ workspaceId: string; token: string } | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(hubUrl);
    } catch {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ kind: 'invite_resolve', inviteCode }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        clearTimeout(timeout);
        if (msg.kind === 'invite_result' && msg.token) {
          ws.close();
          resolve({ workspaceId: msg.workspaceId, token: msg.token });
        } else {
          ws.close();
          resolve(null);
        }
      } catch {
        ws.close();
        resolve(null);
      }
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function handleJoin(
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  if (conn.connected) {
    return text('Already connected to a workspace. Use intandem_leave first.');
  }
  conn.cancelReconnect();
  conn.intentionalLeave = false;

  // Clean up any orphaned hub/tunnel from a previous session
  conn.disconnect();
  if (state.tunnel) {
    state.tunnel.close();
    state.tunnel = null;
  }
  if (state.hub) {
    state.hub.stop();
    state.hub = null;
  }

  const code = args.code as string;
  if (!code) {
    return text('Need a join code. Ask your teammate for it.');
  }

  const invite = parseInvite(code);
  if (!invite) {
    return text('Invalid join code. Expected a short code like "ABC123" or "ABC123@host", or a full join code.');
  }

  let hubUrl: string;
  let workspaceId: string;
  let token: string;

  if (invite.type === 'full') {
    // Full base64url join code — use directly
    hubUrl = invite.hubUrl;
    workspaceId = invite.workspaceId;
    token = invite.token;
  } else {
    // Short invite code — need to resolve via hub
    const hubUrls: string[] = [];

    if (invite.host) {
      // Has routing hint: "ABC123@host" — try wss first, then ws
      hubUrls.push(`wss://${invite.host}`, `ws://${invite.host}`);
    }

    // Also try local hub discovery
    const localConfig = findLocalHubConfig();
    if (localConfig?.localUrl) {
      hubUrls.push(localConfig.localUrl);
    }

    if (hubUrls.length === 0) {
      return text(
        `Short code "${invite.code}" needs a hub to resolve against. ` +
          `Use the full format "ABC123@host" or paste the full join code from the workspace creator.`,
      );
    }

    let resolved: { workspaceId: string; token: string } | null = null;
    for (const url of hubUrls) {
      process.stderr.write(`[intandem] Resolving invite code ${invite.code} via ${url}...\n`);
      resolved = await resolveShortCode(url, invite.code);
      if (resolved) {
        hubUrl = url;
        break;
      }
    }

    if (!resolved) {
      return text(
        `Could not resolve invite code "${invite.code}". ` +
          `The workspace may be offline. Ask your teammate for a fresh code.`,
      );
    }

    hubUrl = hubUrl!;
    workspaceId = resolved.workspaceId;
    token = resolved.token;
  }

  state.workspaceToken = token;

  const isLocal = hubUrl.includes('127.0.0.1') || hubUrl.includes('localhost');
  saveWorkspaceConfig({
    hubUrl,
    localUrl: isLocal ? hubUrl : undefined,
    workspaceId,
    token,
    username: state.myUsername,
    workspaceName: 'intandem-session',
  });

  const ok = await conn.connect(hubUrl, token, state.myUsername);
  if (!ok) {
    return text(`Failed to connect to hub at ${hubUrl}. Is the workspace still running?`);
  }

  return text(
    `Connected to "${state.workspaceName}" as ${state.myUsername}!\nPeers online: ${state.currentPeers.length > 0 ? state.currentPeers.join(', ') : 'none yet'}`,
  );
}

function buildSignedMessage(
  state: ChannelState,
  opts: { type: MessageType; to?: string; content: string; refs?: CodeReference[] },
): PeerMessage {
  const content = state.workspaceToken ? encryptMessage(opts.content, state.workspaceToken) : opts.content;
  const payload: PeerMessage = {
    type: opts.type,
    from: state.myUsername,
    to: opts.to,
    content,
    timestamp: Date.now(),
    refs: opts.refs,
    encrypted: !!state.workspaceToken,
  };
  if (state.workspaceToken) {
    payload.signature = signMessage(`${payload.from}:${payload.timestamp}:${payload.content}`, state.workspaceToken);
  }
  return payload;
}

function handleSend(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');

  const msgType = args.type as MessageType;
  if (!VALID_TYPES.includes(msgType)) {
    return text(`Invalid type. Use: ${VALID_TYPES.join(', ')}`);
  }
  const payload = buildSignedMessage(state, {
    type: msgType,
    to: args.to as string | undefined,
    content: args.message as string,
  });
  conn.send({ kind: 'message', payload });
  const target = args.to ? `to ${args.to}` : 'to all peers';
  return text(`Sent ${msgType} ${target}: "${args.message}"`);
}

async function handleBoard(conn: HubConnection, state: ChannelState): Promise<ToolResult> {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  conn.send({ kind: 'board', tasks: [] });
  const tasks = await waitForBoard(state);
  if (tasks.length === 0) return text('Task board is empty.');
  const lines = tasks.map(
    (t) =>
      `[${t.id}] ${t.status.toUpperCase()} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}${t.description ? `\n    ${t.description}` : ''}`,
  );
  return text('Shared Task Board:\n' + lines.join('\n'));
}

function handleAddTask(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const task: TaskItem = {
    id: `T-${randomBytes(3).toString('hex')}`,
    title: args.title as string,
    description: args.description as string | undefined,
    status: 'open',
    createdBy: state.myUsername,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });
  return text(`Task created: [${task.id}] ${task.title}`);
}

function handleClaimTask(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const task: TaskItem = {
    id: args.task_id as string,
    title: '',
    status: 'claimed',
    assignee: state.myUsername,
    createdBy: '',
    createdAt: 0,
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });
  return text(`Claimed task ${args.task_id}`);
}

function handleUpdateTask(args: Record<string, unknown>, conn: HubConnection, _state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const task: TaskItem = {
    id: args.task_id as string,
    title: '',
    status: args.status as TaskItem['status'],
    createdBy: '',
    createdAt: 0,
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });
  return text(`Updated task ${args.task_id} → ${args.status}`);
}

function handlePlan(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const taskDefs = args.tasks as Array<{ title: string; description?: string; assignee?: string }>;
  if (!taskDefs || taskDefs.length === 0) return text('No tasks provided.');

  const created: string[] = [];
  for (const def of taskDefs) {
    const task: TaskItem = {
      id: `T-${randomBytes(3).toString('hex')}`,
      title: def.title,
      description: def.description,
      status: def.assignee ? 'claimed' : 'open',
      assignee: def.assignee,
      createdBy: state.myUsername,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    conn.send({ kind: 'board_update', task });
    created.push(`[${task.id}] ${task.title}${task.assignee ? ` → ${task.assignee}` : ''}`);
  }

  const planSummary = created.join('\n');
  const planPayload = buildSignedMessage(state, {
    type: 'task',
    content: `Created work plan with ${created.length} tasks:\n${planSummary}`,
  });
  conn.send({ kind: 'message', payload: planPayload });

  return text(`Plan created with ${created.length} tasks:\n${planSummary}`);
}

function handleShare(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');

  const file = args.file as string;
  if (!file) return text('Specify a file path to share.');

  // C3 fix: validate file path is under cwd to prevent path traversal
  const cwd = process.cwd();
  const resolved = resolve(cwd, file);
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    return text(`File not found: ${file}`);
  }
  if (!realPath.startsWith(cwd)) {
    return text(`Access denied: file must be within the project directory.`);
  }

  const startLine = args.start_line as number | undefined;
  const endLine = args.end_line as number | undefined;
  const message = (args.message as string) ?? '';

  // Read the file snippet
  let snippet: string | undefined;
  try {
    const content = readFileSync(realPath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, (startLine ?? 1) - 1);
    const end = Math.min(lines.length, endLine ?? start + 20);
    snippet = lines.slice(start, end).join('\n');
  } catch {
    snippet = undefined;
  }

  const ref: CodeReference = {
    file,
    startLine,
    endLine,
    snippet,
    language: file.split('.').pop(),
  };

  const content = message || `Sharing ${file}${startLine ? `:${startLine}` : ''}${endLine ? `-${endLine}` : ''}`;
  const payload = buildSignedMessage(state, {
    type: 'context',
    to: args.to as string | undefined,
    content,
    refs: [ref],
  });
  conn.send({ kind: 'message', payload });
  const target = args.to ? `to ${args.to}` : 'to all peers';
  return text(`Shared ${file}${startLine ? `:${startLine}-${endLine ?? ''}` : ''} ${target}`);
}

function handlePeers(conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const healthMs = conn.lastHealthPing;
  const health = healthMs < 0 ? 'unknown' : healthMs < 60_000 ? 'good' : 'degraded';
  const lines = [
    `Online peers: ${state.currentPeers.length > 0 ? state.currentPeers.join(', ') : 'none'}`,
    `Connection health: ${health}`,
  ];
  return text(lines.join('\n'));
}

function handleLeave(conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected && !state.hub) return text('Not connected to any workspace.');

  conn.intentionalLeave = true;
  conn.cancelReconnect();
  conn.disconnect();
  state.currentPeers = [];

  if (state.tunnel) {
    state.tunnel.close();
    state.tunnel = null;
  }
  if (state.hub) {
    state.hub.stop();
    state.hub = null;
  }

  clearWorkspaceConfig();
  return text('Disconnected from workspace.');
}

async function handleRejoin(conn: HubConnection, state: ChannelState): Promise<ToolResult> {
  if (conn.connected) {
    return text(`Already connected to workspace "${state.workspaceName}".`);
  }
  conn.cancelReconnect();
  conn.intentionalLeave = false;

  let config = loadWorkspaceConfig();
  if (!config) {
    config = findLocalHubConfig();
  }
  if (!config) {
    return text(
      'No saved workspace config found. Use intandem_join with a join code, or intandem_create to start a new workspace.',
    );
  }

  const urlsToTry: string[] = [];
  if (config.localUrl) urlsToTry.push(config.localUrl);
  if (config.hubUrl && config.hubUrl !== config.localUrl) urlsToTry.push(config.hubUrl);
  if (!config.localUrl) {
    const creatorConfig = findLocalHubConfig();
    if (creatorConfig?.localUrl && !urlsToTry.includes(creatorConfig.localUrl)) {
      urlsToTry.unshift(creatorConfig.localUrl);
      if (creatorConfig.token) config = creatorConfig;
    }
  }

  if (!config.token) {
    return text('Saved workspace config has no token. Use intandem_join with a fresh join code.');
  }

  state.workspaceToken = config.token;

  let ok = false;
  for (const url of urlsToTry) {
    process.stderr.write(`[intandem] Trying to reconnect via ${url}...\n`);
    ok = await conn.connect(url, config.token, config.username);
    if (ok) break;
  }

  if (!ok) {
    return text(
      `Could not reconnect to "${config.workspaceName}". Tried: ${urlsToTry.join(', ')}. The hub may be offline. Use intandem_join with a fresh join code.`,
    );
  }

  return text(
    `Reconnected to "${state.workspaceName}" as ${state.myUsername}!\nPeers online: ${state.currentPeers.length > 0 ? state.currentPeers.join(', ') : 'none yet'}`,
  );
}
