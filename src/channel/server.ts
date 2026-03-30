import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { TandemHub } from '../hub/server.js';
import { generateUsername } from '../shared/names.js';
import { decodeJoinCode, createJoinCode, sanitizeContent } from '../shared/crypto.js';
import {
  saveWorkspaceConfig,
  loadWorkspaceConfig,
  clearWorkspaceConfig,
  findLocalHubConfig,
  saveUsername,
  loadUsername,
} from '../shared/config.js';
import type { HubMessage, PeerMessage, MessageType, TaskItem } from '../shared/types.js';

// @ts-ignore - localtunnel has no types
import localtunnel from 'localtunnel';

const VALID_TYPES: MessageType[] = ['finding', 'task', 'question', 'status', 'handoff', 'review', 'chat'];

export async function startChannelServer(): Promise<void> {
  let hub: TandemHub | null = null;
  let hubWs: WebSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPeers: string[] = [];
  let workspaceName = '';
  let myUsername = '';
  let myToken = '';
  let hubUrl = '';
  let tunnel: any = null;
  let intentionalLeave = false;
  let reconnectAttempts = 0;
  let connectionGeneration = 0; // monotonic counter to prevent stale connections from clobbering new ones
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 2000; // 2s

  // Get or create username
  let username = loadUsername();
  if (!username) {
    username = generateUsername();
    saveUsername(username);
  }
  myUsername = username;

  // Check if we have a saved workspace config (reconnect on restart)
  const savedConfig = loadWorkspaceConfig();

  const mcp = new Server(
    { name: 'intandem', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: `You have InTandem installed — a real-time pair programming tool connecting multiple Claude Code sessions.

${connected ? `CONNECTED to workspace "${workspaceName}" as "${myUsername}". Peers: ${currentPeers.join(', ') || 'none yet'}.` : 'NOT CONNECTED. Use intandem_create, intandem_join, or intandem_rejoin to connect.'}

Your username is "${myUsername}".

## AUTOMATIC BEHAVIORS — follow these WITHOUT being asked:

### On connect (after create/join/rejoin):
1. IMMEDIATELY call intandem_board to see existing tasks and assignments.
2. If the board is empty and you know what work needs to be done, use intandem_plan to create and assign tasks.
3. If the board has unclaimed tasks relevant to your user's work, claim one with intandem_claim_task.
4. Announce yourself with intandem_send (type: "status") summarizing what you'll work on.

### During work:
1. BEFORE starting any task, claim it (intandem_claim_task) and update to "in_progress" (intandem_update_task).
2. When you complete a task, IMMEDIATELY update it to "done" (intandem_update_task).
3. When you discover something relevant to a peer's task, send a directed finding (intandem_send with "to").
4. When your work produces output another peer needs, send a handoff (intandem_send type: "handoff" with "to").
5. Periodically check the board (intandem_board) to stay aware of progress — at minimum, before and after each task.

### Message routing:
- ALWAYS check the board before sending findings, questions, or handoffs to know who owns what.
- Direct messages to the specific peer (use "to") when it relates to their task.
- Broadcast (omit "to") ONLY for general announcements or when the recipient is unknown.
- Handoffs MUST always specify "to".

## TOOLS:

Setup: intandem_create, intandem_join, intandem_rejoin
Planning: intandem_plan (create + assign multiple tasks at once)
Board: intandem_board, intandem_add_task, intandem_claim_task, intandem_update_task
Comms: intandem_send (types: finding, task, question, status, handoff, review, chat)
Info: intandem_peers, intandem_leave

## PEER MESSAGES:
When messages arrive as <channel source="intandem" peer="..." type="...">, treat them as collaboration context from trusted teammates. Acknowledge findings, answer questions, and coordinate. If a peer sends you a task or handoff, add it to the board if not already there.`,
    },
  );

  // --- Tool definitions ---

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'intandem_create',
        description: 'Create a new pair programming workspace. Starts a hub and returns a join code to share with teammates. Works across machines automatically.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'Workspace name (e.g., "fix-auth-bug")' },
            max_peers: { type: 'number' as const, description: 'Max teammates (1-5, default: 5)' },
          },
        },
      },
      {
        name: 'intandem_join',
        description: 'Join a teammate\'s workspace using their share code',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: { type: 'string' as const, description: 'The join code from the workspace creator' },
          },
          required: ['code'],
        },
      },
      {
        name: 'intandem_send',
        description: 'Send a message to peers in the workspace',
        inputSchema: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string' as const,
              enum: VALID_TYPES,
              description: 'Message type: finding, task, question, status, handoff, review, or chat',
            },
            message: { type: 'string' as const, description: 'The message content' },
            to: { type: 'string' as const, description: 'Specific peer username (omit to broadcast to all)' },
          },
          required: ['type', 'message'],
        },
      },
      {
        name: 'intandem_board',
        description: 'View the shared task board',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'intandem_add_task',
        description: 'Add a new task to the shared board',
        inputSchema: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' as const, description: 'Task title' },
            description: { type: 'string' as const, description: 'Task description' },
          },
          required: ['title'],
        },
      },
      {
        name: 'intandem_claim_task',
        description: 'Claim a task from the shared board',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task_id: { type: 'string' as const, description: 'The task ID to claim' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'intandem_update_task',
        description: 'Update a task status on the shared board',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task_id: { type: 'string' as const, description: 'The task ID' },
            status: {
              type: 'string' as const,
              enum: ['open', 'claimed', 'in_progress', 'done'],
              description: 'New status',
            },
          },
          required: ['task_id', 'status'],
        },
      },
      {
        name: 'intandem_plan',
        description: 'Create a work plan: multiple tasks at once, optionally assigned to peers. Use this when starting a collaborative session to break work into pieces.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tasks: {
              type: 'array' as const,
              description: 'List of tasks to create',
              items: {
                type: 'object' as const,
                properties: {
                  title: { type: 'string' as const, description: 'Task title' },
                  description: { type: 'string' as const, description: 'Task description' },
                  assignee: { type: 'string' as const, description: 'Username to assign to (optional)' },
                },
                required: ['title'],
              },
            },
          },
          required: ['tasks'],
        },
      },
      {
        name: 'intandem_peers',
        description: 'See who is online in the workspace',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'intandem_leave',
        description: 'Disconnect from the current workspace',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'intandem_rejoin',
        description: 'Reconnect to a previously joined workspace using saved config (no join code needed)',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
  }));

  // --- Tool handlers ---

  let pendingBoardResolve: ((tasks: TaskItem[]) => void) | null = null;

  function waitForBoard(): Promise<TaskItem[]> {
    return new Promise((resolve) => {
      pendingBoardResolve = resolve;
      setTimeout(() => {
        if (pendingBoardResolve === resolve) {
          pendingBoardResolve = null;
          resolve([]);
        }
      }, 3000);
    });
  }

  function sendToHub(msg: HubMessage): void {
    if (hubWs && hubWs.readyState === WebSocket.OPEN) {
      hubWs.send(JSON.stringify(msg));
    }
  }

  function cancelReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
  }

  function scheduleReconnect(url: string, token: string, uname: string): void {
    if (intentionalLeave || reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      process.stderr.write(`[intandem] Gave up reconnecting after ${MAX_RECONNECT_ATTEMPTS} attempts. Use intandem_rejoin to reconnect manually.\n`);
      return;
    }
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 30000);
    const gen = connectionGeneration; // capture current generation
    reconnectAttempts++;
    process.stderr.write(`[intandem] Disconnected. Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\n`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (gen !== connectionGeneration) return; // a newer connect superseded us
      const ok = await connectToHub(url, token, uname);
      if (!ok && gen === connectionGeneration) {
        scheduleReconnect(url, token, uname);
      }
    }, delay);
  }

  function connectToHub(url: string, token: string, uname: string): Promise<boolean> {
    const gen = ++connectionGeneration; // bump generation — any older connection is now stale

    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err: any) {
        process.stderr.write(`[intandem] Failed to create WebSocket: ${err.message}\n`);
        resolve(false);
        return;
      }
      let resolved = false;

      // Only adopt this WebSocket if we're still the current generation
      const adopt = () => {
        if (gen !== connectionGeneration) return false; // superseded
        hubWs = ws;
        return true;
      };

      ws.on('open', () => {
        if (gen !== connectionGeneration) { ws.close(); return; }
        ws.send(JSON.stringify({ kind: 'auth', token, username: uname }));
      });

      ws.on('message', (data) => {
        if (gen !== connectionGeneration) { ws.close(); return; }
        let msg: HubMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        handleHubMessage(msg, () => {
          if (!resolved) {
            resolved = true;
            reconnectAttempts = 0;
            if (adopt()) {
              resolve(true);
            } else {
              ws.close();
              resolve(false);
            }
          }
        });
      });

      ws.on('close', () => {
        // Only touch shared state if we're still the current connection
        if (gen === connectionGeneration) {
          connected = false;
        }
        if (!resolved) {
          resolved = true;
          resolve(false);
        } else if (gen === connectionGeneration && !intentionalLeave) {
          scheduleReconnect(url, token, uname);
        }
      });

      ws.on('error', (err) => {
        process.stderr.write(`[intandem] Connection error: ${err.message}\n`);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (gen === connectionGeneration) ws.close();
          resolve(false);
        }
      }, 10000);
    });
  }

  function handleHubMessage(msg: HubMessage, onAuthOk?: () => void): void {
    switch (msg.kind) {
      case 'auth_ok':
        connected = true;
        workspaceName = msg.workspace.name;
        currentPeers = msg.workspace.peers.filter(p => p !== myUsername);
        process.stderr.write(`[intandem] Connected to "${workspaceName}" as ${myUsername}\n`);
        onAuthOk?.();
        break;

      case 'auth_fail':
        process.stderr.write(`[intandem] Auth failed: ${msg.reason}\n`);
        connected = false;
        break;

      case 'peer_joined':
        currentPeers = msg.peers.filter(p => p !== myUsername);
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `${msg.username} joined the workspace. Online peers: ${currentPeers.join(', ')}`,
            meta: { peer: msg.username, type: 'status', event: 'joined' },
          },
        });
        break;

      case 'peer_left':
        currentPeers = msg.peers.filter(p => p !== myUsername);
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `${msg.username} left the workspace. Online peers: ${currentPeers.join(', ') || 'none'}`,
            meta: { peer: msg.username, type: 'status', event: 'left' },
          },
        });
        break;

      case 'message': {
        const p = msg.payload;
        const safeContent = sanitizeContent(p.content);
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: safeContent,
            meta: {
              peer: p.from,
              type: p.type,
              ...(p.to ? { to: p.to } : {}),
            },
          },
        });
        break;
      }

      case 'board':
        if (pendingBoardResolve) {
          pendingBoardResolve(msg.tasks);
          pendingBoardResolve = null;
        } else if (msg.tasks.length > 0) {
          // Auto-pushed board on connect — notify Claude
          const lines = msg.tasks.map(t =>
            `[${t.id}] ${t.status.toUpperCase()} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`
          );
          mcp.notification({
            method: 'notifications/claude/channel',
            params: {
              content: `Current task board:\n${lines.join('\n')}`,
              meta: { type: 'task', event: 'board_sync' },
            },
          });
        }
        break;

      case 'board_update': {
        const t = msg.task;
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `Task [${t.id}] "${t.title}" → ${t.status}${t.assignee ? ` (assigned to ${t.assignee})` : ''}`,
            meta: { type: 'task', event: 'board_update' },
          },
        });
        break;
      }

      case 'board_reject':
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `Task claim rejected: ${msg.reason}. Check the board (intandem_board) and pick a different task.`,
            meta: { type: 'task', event: 'board_reject', taskId: msg.taskId },
          },
        });
        break;

      case 'error':
        process.stderr.write(`[intandem] Hub error: ${msg.message}\n`);
        break;
    }
  }

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, any>;

    switch (req.params.name) {
      // ==================== CREATE ====================
      case 'intandem_create': {
        if (connected) {
          return text('Already connected to a workspace. Use intandem_leave first.');
        }
        cancelReconnect();
        intentionalLeave = false;

        const name = args.name ?? 'intandem-session';
        const maxPeers = Math.min(args.max_peers ?? 5, 5);

        // Start local hub
        hub = new TandemHub();
        const { workspaceId, token } = hub.createWorkspace(name, maxPeers);
        const { port } = await hub.start({ port: 0, host: '127.0.0.1' }); // random port

        // Open tunnel for remote access
        let publicUrl = `ws://127.0.0.1:${port}`;
        let tunnelUrl = '';
        try {
          tunnel = await localtunnel({ port });
          tunnelUrl = tunnel.url;
          // localtunnel gives https:// URL, convert to wss:// for WebSocket
          publicUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');
          process.stderr.write(`[intandem] Tunnel open: ${tunnelUrl}\n`);

          tunnel.on('close', () => {
            process.stderr.write('[intandem] Tunnel closed\n');
          });
        } catch (err: any) {
          process.stderr.write(`[intandem] Tunnel failed (${err.message}), using local-only mode\n`);
          publicUrl = `ws://127.0.0.1:${port}`;
        }

        const joinCode = createJoinCode(publicUrl, workspaceId, token);
        myToken = token;
        hubUrl = `ws://127.0.0.1:${port}`; // always connect locally since we're hosting

        // Save config
        const localUrl = `ws://127.0.0.1:${port}`;
        saveWorkspaceConfig({
          hubUrl: localUrl,
          localUrl,
          workspaceId,
          token,
          username: myUsername,
          workspaceName: name,
          isCreator: true,
        });

        // Connect to our own hub as a peer
        const ok = await connectToHub(`ws://127.0.0.1:${port}`, token, myUsername);
        if (!ok) {
          return text('Failed to connect to hub. Something went wrong.');
        }

        const lines = [
          `Workspace "${name}" created!`,
          `Your username: ${myUsername}`,
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

      // ==================== JOIN ====================
      case 'intandem_join': {
        if (connected) {
          return text('Already connected to a workspace. Use intandem_leave first.');
        }
        cancelReconnect();
        intentionalLeave = false;

        const code = args.code;
        if (!code) {
          return text('Need a join code. Ask your teammate for it.');
        }

        const decoded = decodeJoinCode(code);
        if (!decoded) {
          return text('Invalid join code. Check with the workspace creator.');
        }

        myToken = decoded.token;
        hubUrl = decoded.hubUrl;

        // Detect if hub is local (same machine) — save local URL for fast reconnect
        const isLocal = decoded.hubUrl.includes('127.0.0.1') || decoded.hubUrl.includes('localhost');
        saveWorkspaceConfig({
          hubUrl: decoded.hubUrl,
          localUrl: isLocal ? decoded.hubUrl : undefined,
          workspaceId: decoded.workspaceId,
          token: decoded.token,
          username: myUsername,
          workspaceName: 'intandem-session',
        });

        const ok = await connectToHub(decoded.hubUrl, decoded.token, myUsername);
        if (!ok) {
          return text(`Failed to connect to hub at ${decoded.hubUrl}. Is the workspace still running?`);
        }

        return text(`Connected to "${workspaceName}" as ${myUsername}!\nPeers online: ${currentPeers.length > 0 ? currentPeers.join(', ') : 'none yet'}`);
      }

      // ==================== SEND ====================
      case 'intandem_send': {
        if (!connected) return text('Not connected. Create or join a workspace first.');

        const msgType = args.type as MessageType;
        if (!VALID_TYPES.includes(msgType)) {
          return text(`Invalid type. Use: ${VALID_TYPES.join(', ')}`);
        }
        const payload: PeerMessage = {
          type: msgType,
          from: myUsername,
          to: args.to,
          content: args.message,
          timestamp: Date.now(),
        };
        sendToHub({ kind: 'message', payload });
        const target = args.to ? `to ${args.to}` : 'to all peers';
        return text(`Sent ${msgType} ${target}: "${args.message}"`);
      }

      // ==================== BOARD ====================
      case 'intandem_board': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        sendToHub({ kind: 'board', tasks: [] });
        const tasks = await waitForBoard();
        if (tasks.length === 0) return text('Task board is empty.');
        const lines = tasks.map(t =>
          `[${t.id}] ${t.status.toUpperCase()} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}${t.description ? `\n    ${t.description}` : ''}`
        );
        return text('Shared Task Board:\n' + lines.join('\n'));
      }

      case 'intandem_add_task': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        const task: TaskItem = {
          id: `T-${randomBytes(3).toString('hex')}`,
          title: args.title,
          description: args.description,
          status: 'open',
          createdBy: myUsername,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return text(`Task created: [${task.id}] ${task.title}`);
      }

      case 'intandem_claim_task': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        const task: TaskItem = {
          id: args.task_id,
          title: '',
          status: 'claimed',
          assignee: myUsername,
          createdBy: '',
          createdAt: 0,
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return text(`Claimed task ${args.task_id}`);
      }

      case 'intandem_update_task': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        const task: TaskItem = {
          id: args.task_id,
          title: '',
          status: args.status as TaskItem['status'],
          createdBy: '',
          createdAt: 0,
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return text(`Updated task ${args.task_id} → ${args.status}`);
      }

      // ==================== PLAN ====================
      case 'intandem_plan': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
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
            createdBy: myUsername,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          sendToHub({ kind: 'board_update', task });
          created.push(`[${task.id}] ${task.title}${task.assignee ? ` → ${task.assignee}` : ''}`);
        }

        // Broadcast the plan to all peers
        const planSummary = created.join('\n');
        sendToHub({
          kind: 'message',
          payload: {
            type: 'task',
            from: myUsername,
            content: `Created work plan with ${created.length} tasks:\n${planSummary}`,
            timestamp: Date.now(),
          },
        });

        return text(`Plan created with ${created.length} tasks:\n${planSummary}`);
      }

      // ==================== PEERS ====================
      case 'intandem_peers': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        if (currentPeers.length === 0) return text('No other peers online.');
        return text(`Online peers: ${currentPeers.join(', ')}`);
      }

      // ==================== LEAVE ====================
      case 'intandem_leave': {
        if (!connected && !hub) return text('Not connected to any workspace.');

        intentionalLeave = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        hubWs?.close();
        hubWs = null;
        connected = false;
        currentPeers = [];

        if (tunnel) {
          tunnel.close();
          tunnel = null;
        }
        if (hub) {
          hub.stop();
          hub = null;
        }

        // Clear saved config so auto-reconnect doesn't kick in
        clearWorkspaceConfig();

        return text('Disconnected from workspace.');
      }

      // ==================== REJOIN ====================
      case 'intandem_rejoin': {
        if (connected) {
          return text(`Already connected to workspace "${workspaceName}".`);
        }
        cancelReconnect();
        intentionalLeave = false;

        let config = loadWorkspaceConfig();
        if (!config) {
          // Check if there's a creator session on this machine we can connect to
          config = findLocalHubConfig();
        }
        if (!config) {
          return text('No saved workspace config found. Use intandem_join with a join code, or intandem_create to start a new workspace.');
        }

        // Build list of URLs to try: local first, then tunnel
        const urlsToTry: string[] = [];
        if (config.localUrl) urlsToTry.push(config.localUrl);
        if (config.hubUrl && config.hubUrl !== config.localUrl) urlsToTry.push(config.hubUrl);
        // Also check if another session has a local hub running
        if (!config.localUrl) {
          const creatorConfig = findLocalHubConfig();
          if (creatorConfig?.localUrl && !urlsToTry.includes(creatorConfig.localUrl)) {
            urlsToTry.unshift(creatorConfig.localUrl);
            // Use creator's token if our config doesn't have one for this workspace
            if (creatorConfig.token) config = creatorConfig;
          }
        }

        let ok = false;
        for (const url of urlsToTry) {
          process.stderr.write(`[intandem] Trying to reconnect via ${url}...\n`);
          ok = await connectToHub(url, config.token, config.username);
          if (ok) {
            hubUrl = url;
            break;
          }
        }

        if (!ok) {
          return text(`Could not reconnect to "${config.workspaceName}". Tried: ${urlsToTry.join(', ')}. The hub may be offline. Use intandem_join with a fresh join code.`);
        }

        myToken = config.token;
        hubUrl = config.hubUrl;
        return text(`Reconnected to "${workspaceName}" as ${myUsername}!\nPeers online: ${currentPeers.length > 0 ? currentPeers.join(', ') : 'none yet'}`);
      }

      default:
        throw new Error(`Unknown tool: ${req.params.name}`);
    }
  });

  // --- Start MCP ---
  await mcp.connect(new StdioServerTransport());

  // Auto-reconnect if we have a saved config — try local URL first
  const startupConfig = savedConfig ?? findLocalHubConfig();
  if (startupConfig) {
    process.stderr.write(`[intandem] Found saved workspace config, reconnecting...\n`);
    const urlsToTry: string[] = [];
    if (startupConfig.localUrl) urlsToTry.push(startupConfig.localUrl);
    if (startupConfig.hubUrl && startupConfig.hubUrl !== startupConfig.localUrl) urlsToTry.push(startupConfig.hubUrl);
    // Also check creator's session config
    const creatorConfig = findLocalHubConfig();
    if (creatorConfig?.localUrl && !urlsToTry.includes(creatorConfig.localUrl)) {
      urlsToTry.unshift(creatorConfig.localUrl);
    }
    const tokenToUse = startupConfig.token || creatorConfig?.token || '';
    const usernameToUse = startupConfig.username || myUsername;
    const startupGen = connectionGeneration; // snapshot so we bail if user calls create/join

    (async () => {
      for (const url of urlsToTry) {
        if (startupGen !== connectionGeneration) return; // user initiated a new connection
        process.stderr.write(`[intandem] Trying ${url}...\n`);
        const ok = await connectToHub(url, tokenToUse, usernameToUse);
        if (ok) {
          myToken = tokenToUse;
          hubUrl = url;
          process.stderr.write(`[intandem] Reconnected to "${workspaceName}"\n`);
          return;
        }
      }
      if (startupGen !== connectionGeneration) return; // user initiated a new connection
      const fallbackUrl = urlsToTry[0] || startupConfig.hubUrl;
      process.stderr.write(`[intandem] Initial reconnect failed, will retry...\n`);
      scheduleReconnect(fallbackUrl, tokenToUse, usernameToUse);
    })();
  }

  // Cleanup
  process.on('SIGINT', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (tunnel) tunnel.close();
    if (hub) hub.stop();
    hubWs?.close();
    process.exit(0);
  });
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
