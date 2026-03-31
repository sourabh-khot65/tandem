import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import type { HubMessage } from '../shared/types.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;
const CONNECT_TIMEOUT = 10_000;

export class HubConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private generation = 0;
  private _intentionalLeave = false;
  private lastPongAt = 0;

  /** Unique per-process ID so the hub can distinguish reconnects from different sessions with the same username */
  readonly sessionId = randomBytes(8).toString('hex');
  connected = false;

  /** Called when auto-reconnect permanently fails (all attempts exhausted) */
  onReconnectFailed: (() => void) | null = null;

  constructor(private onMessage: (msg: HubMessage) => void) {}

  /** Returns ms since last successful pong, or -1 if never received */
  get lastHealthPing(): number {
    if (this.lastPongAt === 0) return -1;
    return Date.now() - this.lastPongAt;
  }

  get intentionalLeave(): boolean {
    return this._intentionalLeave;
  }

  set intentionalLeave(value: boolean) {
    this._intentionalLeave = value;
  }

  send(msg: HubMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  scheduleReconnect(url: string, token: string, username: string): void {
    if (this._intentionalLeave || this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      process.stderr.write(
        `[intandem] Gave up reconnecting after ${MAX_RECONNECT_ATTEMPTS} attempts. Use intandem_rejoin to reconnect manually.\n`,
      );
      this.onReconnectFailed?.();
      return;
    }
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts), 30000);
    const gen = this.generation;
    this.reconnectAttempts++;
    process.stderr.write(
      `[intandem] Disconnected. Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\n`,
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (gen !== this.generation) return; // a newer connect/create/join superseded us
      const ok = await this.connect(url, token, username);
      // connect() bumps this.generation, so check gen+1 (our connect was the last one)
      if (!ok && gen + 1 === this.generation) {
        this.scheduleReconnect(url, token, username);
      }
    }, delay);
  }

  connect(url: string, token: string, username: string): Promise<boolean> {
    const gen = ++this.generation;

    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[intandem] Failed to create WebSocket: ${message}\n`);
        resolve(false);
        return;
      }
      let resolved = false;

      const adopt = (): boolean => {
        if (gen !== this.generation) return false;
        this.ws = ws;
        return true;
      };

      const done = (result: boolean): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      };

      ws.on('open', () => {
        if (gen !== this.generation) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ kind: 'auth', token, username, sessionId: this.sessionId }));
      });

      ws.on('pong', () => {
        this.lastPongAt = Date.now();
      });

      ws.on('message', (data) => {
        if (gen !== this.generation) {
          ws.close();
          return;
        }
        let msg: HubMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        // Detect auth_ok to resolve the connect promise
        if (msg.kind === 'auth_ok' && !resolved) {
          this.reconnectAttempts = 0;
          if (adopt()) {
            this.connected = true;
            this.onMessage(msg);
            done(true);
          } else {
            ws.close();
            done(false);
          }
          return;
        }

        this.onMessage(msg);
      });

      ws.on('close', () => {
        // Only touch connected/reconnect if this ws is the currently adopted one.
        // A failed connect (never adopted) must not clobber state from a live connection.
        const isActive = this.ws === ws;
        if (isActive) {
          this.connected = false;
        }
        if (!resolved) {
          done(false);
        } else if (isActive && !this._intentionalLeave) {
          this.scheduleReconnect(url, token, username);
        }
      });

      ws.on('error', (err) => {
        process.stderr.write(`[intandem] Connection error: ${err.message}\n`);
        done(false);
      });

      const timeout = setTimeout(() => {
        if (!resolved) {
          if (gen === this.generation) ws.close();
          done(false);
        }
      }, CONNECT_TIMEOUT);
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
