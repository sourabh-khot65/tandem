import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { TandemDB } from './db.js';
import { generateWorkspaceId, generateToken, createJoinCode } from '../shared/crypto.js';
import type { HubMessage, PeerInfo, PeerMessage, TaskItem, MessageType } from '../shared/types.js';

const VALID_MESSAGE_TYPES: MessageType[] = [
  'finding',
  'task',
  'question',
  'status',
  'handoff',
  'review',
  'chat',
  'context',
];
const VALID_TASK_STATUSES: TaskItem['status'][] = ['open', 'blocked', 'claimed', 'in_progress', 'done'];

interface ConnectedPeer {
  ws: WebSocket;
  username: string;
  sessionId: string;
  connectedAt: number;
  lastMessageAt: number;
  messageCount: number; // rolling window for rate limiting
  alive: boolean; // ping/pong liveness tracking
}

interface Workspace {
  id: string;
  name: string;
  token: string;
  maxPeers: number;
  inviteCode?: string; // short human-readable code
  peers: Map<string, ConnectedPeer>;
  knownSessions: Set<string>;
  db: TandemDB;
}

export interface HubOptions {
  port: number;
  host?: string;
}

// One-time auth tickets for invite code resolution (C1 fix)
interface AuthTicket {
  token: string;
  workspaceId: string;
  createdAt: number;
}

const TICKET_TTL_MS = 30_000; // tickets expire after 30 seconds
const MAX_INVITE_ATTEMPTS_PER_MIN = 5;
const MAX_WS_PAYLOAD = 64 * 1024; // 64KB max WebSocket message (H4 fix)

export class TandemHub {
  private wss: WebSocketServer | null = null;
  private workspaces = new Map<string, Workspace>();
  private inviteCodes = new Map<string, Workspace>();
  private authTickets = new Map<string, AuthTicket>(); // ticket → auth info
  private inviteAttempts = new Map<string, { count: number; resetAt: number }>(); // IP → attempts
  private rateLimitWindow = 60_000; // 1 minute
  private maxMessagesPerWindow = 30;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private rateLimitInterval: ReturnType<typeof setInterval> | null = null;

  createWorkspace(name: string, maxPeers = 5): { workspaceId: string; token: string } {
    const workspaceId = generateWorkspaceId();
    const token = generateToken();

    const workspace: Workspace = {
      id: workspaceId,
      name,
      token,
      maxPeers: Math.min(maxPeers, 5),
      peers: new Map(),
      knownSessions: new Set(),
      db: new TandemDB(workspaceId),
    };

    this.workspaces.set(workspaceId, workspace);
    return { workspaceId, token };
  }

  /** Adopt an existing workspace (reuses the SQLite DB). Used for hub ownership transfer. */
  adoptWorkspace(workspaceId: string, name: string, token: string, maxPeers = 5): void {
    const workspace: Workspace = {
      id: workspaceId,
      name,
      token,
      maxPeers: Math.min(maxPeers, 5),
      peers: new Map(),
      knownSessions: new Set(),
      db: new TandemDB(workspaceId), // reuses existing DB file
    };
    this.workspaces.set(workspaceId, workspace);
  }

