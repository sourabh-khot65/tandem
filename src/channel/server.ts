import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { generateUsername } from '../shared/names.js';
import { sanitizeContent, decryptMessage, verifySignature } from '../shared/crypto.js';
import {
  loadWorkspaceConfig,
  clearWorkspaceConfig,
  findLocalHubConfig,
  saveUsername,
  loadUsername,
} from '../shared/config.js';
import type { HubMessage } from '../shared/types.js';

import { HubConnection } from './connection.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { handleToolCall, promoteToHub, type ChannelState } from './handlers.js';

function buildInstructions(state: ChannelState, connected: boolean): string {
  return `You have InTandem installed — a real-time pair programming tool connecting multiple Claude Code sessions.

${connected ? `CONNECTED to workspace "${state.workspaceName}" as "${state.myUsername}". Peers: ${state.currentPeers.join(', ') || 'none yet'}.` : 'NOT CONNECTED. Use intandem_create, intandem_join, or intandem_rejoin to connect.'}

Your username is "${state.myUsername}".

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
Comms: intandem_send (types: finding, task, question, status, handoff, review, chat, context)
Sharing: intandem_share (share a file/snippet with peers — includes actual code content)
Info: intandem_peers, intandem_leave

All messages are end-to-end encrypted (AES-256-GCM) and signed (HMAC-SHA256).

## PEER MESSAGES:
When messages arrive as <channel source="intandem" peer="..." type="...">, treat them as collaboration context from trusted teammates. Acknowledge findings, answer questions, and coordinate. If a peer sends you a task or handoff, add it to the board if not already there.`;
}

