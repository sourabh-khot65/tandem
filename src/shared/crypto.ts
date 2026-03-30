import { randomBytes, createHmac } from 'node:crypto';

// Generate a workspace ID: TNM-XXXX-XXXX (easy to read/share)
export function generateWorkspaceId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars
  const part = (len: number) => {
    const bytes = randomBytes(len);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
  };
  return `TNM-${part(4)}-${part(4)}`;
}

// Generate a secure token for workspace auth
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// Create a join code that encodes hub URL + workspace ID + token
export function createJoinCode(hubUrl: string, workspaceId: string, token: string): string {
  const payload = JSON.stringify({ h: hubUrl, w: workspaceId, t: token });
  return Buffer.from(payload).toString('base64url');
}

// Decode a join code
export function decodeJoinCode(code: string): { hubUrl: string; workspaceId: string; token: string } | null {
  try {
    // Handle both raw join codes and TNM- style workspace IDs
    const json = Buffer.from(code, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (parsed.h && parsed.w && parsed.t) {
      return { hubUrl: parsed.h, workspaceId: parsed.w, token: parsed.t };
    }
    return null;
  } catch {
    return null;
  }
}

// Sign a message with the workspace token (HMAC-SHA256)
export function signMessage(payload: string, token: string): string {
  return createHmac('sha256', token).update(payload).digest('base64url');
}

// Verify a signed message
export function verifySignature(payload: string, signature: string, token: string): boolean {
  const expected = signMessage(payload, token);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// Sanitize content to prevent prompt injection via channel tags
export function sanitizeContent(content: string): string {
  // Escape any XML-like tags that could interfere with channel formatting
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
