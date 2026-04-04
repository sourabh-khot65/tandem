/**
 * Tunnel abstraction over cloudflared quick tunnels (trycloudflare.com).
 * Zero signup, zero config — backed by Cloudflare's network.
 *
 * Replaces localtunnel which was unreliable (single community server,
 * frequent drops, axios vulnerabilities).
 */

import { Tunnel as CloudflaredTunnel } from 'cloudflared';
import { EventEmitter } from 'node:events';

export interface TunnelHandle {
  url: string;
  close(): void;
  on(event: 'close', listener: () => void): this;
}

const TUNNEL_TIMEOUT = 30_000; // 30s to get a URL

/**
 * Open a Cloudflare quick tunnel for the given local port.
 * Returns a TunnelHandle with .url, .close(), and 'close' event.
 */
export function openTunnel(port: number): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const cf = new CloudflaredTunnel({ '--url': `http://localhost:${port}` });
    const emitter = new EventEmitter();
    let tunnelUrl = '';
    let stopped = false;

    const timeout = setTimeout(() => {
      if (!tunnelUrl) {
        cf.stop();
        reject(new Error('Tunnel timed out waiting for URL'));
      }
    }, TUNNEL_TIMEOUT);

    cf.on('url', (url: string) => {
      clearTimeout(timeout);
      tunnelUrl = url;

      const handle: TunnelHandle = {
        get url() {
          return tunnelUrl;
        },
        close() {
          if (!stopped) {
            stopped = true;
            cf.stop();
          }
        },
        on(event: 'close', listener: () => void) {
          emitter.on(event, listener);
          return this;
        },
      };

      resolve(handle);
    });

    cf.on('error', (err: Error) => {
      clearTimeout(timeout);
      if (!tunnelUrl) {
        reject(new Error(`Tunnel failed: ${err.message}`));
      } else {
        // Tunnel was running and errored — treat as close
        stopped = true;
        emitter.emit('close');
      }
    });

    // Detect process exit (cloudflared binary crashed or was killed)
    cf.on('exit', (code: number | null) => {
      if (!stopped && tunnelUrl) {
        stopped = true;
        emitter.emit('close');
      } else if (!tunnelUrl) {
        clearTimeout(timeout);
        reject(new Error(`Tunnel process exited with code ${code}`));
      }
    });
  });
}
