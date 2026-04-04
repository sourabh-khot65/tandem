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
import type { PeerMessage, MessageType, TaskItem, CodeReference, Finding, FindingSeverity } from '../shared/types.js';
import { openTunnel, type TunnelHandle } from '../shared/tunnel.js';
import { HubConnection } from './connection.js';
import { VALID_TYPES } from './tools.js';

type ToolResult = { content: [{ type: 'text'; text: string }] };

function text(t: string): ToolResult {
  return { content: [{ type: 'text' as const, text: t }] };
}

export interface SessionStats {
  connectedAt: number;
  toolCallCount: number;
  intandemToolCallCount: number;
  messagesSent: number;
  messagesReceived: number;
  tasksClaimed: number;
  tasksCompleted: number;
  peersSeenCount: number;
}

export interface ChannelState {
  hub: TandemHub | null;
  tunnel: TunnelHandle | null;
  currentPeers: string[];
  workspaceName: string;
  myUsername: string;
  workspaceToken: string; // for E2E encryption
  inviteCode: string; // short human-readable invite code
  pendingBoardResolve: ((tasks: TaskItem[]) => void) | null;
  pendingVarResolve: ((result: string) => void) | null;
  pendingActivityResolve: ((result: string) => void) | null;
  pendingFindingsResolve: ((result: string) => void) | null;
  stats: SessionStats;
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
      await setupTunnel(port, state, conn);
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
      const tunnelUrl = (state.tunnel as TunnelHandle | null)?.url;
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

const MAX_TUNNEL_RETRIES = 3;
const TUNNEL_RETRY_DELAY = 5_000;

async function setupTunnel(port: number, state: ChannelState, conn: HubConnection, retryCount = 0): Promise<void> {
  try {
    state.tunnel = await openTunnel(port);
    process.stderr.write(`[intandem] Tunnel open: ${state.tunnel.url}\n`);

    if (retryCount > 0 && conn.connected) {
      // Notify peers that tunnel is back
      const payload = buildSignedMessage(state, {
        type: 'status',
        content: `Tunnel reconnected. Remote access restored.`,
      });
      conn.send({ kind: 'message', payload });
    }

    state.tunnel.on('close', () => {
      process.stderr.write('[intandem] Tunnel closed — remote peers may lose access.\n');
      state.tunnel = null;

      if (conn.connected) {
        const payload = buildSignedMessage(state, {
          type: 'status',
          content: `Tunnel dropped. Remote peers may disconnect. Attempting to reopen...`,
        });
        conn.send({ kind: 'message', payload });
      }

      // Retry with backoff
      const nextRetry = retryCount + 1;
      if (nextRetry <= MAX_TUNNEL_RETRIES) {
        setTimeout(() => {
          setupTunnel(port, state, conn, nextRetry).catch(() => {
            process.stderr.write(`[intandem] Tunnel reopen failed after ${nextRetry} attempts — local-only mode\n`);
          });
        }, TUNNEL_RETRY_DELAY * nextRetry);
      } else {
        process.stderr.write(`[intandem] Tunnel reopen exhausted ${MAX_TUNNEL_RETRIES} retries — local-only mode\n`);
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[intandem] Tunnel failed (${message})\n`);
    if (retryCount < MAX_TUNNEL_RETRIES) {
      await new Promise((r) => setTimeout(r, TUNNEL_RETRY_DELAY));
      return setupTunnel(port, state, conn, retryCount + 1);
    }
    throw err;
  }
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
  state.stats.intandemToolCallCount++;

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
    case 'intandem_unclaim_task':
      return handleUnclaimTask(args, conn, state);
    case 'intandem_update_task':
      return handleUpdateTask(args, conn, state);
    case 'intandem_plan':
      return handlePlan(args, conn, state);
    case 'intandem_share':
      return handleShare(args, conn, state);
    case 'intandem_finding':
      return handleFinding(args, conn, state);
    case 'intandem_findings':
      return handleFindings(args, conn, state);
    case 'intandem_set_var':
      return handleSetVar(args, conn, state);
    case 'intandem_get_var':
      return handleGetVar(args, conn, state);
    case 'intandem_peers':
      return handlePeers(conn, state);
    case 'intandem_activity_log':
      return handleActivityLog(args, conn, state);
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
    await setupTunnel(port, state, conn);
    tunnelUrl = (state.tunnel as TunnelHandle | null)?.url ?? '';
  } catch {
    process.stderr.write(`[intandem] All tunnel attempts failed, using local-only mode\n`);
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
    msgId: randomBytes(4).toString('hex'),
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
  state.stats.messagesSent++;
  const target = args.to ? `to ${args.to}` : 'to all peers';
  return text(`Sent ${msgType} ${target}: "${args.message}"`);
}

async function handleBoard(conn: HubConnection, state: ChannelState): Promise<ToolResult> {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  conn.send({ kind: 'board', tasks: [] });
  const tasks = await waitForBoard(state);
  if (tasks.length === 0) return text('Task board is empty.');
  // Sort by priority: critical > high > medium > low
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => (priorityOrder[a.priority ?? 'medium'] ?? 2) - (priorityOrder[b.priority ?? 'medium'] ?? 2));
  const lines = tasks.map((t) => {
    const pri = t.priority && t.priority !== 'medium' ? ` [${t.priority.toUpperCase()}]` : '';
    const deps = t.dependsOn && t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(', ')})` : '';
    const res = t.result ? `\n    Result: ${t.result}` : '';
    return `[${t.id}] ${t.status.toUpperCase()}${pri} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}${deps}${t.description ? `\n    ${t.description}` : ''}${res}`;
  });
  return text('Shared Task Board:\n' + lines.join('\n'));
}

function handleAddTask(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const dependsOn = args.depends_on as string[] | undefined;
  const task: TaskItem = {
    id: `T-${randomBytes(3).toString('hex')}`,
    title: args.title as string,
    description: args.description as string | undefined,
    status: dependsOn && dependsOn.length > 0 ? 'blocked' : 'open',
    priority: (args.priority as TaskItem['priority']) ?? 'medium',
    dependsOn,
    createdBy: state.myUsername,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });
  return text(`Task created: [${task.id}] ${task.title}${dependsOn ? ` (blocked by ${dependsOn.join(', ')})` : ''}`);
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
  state.stats.tasksClaimed++;
  return text(`Claimed task ${args.task_id}`);
}

function handleUnclaimTask(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const task: TaskItem = {
    id: args.task_id as string,
    title: '',
    status: 'open',
    assignee: '', // clear assignee
    createdBy: '',
    createdAt: 0,
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });

  // Notify peers so they know the task is available
  const payload = buildSignedMessage(state, {
    type: 'status',
    content: `Released task ${args.task_id} — it's available for anyone to claim.`,
  });
  conn.send({ kind: 'message', payload });

  return text(`Released task ${args.task_id} back to open.`);
}

function handleUpdateTask(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const status = args.status as TaskItem['status'];
  const result = args.result as string | undefined;
  const task: TaskItem = {
    id: args.task_id as string,
    title: '',
    status,
    result,
    createdBy: '',
    createdAt: 0,
    updatedAt: Date.now(),
  };
  conn.send({ kind: 'board_update', task });
  if (status === 'done') state.stats.tasksCompleted++;
  return text(`Updated task ${args.task_id} → ${status}${result ? ' (result attached)' : ''}`);
}

function handlePlan(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const taskDefs = args.tasks as Array<{
    title: string;
    description?: string;
    assignee?: string;
    priority?: TaskItem['priority'];
    depends_on?: string[];
  }>;
  if (!taskDefs || taskDefs.length === 0) return text('No tasks provided.');

  const created: string[] = [];
  for (const def of taskDefs) {
    const hasDeps = def.depends_on && def.depends_on.length > 0;
    const task: TaskItem = {
      id: `T-${randomBytes(3).toString('hex')}`,
      title: def.title,
      description: def.description,
      status: hasDeps ? 'blocked' : def.assignee ? 'claimed' : 'open',
      priority: def.priority ?? 'medium',
      assignee: def.assignee,
      dependsOn: def.depends_on,
      createdBy: state.myUsername,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    conn.send({ kind: 'board_update', task });
    created.push(
      `[${task.id}] ${task.title}${task.assignee ? ` → ${task.assignee}` : ''}${hasDeps ? ' (blocked)' : ''}`,
    );
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

function handleFinding(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const service = args.service as string;
  const severity = args.severity as FindingSeverity;
  const summary = args.summary as string;
  if (!service || !severity || !summary) return text('service, severity, and summary are required.');

  const finding: Finding = {
    id: `F-${randomBytes(3).toString('hex')}`,
    service,
    severity,
    summary,
    category: args.category as string | undefined,
    count: args.count as number | undefined,
    patterns: args.patterns as Finding['patterns'],
    recommendation: args.recommendation as string | undefined,
    taskId: args.task_id as string | undefined,
    reportedBy: state.myUsername,
    timestamp: Date.now(),
  };

  conn.send({ kind: 'finding_submit', finding });

  const parts = [`Reported [${severity.toUpperCase()}] finding for ${service}`];
  if (finding.count) parts.push(`${finding.count} occurrences`);
  if (finding.patterns?.length) parts.push(`${finding.patterns.length} pattern(s)`);
  if (finding.taskId) parts.push(`linked to ${finding.taskId}`);
  return text(parts.join(' | '));
}

async function handleFindings(
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');

  return new Promise((resolve) => {
    state.pendingFindingsResolve = (result: string) => resolve(text(result));
    conn.send({
      kind: 'findings_request',
      severity: args.severity as FindingSeverity | undefined,
      service: args.service as string | undefined,
    });
    setTimeout(() => {
      if (state.pendingFindingsResolve) {
        state.pendingFindingsResolve = null;
        resolve(text('Timed out waiting for findings.'));
      }
    }, 3000);
  });
}

function handleSetVar(args: Record<string, unknown>, conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const key = args.key as string;
  const value = args.value as string;
  if (!key || !value) return text('Both key and value are required.');
  conn.send({ kind: 'var_set', key, value, setBy: state.myUsername });
  return text(`Set variable "${key}" = "${value.length > 100 ? value.slice(0, 100) + '...' : value}"`);
}

async function handleGetVar(
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const key = args.key as string;
  if (!key) return text('Key is required. Use "*" to list all variables.');

  return new Promise((resolve) => {
    state.pendingVarResolve = (result: string) => resolve(text(result));
    conn.send({ kind: 'var_get', key });
    setTimeout(() => {
      if (state.pendingVarResolve) {
        state.pendingVarResolve = null;
        resolve(text('Timed out waiting for variable response.'));
      }
    }, 3000);
  });
}

async function handleActivityLog(
  args: Record<string, unknown>,
  conn: HubConnection,
  state: ChannelState,
): Promise<ToolResult> {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const limit = (args.limit as number) ?? 30;

  return new Promise((resolve) => {
    state.pendingActivityResolve = (result: string) => resolve(text(result));
    conn.send({ kind: 'activity_log_request', limit });
    setTimeout(() => {
      if (state.pendingActivityResolve) {
        state.pendingActivityResolve = null;
        resolve(text('Timed out waiting for activity log.'));
      }
    }, 3000);
  });
}

function handlePeers(conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected) return text('Not connected. Create or join a workspace first.');
  const healthMs = conn.lastHealthPing;
  const health = healthMs < 0 ? 'unknown' : healthMs < 60_000 ? 'good' : 'degraded';

  // Request detailed peer info from hub
  conn.send({ kind: 'peers' });

  const lines = [
    `Online peers: ${state.currentPeers.length > 0 ? state.currentPeers.join(', ') : 'none'}`,
    `Connection health: ${health}`,
  ];
  return text(lines.join('\n'));
}

function generateSessionSummary(state: ChannelState): string {
  const s = state.stats;
  const duration = s.connectedAt > 0 ? Date.now() - s.connectedAt : 0;
  const durationStr =
    duration > 0 ? `${Math.floor(duration / 60_000)}m ${Math.floor((duration % 60_000) / 1000)}s` : 'unknown';
  const totalCalls = s.intandemToolCallCount;
  const overheadPct = totalCalls > 0 ? Math.round((totalCalls / (totalCalls + s.messagesSent)) * 100) : 0;

  const lines = [
    `Session Summary for "${state.workspaceName}":`,
    `  Duration: ${durationStr}`,
    `  Peers seen: ${s.peersSeenCount}`,
    `  Tasks claimed: ${s.tasksClaimed} | completed: ${s.tasksCompleted}`,
    `  Messages sent: ${s.messagesSent} | received: ${s.messagesReceived}`,
    `  InTandem tool calls: ${totalCalls}`,
    `  Collaboration: ${s.peersSeenCount > 0 && s.messagesReceived > 0 ? 'active' : s.peersSeenCount > 0 ? 'one-directional' : 'solo'}`,
  ];
  return lines.join('\n');
}

function handleLeave(conn: HubConnection, state: ChannelState): ToolResult {
  if (!conn.connected && !state.hub) return text('Not connected to any workspace.');

  const summary = generateSessionSummary(state);

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
  return text(`Disconnected from workspace.\n\n${summary}`);
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
