import WebSocket from 'ws';
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

  connected = false;

  constructor(private onMessage: (msg: HubMessage) => void) {}

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
      if (gen !== this.generation) return;
      const ok = await this.connect(url, token, username);
      if (!ok && gen === this.generation) {
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

      ws.on('open', () => {
        if (gen !== this.generation) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ kind: 'auth', token, username }));
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
          resolved = true;
          this.reconnectAttempts = 0;
          if (adopt()) {
            this.connected = true;
            this.onMessage(msg);
            resolve(true);
          } else {
            ws.close();
            resolve(false);
          }
          return;
        }

        this.onMessage(msg);
      });

      ws.on('close', () => {
        if (gen === this.generation) {
          this.connected = false;
        }
        if (!resolved) {
          resolved = true;
          resolve(false);
        } else if (gen === this.generation && !this._intentionalLeave) {
          this.scheduleReconnect(url, token, username);
        }
      });

      ws.on('error', (err) => {
        process.stderr.write(`[intandem] Connection error: ${err.message}\n`);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (gen === this.generation) ws.close();
          resolve(false);
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
