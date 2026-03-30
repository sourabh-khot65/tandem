import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { TandemDB } from './db.js';
import { generateWorkspaceId, generateToken, createJoinCode, signMessage, verifySignature } from '../shared/crypto.js';
import type { HubMessage, PeerInfo, PeerMessage, TaskItem } from '../shared/types.js';

interface ConnectedPeer {
  ws: WebSocket;
  username: string;
  connectedAt: number;
  currentTask?: string;
  lastMessageAt: number;
  messageCount: number; // rolling window for rate limiting
}

interface Workspace {
  id: string;
  name: string;
  token: string;
  maxPeers: number;
  peers: Map<string, ConnectedPeer>;
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

  createWorkspace(name: string, maxPeers = 5): { workspaceId: string; token: string; joinCode: string } {
    const workspaceId = generateWorkspaceId();
    const token = generateToken();

    const workspace: Workspace = {
      id: workspaceId,
      name,
      token,
      maxPeers: Math.min(maxPeers, 5),
      peers: new Map(),
      db: new TandemDB(workspaceId),
    };

    this.workspaces.set(workspaceId, workspace);
    return { workspaceId, token, joinCode: '' }; // joinCode set after hub URL is known
  }

  start(options: HubOptions): Promise<{ port: number; joinCodes: Map<string, string> }> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        port: options.port,
        host: options.host ?? '127.0.0.1',
      });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        const actualPort = (typeof addr === 'object' && addr !== null) ? addr.port : options.port;
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
      setInterval(() => this.resetRateLimits(), this.rateLimitWindow);
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
          this.handleBoardUpdate(workspace, peerUsername, msg.task);
          break;
        case 'peers':
          this.sendPeers(ws, workspace);
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (workspace && peerUsername) {
        workspace.peers.delete(peerUsername);
        this.broadcastToWorkspace(workspace, {
          kind: 'peer_left',
          username: peerUsername,
          peers: Array.from(workspace.peers.keys()),
        });
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

    // Check capacity
    if (targetWorkspace.peers.size >= targetWorkspace.maxPeers) {
      this.send(ws, { kind: 'auth_fail', reason: `Workspace full (${targetWorkspace.maxPeers} peers max)` });
      ws.close();
      return;
    }

    // Check username collision
    let username = msg.username;
    if (targetWorkspace.peers.has(username)) {
      // Append random suffix
      username = `${username}_${randomBytes(2).toString('hex')}`;
    }

    const peer: ConnectedPeer = {
      ws,
      username,
      connectedAt: Date.now(),
      lastMessageAt: 0,
      messageCount: 0,
    };

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
    this.broadcastToWorkspace(targetWorkspace, {
      kind: 'peer_joined',
      username,
      peers: Array.from(targetWorkspace.peers.keys()),
    }, username);

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

  private handleBoardUpdate(workspace: Workspace, from: string, task: TaskItem): void {
    const existing = workspace.db.getTask(task.id);
    if (existing) {
      const updated = workspace.db.updateTask(task.id, {
        status: task.status,
        assignee: task.assignee,
        title: task.title,
        description: task.description,
      });
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
    for (const [username, peer] of workspace.peers) {
      if (username !== excludeUsername && peer.ws.readyState === WebSocket.OPEN) {
        this.send(peer.ws, msg);
      }
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

  stop(): void {
    for (const workspace of this.workspaces.values()) {
      workspace.db.close();
      for (const peer of workspace.peers.values()) {
        peer.ws.close();
      }
    }
    this.wss?.close();
  }
}
