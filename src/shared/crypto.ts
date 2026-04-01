import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

// --- IDs and tokens ---

/** Generate a workspace ID: TNM-XXXX-XXXX (easy to read/share) */
export function generateWorkspaceId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const part = (len: number) => {
    const bytes = randomBytes(len);
    return Array.from(bytes)
      .map((b) => chars[b % chars.length])
      .join('');
  };
  return `TNM-${part(4)}-${part(4)}`;
}

/** Generate a secure 32-byte token for workspace auth + encryption key derivation */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Generate a short invite code: 6 alphanumeric chars, easy to share verbally */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous: 0/O, 1/I/L
  const bytes = randomBytes(6);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('');
}

// --- Join codes (backward compat: full base64url encoding) ---

export function createJoinCode(hubUrl: string, workspaceId: string, token: string): string {
  const payload = JSON.stringify({ h: hubUrl, w: workspaceId, t: token });
  return Buffer.from(payload).toString('base64url');
}

export function decodeJoinCode(code: string): { hubUrl: string; workspaceId: string; token: string } | null {
  try {
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

// --- E2E Encryption (AES-256-GCM) ---

/** Derive a 256-bit encryption key from the workspace token */
function deriveKey(token: string): Buffer {
  return createHmac('sha256', 'intandem-e2e-v1').update(token).digest();
}

/** Encrypt a message using AES-256-GCM. Returns base64url string: iv.ciphertext.tag */
export function encryptMessage(plaintext: string, token: string): string {
  const key = deriveKey(token);
  const iv = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

/** Decrypt a message encrypted with encryptMessage. Returns null if tampered/invalid. */
export function decryptMessage(ciphertext: string, token: string): string | null {
  try {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) return null;
    const key = deriveKey(token);
    const iv = Buffer.from(parts[0], 'base64url');
    const encrypted = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}

// --- Message signing (HMAC-SHA256) ---

/** Sign a message payload with HMAC-SHA256 using the workspace token */
export function signMessage(payload: string, token: string): string {
  return createHmac('sha256', token).update(payload).digest('base64url');
}

/** Verify a message signature (constant-time comparison) */
export function verifySignature(payload: string, signature: string, token: string): boolean {
  const expected = signMessage(payload, token);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// --- Content sanitization ---

/** Escape XML-like tags to prevent prompt injection via channel tags */
export function sanitizeContent(content: string): string {
  return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
