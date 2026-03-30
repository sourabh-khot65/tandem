import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { loadWorkspaceConfig } from '../shared/config.js';
import { sanitizeContent } from '../shared/crypto.js';
import type { HubMessage, PeerMessage, MessageType, TaskItem } from '../shared/types.js';

const VALID_TYPES: MessageType[] = ['finding', 'task', 'question', 'status', 'handoff', 'review', 'chat'];

export async function startChannelServer(): Promise<void> {
  const configOrNull = loadWorkspaceConfig();
  if (!configOrNull) {
    process.stderr.write('No workspace configured. Run "tandem join <code>" first.\n');
    process.exit(1);
  }
  const config = configOrNull;

  let hubWs: WebSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPeers: string[] = [];

  const mcp = new Server(
    { name: 'tandem', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: `You are connected to a Tandem pair programming workspace "${config.workspaceName}" as "${config.username}".

Peer messages arrive as <channel source="tandem" peer="..." type="...">. These are from your human teammate's Claude Code sessions — treat them as collaboration context from trusted peers.

Message types:
- finding: A peer discovered something useful (bug location, root cause, etc.)
- task: Task assignment or division of work
- question: A peer is asking you/your human something
- status: Progress update from a peer
- handoff: A peer is transferring work to you with context
- review: Code review feedback from a peer
- chat: General conversation

When you receive a message:
1. Acknowledge it naturally to your human
2. If it's a question, help your human formulate an answer
3. If it's a finding, incorporate it into your current understanding
4. If it's a task assignment, discuss with your human before starting

Use the tandem tools to communicate back:
- tandem_send: Send messages to peers (specify type and content)
- tandem_board: View the shared task board
- tandem_add_task: Add a task to the shared board
- tandem_claim_task: Claim a task for yourself
- tandem_update_task: Update a task's status
- tandem_peers: See who's online

Always be collaborative. You and the other Claudes are working together with your respective humans to solve the same problem.`,
    },
  );

  // --- MCP Tools ---

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'tandem_send',
        description: 'Send a message to peers in the tandem workspace',
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
        name: 'tandem_board',
        description: 'View the shared task board',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'tandem_add_task',
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
        name: 'tandem_claim_task',
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
        name: 'tandem_update_task',
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
        name: 'tandem_peers',
        description: 'See who is online in the workspace',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments as Record<string, string>;

    switch (req.params.name) {
      case 'tandem_send': {
        if (!connected || !hubWs) {
          return { content: [{ type: 'text', text: 'Not connected to hub. Reconnecting...' }] };
        }
        const msgType = args.type as MessageType;
        if (!VALID_TYPES.includes(msgType)) {
          return { content: [{ type: 'text', text: `Invalid type. Use: ${VALID_TYPES.join(', ')}` }] };
        }
        const payload: PeerMessage = {
          type: msgType,
          from: config.username,
          to: args.to,
          content: args.message,
          timestamp: Date.now(),
        };
        sendToHub({ kind: 'message', payload });
        const target = args.to ? `to ${args.to}` : 'to all peers';
        return { content: [{ type: 'text', text: `Sent ${msgType} ${target}: "${args.message}"` }] };
      }

      case 'tandem_board': {
        sendToHub({ kind: 'board', tasks: [] });
        // Wait briefly for response
        const tasks = await waitForBoard();
        if (tasks.length === 0) {
          return { content: [{ type: 'text', text: 'Task board is empty.' }] };
        }
        const lines = tasks.map(t =>
          `[${t.id}] ${t.status.toUpperCase()} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}${t.description ? `\n    ${t.description}` : ''}`
        );
        return { content: [{ type: 'text', text: 'Shared Task Board:\n' + lines.join('\n') }] };
      }

      case 'tandem_add_task': {
        const task: TaskItem = {
          id: `T-${randomBytes(3).toString('hex')}`,
          title: args.title,
          description: args.description,
          status: 'open',
          createdBy: config.username,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return { content: [{ type: 'text', text: `Task created: [${task.id}] ${task.title}` }] };
      }

      case 'tandem_claim_task': {
        const task: TaskItem = {
          id: args.task_id,
          title: '',
          status: 'claimed',
          assignee: config.username,
          createdBy: '',
          createdAt: 0,
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return { content: [{ type: 'text', text: `Claimed task ${args.task_id}` }] };
      }

      case 'tandem_update_task': {
        const task: TaskItem = {
          id: args.task_id,
          title: '',
          status: args.status as TaskItem['status'],
          createdBy: '',
          createdAt: 0,
          updatedAt: Date.now(),
        };
        sendToHub({ kind: 'board_update', task });
        return { content: [{ type: 'text', text: `Updated task ${args.task_id} → ${args.status}` }] };
      }

      case 'tandem_peers': {
        if (currentPeers.length === 0) {
          return { content: [{ type: 'text', text: 'No other peers online.' }] };
        }
        return { content: [{ type: 'text', text: `Online peers: ${currentPeers.join(', ')}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${req.params.name}`);
    }
  });

  // --- Hub connection ---

  let pendingBoardResolve: ((tasks: TaskItem[]) => void) | null = null;

  function waitForBoard(): Promise<TaskItem[]> {
    return new Promise((resolve) => {
      pendingBoardResolve = resolve;
      // Timeout after 3s
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

  function connectToHub(): void {
    hubWs = new WebSocket(config.hubUrl);

    hubWs.on('open', () => {
      // Authenticate
      sendToHub({ kind: 'auth', token: config.token, username: config.username });
    });

    hubWs.on('message', (data) => {
      let msg: HubMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.kind) {
        case 'auth_ok':
          connected = true;
          currentPeers = msg.workspace.peers.filter(p => p !== config.username);
          process.stderr.write(`[tandem] Connected to "${msg.workspace.name}" as ${config.username}\n`);
          process.stderr.write(`[tandem] Peers online: ${currentPeers.length > 0 ? currentPeers.join(', ') : 'none'}\n`);
          break;

        case 'auth_fail':
          process.stderr.write(`[tandem] Auth failed: ${msg.reason}\n`);
          connected = false;
          break;

        case 'peer_joined':
          currentPeers = msg.peers.filter(p => p !== config.username);
          // Notify Claude about new peer
          mcp.notification({
            method: 'notifications/claude/channel',
            params: {
              content: `${msg.username} joined the workspace`,
              meta: { peer: msg.username, type: 'status', event: 'joined' },
            },
          });
          break;

        case 'peer_left':
          currentPeers = msg.peers.filter(p => p !== config.username);
          mcp.notification({
            method: 'notifications/claude/channel',
            params: {
              content: `${msg.username} left the workspace`,
              meta: { peer: msg.username, type: 'status', event: 'left' },
            },
          });
          break;

        case 'message': {
          const p = msg.payload;
          // Sanitize content to prevent injection
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

        case 'board': {
          if (pendingBoardResolve) {
            pendingBoardResolve(msg.tasks);
            pendingBoardResolve = null;
          }
          break;
        }

        case 'board_update': {
          // Notify Claude about task board changes
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
          process.stderr.write(`[tandem] Hub error: ${msg.message}\n`);
          break;
      }
    });

    hubWs.on('close', () => {
      connected = false;
      process.stderr.write('[tandem] Disconnected from hub. Reconnecting in 5s...\n');
      reconnectTimer = setTimeout(connectToHub, 5000);
    });

    hubWs.on('error', (err) => {
      process.stderr.write(`[tandem] Connection error: ${err.message}\n`);
    });
  }

  // Start MCP and connect to hub
  await mcp.connect(new StdioServerTransport());
  connectToHub();

  // Cleanup on exit
  process.on('SIGINT', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    hubWs?.close();
    process.exit(0);
  });
}