  start(options: HubOptions): Promise<{ port: number; joinCodes: Map<string, string> }> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        port: options.port,
        host: options.host ?? '127.0.0.1',
        maxPayload: MAX_WS_PAYLOAD,
      });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        const actualPort = typeof addr === 'object' && addr !== null ? addr.port : options.port;
        const hubUrl = `ws://${options.host ?? '127.0.0.1'}:${actualPort}`;

        // Generate join codes now that we know the URL
        const joinCodes = new Map<string, string>();
        for (const [id, ws] of this.workspaces) {
          const code = createJoinCode(hubUrl, id, ws.token);
          joinCodes.set(id, code);
        }

        resolve({ port: actualPort, joinCodes });
      });

      this.wss.on('connection', (ws) => this.handleConnection(ws));

      // Rate limit reset timer
      this.rateLimitInterval = setInterval(() => this.resetRateLimits(), this.rateLimitWindow);

      // Ping all peers every 30s to detect dead connections
      this.pingInterval = setInterval(() => this.pingAllPeers(), 30_000);
    });
  }

  private handleConnection(ws: WebSocket): void {
    let authenticated = false;
    let workspace: Workspace | null = null;
    let peerUsername: string | null = null;

    // Auth timeout: must authenticate within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        this.send(ws, { kind: 'auth_fail', reason: 'Authentication timeout' });
        ws.close();
      }
    }, 10_000);

    ws.on('message', (data) => {
      let msg: HubMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        this.send(ws, { kind: 'error', message: 'Invalid JSON' });
        return;
      }

      // Allow invite resolution without authentication — returns a one-time ticket, NOT the token (C1 fix)
      if (msg.kind === 'invite_resolve') {
        // Rate limit per remote address
        const remoteAddr =
          (ws as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress ?? 'unknown';
        const now = Date.now();
        const attempts = this.inviteAttempts.get(remoteAddr);
        if (attempts) {
          if (now > attempts.resetAt) {
            attempts.count = 0;
            attempts.resetAt = now + 60_000;
          }
          if (attempts.count >= MAX_INVITE_ATTEMPTS_PER_MIN) {
            this.send(ws, { kind: 'invite_fail', reason: 'Too many attempts. Try again later.' });
            return;
          }
          attempts.count++;
        } else {
          this.inviteAttempts.set(remoteAddr, { count: 1, resetAt: now + 60_000 });
        }

        const target = this.inviteCodes.get(msg.inviteCode);
        if (target) {
          // Generate a one-time ticket instead of returning raw token
          const ticket = randomBytes(16).toString('base64url');
          this.authTickets.set(ticket, { token: target.token, workspaceId: target.id, createdAt: now });
          // Clean expired tickets
          for (const [t, info] of this.authTickets) {
            if (now - info.createdAt > TICKET_TTL_MS) this.authTickets.delete(t);
          }
          this.send(ws, { kind: 'invite_result', hubUrl: '', workspaceId: target.id, token: ticket });
        } else {
          this.send(ws, { kind: 'invite_fail', reason: 'Invalid invite code' });
        }
        return;
      }

      if (!authenticated) {
        if (msg.kind !== 'auth') {
          this.send(ws, { kind: 'error', message: 'Must authenticate first' });
          return;
        }
        this.handleAuth(ws, msg, (w, u) => {
          clearTimeout(authTimeout);
          authenticated = true;
          workspace = w;
          peerUsername = u;
        });
        return;
      }

      // Authenticated messages
      if (!workspace || !peerUsername) return;

      switch (msg.kind) {
        case 'message':
          this.handleMessage(workspace, peerUsername, msg.payload);
          break;
        case 'board':
          this.sendBoard(ws, workspace);
          break;
        case 'board_update':
          this.handleBoardUpdate(ws, workspace, peerUsername, msg.task);
          break;
        case 'peers':
          this.sendPeers(ws, workspace);
          break;
        case 'invite_register':
          workspace.inviteCode = msg.inviteCode;
          this.inviteCodes.set(msg.inviteCode, workspace);
          break;
        case 'capabilities':
          // Store and broadcast peer capabilities
          this.broadcastToWorkspace(
            workspace,
            {
              kind: 'capabilities',
              username: peerUsername,
              cwd: msg.cwd,
              tools: msg.tools,
            },
            peerUsername,
          );
          break;
        case 'activity_log_request':
          this.send(ws, { kind: 'activity_log', entries: workspace.db.getActivityLog(msg.limit ?? 30) });
          break;
        case 'var_set':
          this.handleVarSet(ws, workspace, peerUsername, msg.key, msg.value);
          break;
        case 'var_get':
          this.handleVarGet(ws, workspace, msg.key);
          break;
        // invite_resolve handled pre-auth above
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (workspace && peerUsername) {
        // Only remove if this ws is still the registered one (not replaced by a reconnect)
        const currentPeer = workspace.peers.get(peerUsername);
        if (currentPeer && currentPeer.ws === ws) {
          workspace.peers.delete(peerUsername);
          try {
            workspace.db.logActivity(peerUsername, 'left');
          } catch {
            // DB may already be closed during shutdown
          }
          this.broadcastToWorkspace(workspace, {
            kind: 'peer_left',
            username: peerUsername,
            peers: Array.from(workspace.peers.keys()),
          });
        }
      }
    });

    ws.on('error', () => {
      // Handled by close event
    });
  }

  private handleAuth(
    ws: WebSocket,
    msg: Extract<HubMessage, { kind: 'auth' }>,
    onSuccess: (workspace: Workspace, username: string) => void,
  ): void {
    // Resolve auth ticket to real token if applicable (C1 fix)
    let authToken = msg.token;
    const ticket = this.authTickets.get(msg.token);
    if (ticket) {
      const now = Date.now();
      this.authTickets.delete(msg.token); // one-time use
      if (now - ticket.createdAt > TICKET_TTL_MS) {
        this.send(ws, { kind: 'auth_fail', reason: 'Ticket expired. Request a new invite code.' });
        ws.close();
        return;
      }
      authToken = ticket.token;
    }

    // Find workspace by token
    let targetWorkspace: Workspace | null = null;
    for (const w of this.workspaces.values()) {
      if (w.token === authToken) {
        targetWorkspace = w;
        break;
      }
    }

    if (!targetWorkspace) {
      this.send(ws, { kind: 'auth_fail', reason: 'Invalid token' });
      ws.close();
      return;
    }

    // Prune dead peers before checking capacity
    for (const [u, p] of targetWorkspace.peers) {
      if (p.ws.readyState === WebSocket.CLOSED || p.ws.readyState === WebSocket.CLOSING) {
        targetWorkspace.peers.delete(u);
        process.stderr.write(`[hub] Pruned dead peer "${u}" during auth\n`);
      }
    }

    // Check capacity
    if (targetWorkspace.peers.size >= targetWorkspace.maxPeers) {
      this.send(ws, { kind: 'auth_fail', reason: `Workspace full (${targetWorkspace.maxPeers} peers max)` });
      ws.close();
      return;
    }

    // Check username collision
    let username = msg.username;
    const existingPeer = targetWorkspace.peers.get(username);
    if (existingPeer) {
      if (existingPeer.sessionId === msg.sessionId) {
        // Same session reconnecting — kick stale connection, reuse name
        process.stderr.write(`[hub] Replacing stale connection for "${username}" (same session)\n`);
        existingPeer.ws.close();
        targetWorkspace.peers.delete(username);
      } else {
        // Different session with same username — append suffix to avoid kick loop
        username = `${username}-${randomBytes(2).toString('hex')}`;
        process.stderr.write(`[hub] Username collision, renamed to "${username}"\n`);
      }
    }

    const peer: ConnectedPeer = {
      ws,
      username,
      sessionId: msg.sessionId,
      connectedAt: Date.now(),
      lastMessageAt: 0,
      messageCount: 0,
      alive: true,
    };

    ws.on('pong', () => {
      const p = targetWorkspace.peers.get(username);
      if (p && p.ws === ws) p.alive = true;
    });

    targetWorkspace.peers.set(username, peer);
    targetWorkspace.db.logActivity(username, 'joined', `Session ${msg.sessionId.slice(0, 8)}`);

    this.send(ws, {
      kind: 'auth_ok',
      username, // actual username after collision rename
      token: targetWorkspace.token, // real token for E2E encryption
      workspace: {
        name: targetWorkspace.name,
        id: targetWorkspace.id,
        peers: Array.from(targetWorkspace.peers.keys()),
        maxPeers: targetWorkspace.maxPeers,
        inviteCode: targetWorkspace.inviteCode,
      },
    });

    // Notify others
    this.broadcastToWorkspace(
      targetWorkspace,
      {
        kind: 'peer_joined',
        username,
        peers: Array.from(targetWorkspace.peers.keys()),
      },
      username,
    );

    // Auto-push board and recent messages only on first connect (not reconnect)
    const isFirstConnect = !targetWorkspace.knownSessions.has(msg.sessionId);
    targetWorkspace.knownSessions.add(msg.sessionId);

    const tasks = targetWorkspace.db.getAllTasks();
    if (tasks.length > 0) {
      this.send(ws, { kind: 'board', tasks });
    }
    if (isFirstConnect) {
      const recentMessages = targetWorkspace.db.getRecentMessages(10);
      for (const recentMsg of recentMessages) {
        if (!VALID_MESSAGE_TYPES.includes(recentMsg.type as MessageType)) continue;
        this.send(ws, {
          kind: 'message',
          payload: {
            type: recentMsg.type as PeerMessage['type'],
            from: recentMsg.from,
            to: recentMsg.to,
            content: recentMsg.content,
            timestamp: recentMsg.timestamp,
          },
        });
      }
    }

    onSuccess(targetWorkspace, username);
  }

  private handleMessage(workspace: Workspace, from: string, payload: PeerMessage): void {
    const peer = workspace.peers.get(from);
    if (!peer) return;

    // H1 fix: enforce sender identity — hub overwrites from field with authenticated username
    payload.from = from;

    // Rate limiting
    peer.messageCount++;
    if (peer.messageCount > this.maxMessagesPerWindow) {
      this.send(peer.ws, { kind: 'error', message: 'Rate limit exceeded. Slow down.' });
      return;
    }
    peer.lastMessageAt = Date.now();

    // H2 fix: reject messages with stale timestamps (replay protection)
    const now = Date.now();
    if (Math.abs(now - payload.timestamp) > 120_000) {
      this.send(peer.ws, { kind: 'error', message: 'Message timestamp too old or in the future. Rejected.' });
      return;
    }

    // Log activity and message to DB
    workspace.db.logActivity(from, 'message', `${payload.type}${payload.to ? ` → ${payload.to}` : ' (broadcast)'}`);
    workspace.db.logMessage({
      type: payload.type,
      from: payload.from,
      to: payload.to,
      content: payload.content,
      timestamp: payload.timestamp,
    });

    // Route: specific peer or broadcast
    const deliveredTo: string[] = [];
    if (payload.to) {
      const target = workspace.peers.get(payload.to);
      if (target) {
        this.send(target.ws, { kind: 'message', payload });
        deliveredTo.push(payload.to);
      } else {
        this.send(peer.ws, { kind: 'error', message: `Peer "${payload.to}" not found` });
      }
    } else {
      // Broadcast to all except sender
      for (const [username, p] of workspace.peers) {
        if (username !== from && p.ws.readyState === WebSocket.OPEN) {
          this.send(p.ws, { kind: 'message', payload });
          deliveredTo.push(username);
        }
      }
    }

    // Send delivery receipt back to sender
    if (payload.msgId && deliveredTo.length > 0) {
      this.send(peer.ws, { kind: 'msg_ack', msgId: payload.msgId, deliveredTo });
    }
  }

  private handleBoardUpdate(ws: WebSocket, workspace: Workspace, from: string, task: TaskItem): void {
    if (!VALID_TASK_STATUSES.includes(task.status)) {
      this.send(ws, { kind: 'error', message: `Invalid task status: ${task.status}` });
      return;
    }

    // H5 fix: validate field lengths to prevent DoS
    if (task.title && task.title.length > 500) {
      this.send(ws, { kind: 'error', message: 'Task title too long (max 500 chars)' });
      return;
    }
    if (task.description && task.description.length > 2000) {
      this.send(ws, { kind: 'error', message: 'Task description too long (max 2000 chars)' });
      return;
    }

    const existing = workspace.db.getTask(task.id);
    if (existing) {
      // Authorization: who can modify this task?
      const isCreator = existing.createdBy === from;
      const isAssignee = existing.assignee === from;
      const isClaimingOpen = task.status === 'claimed' && (!existing.assignee || existing.status === 'open');

      // Protect tasks actively owned by another peer:
      // If someone else has claimed or is working on it, only they can change it
      // (creator can still edit title/description but not change status/assignee)
      const ownedByOther =
        existing.assignee &&
        existing.assignee !== from &&
        (existing.status === 'claimed' || existing.status === 'in_progress');

      if (ownedByOther && !isAssignee) {
        // Allow creator to edit title/description only, not status/assignee
        if (isCreator && task.status === existing.status && !task.assignee) {
          // Creator editing metadata only — allow below
        } else {
          this.send(ws, {
            kind: 'board_reject',
            taskId: task.id,
            reason: `Task "${existing.title}" is ${existing.status} by ${existing.assignee}. Only they can update it.`,
          });
          return;
        }
      }

      if (!isCreator && !isAssignee && !isClaimingOpen) {
        this.send(ws, {
          kind: 'board_reject',
          taskId: task.id,
          reason: `Only the creator or assignee can modify task "${existing.title}"`,
        });
        return;
      }

      // Reject claim if task is already taken by someone else
      if (
        task.status === 'claimed' &&
        task.assignee &&
        existing.assignee &&
        existing.assignee !== from &&
        (existing.status === 'claimed' || existing.status === 'in_progress')
      ) {
        this.send(ws, {
          kind: 'board_reject',
          taskId: task.id,
          reason: `Task "${existing.title}" is already ${existing.status} by ${existing.assignee}`,
        });
        return;
      }

      // Only update fields that have meaningful values (non-empty strings)
      const updates: Partial<
        Pick<TaskItem, 'status' | 'assignee' | 'title' | 'description' | 'priority' | 'dependsOn'>
      > = {
        status: task.status,
      };
      if (task.assignee !== undefined) updates.assignee = task.assignee || '';
      if (task.title) updates.title = task.title;
      if (task.description !== undefined) updates.description = task.description;
      if (task.priority) updates.priority = task.priority;
      if (task.dependsOn) updates.dependsOn = task.dependsOn;
      const updated = workspace.db.updateTask(task.id, updates);
      if (updated) {
        workspace.db.logActivity(
          from,
          'task_update',
          `[${task.id}] → ${task.status}${task.assignee ? ` (${task.assignee})` : ''}`,
        );
        this.broadcastToWorkspace(workspace, { kind: 'board_update', task: updated, triggeredBy: from });

        // When a task completes, unblock dependent tasks
        if (updated.status === 'done') {
          this.resolveBlockedTasks(workspace, updated.id, from);
        }
      }
    } else {
      // H5 fix: enforce createdBy on new tasks
      task.createdBy = from;
      // Auto-set blocked status if task has unfinished dependencies
      if (task.dependsOn && task.dependsOn.length > 0) {
        const allDone = task.dependsOn.every((depId) => {
          const dep = workspace.db.getTask(depId);
          return dep && dep.status === 'done';
        });
        if (!allDone) task.status = 'blocked';
      }
      workspace.db.createTask(task);
      workspace.db.logActivity(
        from,
        'task_create',
        `[${task.id}] ${task.title}${task.priority ? ` (${task.priority})` : ''}`,
      );
      this.broadcastToWorkspace(workspace, { kind: 'board_update', task, triggeredBy: from });
    }
  }

  /** When a task completes, check if any blocked tasks can be unblocked */
  private resolveBlockedTasks(workspace: Workspace, completedTaskId: string, triggeredBy: string): void {
    const allTasks = workspace.db.getAllTasks();
    for (const t of allTasks) {
      if (t.status !== 'blocked' || !t.dependsOn) continue;
      if (!t.dependsOn.includes(completedTaskId)) continue;

      // Check if ALL dependencies are now done
      const allDone = t.dependsOn.every((depId) => {
        const dep = workspace.db.getTask(depId);
        return dep && dep.status === 'done';
      });

      if (allDone) {
        const updated = workspace.db.updateTask(t.id, { status: 'open' });
        if (updated) {
          workspace.db.logActivity('system', 'task_unblocked', `[${t.id}] ${t.title} — all dependencies met`);
          this.broadcastToWorkspace(workspace, { kind: 'board_update', task: updated, triggeredBy });
        }
      }
    }
  }

  private handleVarSet(ws: WebSocket, workspace: Workspace, from: string, key: string, value: string): void {
    if (key.length > 100) {
      this.send(ws, { kind: 'error', message: 'Variable key too long (max 100 chars)' });
      return;
    }
    if (value.length > 5000) {
      this.send(ws, { kind: 'error', message: 'Variable value too long (max 5000 chars)' });
      return;
    }
    workspace.db.setVar(key, value, from);
    this.broadcastToWorkspace(workspace, { kind: 'var_set', key, value, setBy: from });
  }

  private handleVarGet(ws: WebSocket, workspace: Workspace, key: string): void {
    if (key === '*') {
      // Return all vars
      const vars = workspace.db.getAllVars();
      this.send(ws, { kind: 'vars_list', vars });
    } else {
      const result = workspace.db.getVar(key);
      this.send(ws, {
        kind: 'var_result',
        key,
        value: result?.value ?? null,
        setBy: result?.setBy,
      });
    }
  }

  private sendBoard(ws: WebSocket, workspace: Workspace): void {
    this.send(ws, { kind: 'board', tasks: workspace.db.getAllTasks() });
  }

  private sendPeers(ws: WebSocket, workspace: Workspace): void {
    const list: PeerInfo[] = [];
    for (const [username, peer] of workspace.peers) {
      list.push({
        username,
        connectedAt: peer.connectedAt,
        lastActiveAt: peer.lastMessageAt || peer.connectedAt,
      });
    }
    this.send(ws, { kind: 'peers', list });
  }

  private broadcastToWorkspace(workspace: Workspace, msg: HubMessage, excludeUsername?: string): void {
    const dead: string[] = [];
    for (const [username, peer] of workspace.peers) {
      if (peer.ws.readyState === WebSocket.CLOSED || peer.ws.readyState === WebSocket.CLOSING) {
        dead.push(username);
        continue;
      }
      if (username !== excludeUsername && peer.ws.readyState === WebSocket.OPEN) {
        this.send(peer.ws, msg);
      }
    }
    // Prune dead peers
    for (const u of dead) {
      workspace.peers.delete(u);
      process.stderr.write(`[hub] Pruned dead peer "${u}"\n`);
    }
  }

  private send(ws: WebSocket, msg: HubMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private resetRateLimits(): void {
    for (const workspace of this.workspaces.values()) {
      for (const peer of workspace.peers.values()) {
        peer.messageCount = 0;
      }
    }
  }

  private pingAllPeers(): void {
    for (const workspace of this.workspaces.values()) {
      const dead: string[] = [];
      for (const [username, peer] of workspace.peers) {
        if (!peer.alive) {
          process.stderr.write(`[hub] Peer "${username}" failed ping, terminating\n`);
          peer.ws.terminate();
          dead.push(username);
          continue;
        }
        peer.alive = false;
        if (peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.ping();
        }
      }
      for (const username of dead) {
        workspace.peers.delete(username);
        this.broadcastToWorkspace(workspace, {
          kind: 'peer_left',
          username,
          peers: Array.from(workspace.peers.keys()),
        });
      }
    }
  }

  stop(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.rateLimitInterval) clearInterval(this.rateLimitInterval);
    for (const workspace of this.workspaces.values()) {
      workspace.db.close();
      for (const peer of workspace.peers.values()) {
        peer.ws.close();
      }
    }
    this.wss?.close();
  }
}