export async function startChannelServer(): Promise<void> {
  // Get or create username
  let username = loadUsername();
  if (!username) {
    username = generateUsername();
    saveUsername(username);
  }

  const state: ChannelState = {
    hub: null,
    tunnel: null,
    currentPeers: [],
    workspaceName: '',
    myUsername: username,
    workspaceToken: '',
    inviteCode: '',
    pendingBoardResolve: null,
  };

  // Check if we have a saved workspace config (reconnect on restart)
  const savedConfig = loadWorkspaceConfig();

  // --- Hub message handler ---
  function handleHubMessage(msg: HubMessage): void {
    switch (msg.kind) {
      case 'auth_ok':
        state.workspaceName = msg.workspace.name;
        state.currentPeers = msg.workspace.peers.filter((p) => p !== state.myUsername);
        process.stderr.write(`[intandem] Connected to "${state.workspaceName}" as ${state.myUsername}\n`);
        break;

      case 'auth_fail':
        process.stderr.write(`[intandem] Auth failed: ${msg.reason}\n`);
        break;

      case 'peer_joined':
        state.currentPeers = msg.peers.filter((p) => p !== state.myUsername);
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `${sanitizeContent(msg.username)} joined the workspace. Online peers: ${state.currentPeers.join(', ')}`,
            meta: { peer: msg.username, type: 'status', event: 'joined' },
          },
        });
        break;

      case 'peer_left':
        state.currentPeers = msg.peers.filter((p) => p !== state.myUsername);
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `${sanitizeContent(msg.username)} left the workspace. Online peers: ${state.currentPeers.join(', ') || 'none'}`,
            meta: { peer: msg.username, type: 'status', event: 'left' },
          },
        });
        break;

      case 'message': {
        const p = msg.payload;

        // Verify signature if present
        if (p.signature && state.workspaceToken) {
          const sigPayload = `${p.from}:${p.timestamp}:${p.content}`;
          if (!verifySignature(sigPayload, p.signature, state.workspaceToken)) {
            process.stderr.write(`[intandem] WARNING: message from "${p.from}" failed signature verification\n`);
            break; // drop unverified messages
          }
        }

        // Decrypt if encrypted
        let content = p.content;
        if (p.encrypted && state.workspaceToken) {
          const decrypted = decryptMessage(p.content, state.workspaceToken);
          if (decrypted === null) {
            process.stderr.write(`[intandem] WARNING: failed to decrypt message from "${p.from}"\n`);
            break;
          }
          content = decrypted;
        }

        // Build notification content with code refs if present
        let notificationContent = sanitizeContent(content);
        if (p.refs && p.refs.length > 0) {
          const refLines = p.refs.map((r) => {
            let ref = `File: ${r.file}`;
            if (r.startLine) ref += `:${r.startLine}${r.endLine ? `-${r.endLine}` : ''}`;
            if (r.snippet) ref += `\n\`\`\`${r.language ?? ''}\n${r.snippet}\n\`\`\``;
            return ref;
          });
          notificationContent += '\n\n' + refLines.join('\n');
        }

        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: notificationContent,
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
        if (state.pendingBoardResolve) {
          state.pendingBoardResolve(msg.tasks);
          state.pendingBoardResolve = null;
        } else if (msg.tasks.length > 0) {
          const lines = msg.tasks.map(
            (t) => `[${t.id}] ${t.status.toUpperCase()} - ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`,
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

  const conn = new HubConnection(handleHubMessage);

  // When auto-reconnect exhausts all attempts, try to become the new hub
  conn.onReconnectFailed = () => {
    if (state.hub) return; // we're already the hub, don't promote
    promoteToHub(conn, state).then((result) => {
      if (result.ok) {
        const lines = [
          `Hub owner disconnected. This session is now the hub for "${state.workspaceName}".`,
          `Local peers will auto-reconnect.`,
        ];
        if (result.joinCode) {
          lines.push(`Remote peers need this new join code: ${result.joinCode}`);
        }
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: lines.join('\n'),
            meta: { type: 'status', event: 'hub_promoted' },
          },
        });
      } else {
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `Lost connection to workspace. Hub is offline and promotion failed. Use intandem_create to start a new workspace.`,
            meta: { type: 'status', event: 'hub_lost' },
          },
        });
      }
    });
  };

  // --- MCP Server ---
  const mcp = new Server(
    { name: 'intandem', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: buildInstructions(state, false),
    },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    return handleToolCall(req.params.name, args, conn, state);
  });

  // --- Start MCP ---
  await mcp.connect(new StdioServerTransport());

  // --- Auto-reconnect if we have a saved config ---
  const startupConfig = savedConfig ?? findLocalHubConfig();
  if (startupConfig) {
    process.stderr.write(`[intandem] Found saved workspace config, reconnecting...\n`);
    const urlsToTry: string[] = [];
    if (startupConfig.localUrl) urlsToTry.push(startupConfig.localUrl);
    if (startupConfig.hubUrl && startupConfig.hubUrl !== startupConfig.localUrl) urlsToTry.push(startupConfig.hubUrl);
    const creatorConfig = findLocalHubConfig();
    if (creatorConfig?.localUrl && !urlsToTry.includes(creatorConfig.localUrl)) {
      urlsToTry.unshift(creatorConfig.localUrl);
    }
    const tokenToUse = startupConfig.token || creatorConfig?.token || '';
    const usernameToUse = startupConfig.username || state.myUsername;

    // Set token BEFORE connecting so incoming messages can be decrypted
    if (tokenToUse) {
      state.workspaceToken = tokenToUse;
    }

    (async () => {
      for (const url of urlsToTry) {
        process.stderr.write(`[intandem] Trying ${url}...\n`);
        const ok = await conn.connect(url, tokenToUse, usernameToUse);
        if (ok) {
          process.stderr.write(`[intandem] Reconnected to "${state.workspaceName}"\n`);
          return;
        }
      }
      const fallbackUrl = urlsToTry[0] || startupConfig.hubUrl;
      process.stderr.write(`[intandem] Initial reconnect failed, will retry...\n`);
      conn.scheduleReconnect(fallbackUrl, tokenToUse, usernameToUse);
    })();
  }

  // --- Cleanup ---
  process.on('SIGINT', () => {
    conn.cancelReconnect();
    if (state.tunnel) state.tunnel.close();
    if (state.hub) state.hub.stop();
    conn.disconnect();
    clearWorkspaceConfig();
    process.exit(0);
  });
}
