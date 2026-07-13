import WebSocket from 'ws';

/**
 * Resolve a short invite code by connecting to a hub and asking it.
 * Returns the decoded join info, or null if resolution fails.
 */
export function resolveShortCode(
  hubUrl: string,
  inviteCode: string,
): Promise<{ workspaceId: string; token: string } | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(hubUrl);
    } catch {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ kind: 'invite_resolve', inviteCode }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        clearTimeout(timeout);
        if (msg.kind === 'invite_result' && msg.token) {
          ws.close();
          resolve({ workspaceId: msg.workspaceId, token: msg.token });
        } else {
          ws.close();
          resolve(null);
        }
      } catch {
        ws.close();
        resolve(null);
      }
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Attempt a WebSocket auth handshake to validate join credentials.
 * Returns workspace info on success, null on failure. Always disconnects.
 */
export function validateConnection(
  hubUrl: string,
  token: string,
  username: string,
): Promise<{ workspaceName: string; peers: string[]; token: string } | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(hubUrl);
    } catch {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 5000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          kind: 'auth',
          token,
          username,
          sessionId: `cli-validate-${Date.now()}`,
        }),
      );
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'auth_ok') {
          clearTimeout(timeout);
          ws.close();
          resolve({
            workspaceName: msg.workspace?.name ?? 'unknown',
            peers: (msg.workspace?.peers ?? []).filter((p: string) => p !== username),
            token: msg.token ?? token,
          });
        } else if (msg.kind === 'auth_fail') {
          clearTimeout(timeout);
          ws.close();
          resolve(null);
        }
        // Ignore other messages (activity_entry, etc.) while waiting for auth response
      } catch {
        clearTimeout(timeout);
        ws.close();
        resolve(null);
      }
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}
