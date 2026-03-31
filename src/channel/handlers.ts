import { randomBytes } from 'node:crypto';
import { TandemHub } from '../hub/server.js';
import { decodeJoinCode, createJoinCode } from '../shared/crypto.js';
import {
  saveWorkspaceConfig,
  loadWorkspaceConfig,
  clearWorkspaceConfig,
  findLocalHubConfig,
} from '../shared/config.js';
import type { PeerMessage, MessageType, TaskItem } from '../shared/types.js';
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
  pendingBoardResolve: ((tasks: TaskItem[]) => void) | null;
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

  const name = (args.name as string) ?? 'intandem-session';
  const maxPeers = Math.min((args.max_peers as number) ?? 5, 5);

  state.hub = new TandemHub();
  const { workspaceId, token } = state.hub.createWorkspace(name, maxPeers);
  const { port } = await state.hub.start({ port: 0, host: '127.0.0.1' });

  let publicUrl = `ws://127.0.0.1:${port}`;
  let tunnelUrl = '';
  try {
    state.tunnel = await localtunnel({ port });
    tunnelUrl = state.tunnel.url;
    publicUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    process.stderr.write(`[intandem] Tunnel open: ${tunnelUrl}\n`);
    state.tunnel.on('close', () => {
      process.stderr.write('[intandem] Tunnel closed\n');
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[intandem] Tunnel failed (${message}), using local-only mode\n`);
    publicUrl = `ws://127.0.0.1:${port}`;
  }

  const joinCode = createJoinCode(publicUrl, workspaceId, token);
  const localUrl = `ws://127.0.0.1:${port}`;
  saveWorkspaceConfig({
    hubUrl: localUrl,
    localUrl,
    workspaceId,
    token,
    username: state.myUsername,
    workspaceName: name,
    isCreator: true,
  });

  const ok = await conn.connect(`ws://127.0.0.1:${port}`, token, state.myUsername);
  if (!ok) {
    return text('Failed to connect to hub. Something went wrong.');
  }

  const lines = [
    `Workspace "${name}" created!`,
    `Your username: ${state.myUsername}`,
    ``,
    `Share this join code with your teammates:`,
    ``,
    `${joinCode}`,
    ``,
    `They paste it into their Claude session:`,
    `"Join this intandem workspace: <code>"`,
    ``,
    tunnelUrl ? `Tunnel: ${tunnelUrl} (works across machines/networks)` : `Local only: ws://127.0.0.1:${port}`,
    `Waiting for peers... (0/${maxPeers} slots)`,
  ];
  return text(lines.join('\n'));
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

  const code = args.code as string;
  if (!code) {
    return text('Need a join code. Ask your teammate for it.');
  }

  const decoded = decodeJoinCode(code);
  if (!decoded) {
    return text('Invalid join code. Check with the workspace creator.');
  }

  const isLocal = decoded.hubUrl.includes('127.0.0.1') || decoded.hubUrl.includes('localhost');
  saveWorkspaceConfig({
    hubUrl: decoded.hubUrl,
    localUrl: isLocal ? decoded.hubUrl : undefined,
    workspaceId: decoded.workspaceId,
    token: decoded.token,
    username: state.myUsername,
    workspaceName: 'intandem-session',
  });

  const ok = await conn.connect(decoded.hubUrl, decoded.token, state.myUsername);
  if (!ok) {
    return text(`Failed to connect to hub at ${decoded.hubUrl}. Is the workspace still running?`);
  }

  return text(
    `Connected to "${state.workspaceName}" as ${state.myUsername}!\nPeers online: ${state.currentPeers.length > 0 ? state.currentPeers.join(', ') : 'none yet'}`,
  );
}

function handleSend(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');

  const msgType = args.type as MessageType;
  if (!VALID_TYPES.includes(msgType)) {
    return text(`Invalid type. Use: ${VALID_TYPES.join(', ')}`);
  }
  const payload: PeerMessage = {
    type: msgType,
    from: state.myUsername,
    to: args.to as string | undefined,
    content: args.message as string,
    timestamp: Date.now(),
  };
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
  conn.send({
    kind: 'message',
    payload: {
      type: 'task',
      from: state.myUsername,
      content: `Created work plan with ${created.length} tasks:\n${planSummary}`,
      timestamp: Date.now(),
    },
  });

  return text(`Plan created with ${created.length} tasks:\n${planSummary}`);
}

function handlePeers(conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  if (state.currentPeers.length === 0) return text('No other peers online.');
  return text(`Online peers: ${state.currentPeers.join(', ')}`);
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
