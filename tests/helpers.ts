/**
 * Shared test utilities for InTandem test suite.
 */

import WebSocket from 'ws';
import type { HubMessage } from '../src/shared/types.js';
import { TandemHub } from '../src/hub/server.js';

// ─── WebSocket helpers ───────────────────────────────────────────────

export function sendMsg(ws: WebSocket, msg: HubMessage): void {
  ws.send(JSON.stringify(msg));
}

/** Wait for a specific message matching a predicate. Rejects on timeout. */
export function waitFor(ws: WebSocket, predicate: (msg: HubMessage) => boolean, timeout = 3000): Promise<HubMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('waitFor timed out'));
    }, timeout);
    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as HubMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

/** Collect all messages for a duration, then return them. */
export async function collect(ws: WebSocket, ms = 200): Promise<HubMessage[]> {
  const msgs: HubMessage[] = [];
  const handler = (data: WebSocket.RawData) => {
    msgs.push(JSON.parse(data.toString()) as HubMessage);
  };
  ws.on('message', handler);
  await sleep(ms);
  ws.off('message', handler);
  return msgs;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Hub lifecycle helpers ───────────────────────────────────────────

export interface TestHub {
  hub: TandemHub;
  url: string;
  port: number;
  workspaceId: string;
  token: string;
}

/** Create and start a hub with one workspace. Caller must call hub.stop() in afterEach. */
export async function createTestHub(name = 'test-workspace', maxPeers = 5): Promise<TestHub> {
  const hub = new TandemHub();
  const { workspaceId, token } = hub.createWorkspace(name, maxPeers);
  const { port } = await hub.start({ port: 0, host: '127.0.0.1' });
  return { hub, url: `ws://127.0.0.1:${port}`, port, workspaceId, token };
}

// ─── Auth helpers ────────────────────────────────────────────────────

export interface AuthResult {
  ws: WebSocket;
  msg: Extract<HubMessage, { kind: 'auth_ok' }> | Extract<HubMessage, { kind: 'auth_fail' }>;
}

/** Connect and authenticate. Returns the WebSocket and auth response. */
export function connectAndAuth(
  url: string,
  token: string,
  username: string,
  sessionId = `sess-${Math.random().toString(36).slice(2, 8)}`,
): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('connectAndAuth timed out')), 5000);

    ws.on('open', () => {
      sendMsg(ws, { kind: 'auth', token, username, sessionId });
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as HubMessage;
      if (msg.kind === 'auth_ok' || msg.kind === 'auth_fail') {
        clearTimeout(timer);
        resolve({ ws, msg: msg as AuthResult['msg'] });
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
