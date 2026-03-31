import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { TandemDB } from './db.js';
import { generateWorkspaceId, generateToken, createJoinCode } from '../shared/crypto.js';
import type { HubMessage, PeerInfo, PeerMessage, TaskItem } from '../shared/types.js';

interface ConnectedPeer {
  ws: WebSocket;
  username: string;
  sessionId: string;
  connectedAt: number;
  currentTask?: string;
  lastMessageAt: number;
  messageCount: number; // rolling window for rate limiting
  alive: boolean; // ping/pong liveness tracking
}

interface Workspace {
  id: string;
  name: string;
  token: string;
  maxPeers: number;
  peers: Map<string, ConnectedPeer>;
  knownSessions: Set<string>; // sessionIds that have connected before (skip replay on reconnect)
  db: TandemDB;
}

export interface HubOptions {
  port: number;
  host?: string;
}

export class TandemHub {
  private wss: WebSocketServer | null = null;
  private workspaces = new Map<string, Workspace>();
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

  start(options: HubOptions): Promise<{ port: number; joinCodes: Map<string, string> }> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        port: options.port,
        host: options.host ?? '127.0.0.1',
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
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (workspace && peerUsername) {
        // Only remove if this ws is still the registered one (not replaced by a reconnect)
        const currentPeer = workspace.peers.get(peerUsername);
        if (currentPeer && currentPeer.ws === ws) {
          workspace.peers.delete(peerUsername);
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
    // Find workspace by token
    let targetWorkspace: Workspace | null = null;
    for (const w of this.workspaces.values()) {
      if (w.token === msg.token) {
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

    this.send(ws, {
      kind: 'auth_ok',
      workspace: {
        name: targetWorkspace.name,
        id: targetWorkspace.id,
        peers: Array.from(targetWorkspace.peers.keys()),
        maxPeers: targetWorkspace.maxPeers,
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

    // Rate limiting
    peer.messageCount++;
    if (peer.messageCount > this.maxMessagesPerWindow) {
      this.send(peer.ws, { kind: 'error', message: 'Rate limit exceeded. Slow down.' });
      return;
    }
    peer.lastMessageAt = Date.now();

    // Log to DB
    workspace.db.logMessage({
      type: payload.type,
      from: payload.from,
      to: payload.to,
      content: payload.content,
      timestamp: payload.timestamp,
    });

    // Route: specific peer or broadcast
    if (payload.to) {
      const target = workspace.peers.get(payload.to);
      if (target) {
        this.send(target.ws, { kind: 'message', payload });
      } else {
        this.send(peer.ws, { kind: 'error', message: `Peer "${payload.to}" not found` });
      }
    } else {
      // Broadcast to all except sender
      this.broadcastToWorkspace(workspace, { kind: 'message', payload }, from);
    }
  }

  private handleBoardUpdate(ws: WebSocket, workspace: Workspace, from: string, task: TaskItem): void {
    const existing = workspace.db.getTask(task.id);
    if (existing) {
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
      const updates: Partial<Pick<TaskItem, 'status' | 'assignee' | 'title' | 'description'>> = {
        status: task.status,
      };
      if (task.assignee !== undefined) updates.assignee = task.assignee;
      if (task.title) updates.title = task.title;
      if (task.description !== undefined) updates.description = task.description;
      const updated = workspace.db.updateTask(task.id, updates);
      if (updated) {
        this.broadcastToWorkspace(workspace, { kind: 'board_update', task: updated });
      }
    } else {
      workspace.db.createTask(task);
      this.broadcastToWorkspace(workspace, { kind: 'board_update', task });
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
        currentTask: peer.currentTask,
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
