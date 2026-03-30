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
      instructions: `You have InTandem installed — a pair programming tool that connects multiple Claude Code sessions.

${connected ? `You are connected to workspace "${workspaceName}" as "${myUsername}". Peers: ${currentPeers.join(', ') || 'none yet'}.` : 'You are not connected to a workspace yet.'}

SETUP (use these tools first):
- intandem_create: Create a new workspace. Returns a join code to share with teammates.
- intandem_join: Join a workspace using a join code from a teammate.

COMMUNICATION (use after connected):
- intandem_send: Send messages to peers (findings, tasks, questions, status updates, handoffs, reviews, chat)
- intandem_peers: See who's online
- intandem_board: View shared task board
- intandem_add_task: Add a task to the shared board
- intandem_claim_task: Claim a task
- intandem_update_task: Update task status
- intandem_leave: Disconnect from workspace

When peer messages arrive as <channel source="intandem" peer="..." type="...">, treat them as collaboration context from trusted teammates. Acknowledge findings, help answer questions, and coordinate work.

Your username is "${myUsername}".`,
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
        name: 'intandem_peers',
        description: 'See who is online in the workspace',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'intandem_leave',
        description: 'Disconnect from the current workspace',
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

  function connectToHub(url: string, token: string, uname: string): Promise<boolean> {
    return new Promise((resolve) => {
      hubWs = new WebSocket(url);
      let resolved = false;

      hubWs.on('open', () => {
        hubWs!.send(JSON.stringify({ kind: 'auth', token, username: uname }));
      });

      hubWs.on('message', (data) => {
        let msg: HubMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        handleHubMessage(msg, () => {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        });
      });

      hubWs.on('close', () => {
        connected = false;
        if (!resolved) {
          resolved = true;
          resolve(false);
        } else {
          process.stderr.write('[intandem] Disconnected. Reconnecting in 5s...\n');
          reconnectTimer = setTimeout(() => connectToHub(url, token, uname), 5000);
        }
      });

      hubWs.on('error', (err) => {
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
        saveWorkspaceConfig({
          hubUrl: `ws://127.0.0.1:${port}`,
          workspaceId,
          token,
          username: myUsername,
          workspaceName: name,
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

        saveWorkspaceConfig({
          hubUrl: decoded.hubUrl,
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

      // ==================== PEERS ====================
      case 'intandem_peers': {
        if (!connected) return text('Not connected. Create or join a workspace first.');
        if (currentPeers.length === 0) return text('No other peers online.');
        return text(`Online peers: ${currentPeers.join(', ')}`);
      }

      // ==================== LEAVE ====================
      case 'intandem_leave': {
        if (!connected && !hub) return text('Not connected to any workspace.');

        if (reconnectTimer) clearTimeout(reconnectTimer);
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

        return text('Disconnected from workspace.');
      }

      default:
        throw new Error(`Unknown tool: ${req.params.name}`);
    }
  });

  // --- Start MCP ---
  await mcp.connect(new StdioServerTransport());

  // Auto-reconnect if we have a saved config
  if (savedConfig) {
    process.stderr.write(`[intandem] Found saved workspace config, reconnecting...\n`);
    connectToHub(savedConfig.hubUrl, savedConfig.token, savedConfig.username).then(ok => {
      if (ok) {
        myToken = savedConfig.token;
        hubUrl = savedConfig.hubUrl;
        process.stderr.write(`[intandem] Reconnected to "${workspaceName}"\n`);
      } else {
        process.stderr.write(`[intandem] Could not reconnect (hub may be offline). Use intandem_create or intandem_join.\n`);
      }
    });
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
