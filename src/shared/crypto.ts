import { randomBytes, createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

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

// --- Join codes ---

/** Full join code: base64url-encoded JSON with hub URL, workspace ID, and token */
export function createJoinCode(hubUrl: string, workspaceId: string, token: string): string {
  const payload = JSON.stringify({ h: hubUrl, w: workspaceId, t: token });
  return Buffer.from(payload).toString('base64url');
}

/**
 * Create a short invite code with optional routing hint.
 * Format: "ABCD12" (local only) or "ABCD12@host" (remote via tunnel)
 */
export function createShortInvite(code: string, tunnelUrl?: string): string {
  if (!tunnelUrl) return code;
  try {
    const url = new URL(tunnelUrl);
    return `${code}@${url.host}`;
  } catch {
    return code;
  }
}

/**
 * Parse an invite string. Returns one of:
 * - { type: 'full', hubUrl, workspaceId, token } for base64url join codes
 * - { type: 'short', code, host? } for short invite codes (with optional routing host)
 */
export function parseInvite(
  input: string,
):
  | { type: 'full'; hubUrl: string; workspaceId: string; token: string }
  | { type: 'short'; code: string; host?: string }
  | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try short code format first: "ABCD12" or "ABCD12@host"
  const shortMatch = trimmed.match(/^([A-Z2-9]{6})(?:@(.+))?$/i);
  if (shortMatch) {
    return { type: 'short', code: shortMatch[1].toUpperCase(), host: shortMatch[2] };
  }

  // Try full base64url join code
  try {
    const json = Buffer.from(trimmed, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (parsed.h && parsed.w && parsed.t) {
      return { type: 'full', hubUrl: parsed.h, workspaceId: parsed.w, token: parsed.t };
    }
  } catch {
    // not a valid base64url code
  }

  return null;
}

/** @deprecated Use parseInvite instead */
export function decodeJoinCode(code: string): { hubUrl: string; workspaceId: string; token: string } | null {
  const result = parseInvite(code);
  if (result?.type === 'full') return { hubUrl: result.hubUrl, workspaceId: result.workspaceId, token: result.token };
  return null;
}

// --- Key Derivation (HKDF per RFC 5869) ---

const HKDF_SALT = Buffer.from('intandem-e2e-v2', 'utf-8');

/** Derive a 256-bit encryption key from the workspace token (C2 fix: HKDF with domain separation) */
function deriveEncKey(token: string): Buffer {
  return Buffer.from(hkdfSync('sha256', token, HKDF_SALT, 'intandem-enc', 32));
}

/** Derive a 256-bit signing key from the workspace token (C2 fix: separate from encryption key) */
function deriveSignKey(token: string): Buffer {
  return Buffer.from(hkdfSync('sha256', token, HKDF_SALT, 'intandem-sign', 32));
}

// --- E2E Encryption (AES-256-GCM) ---

/** Encrypt a message using AES-256-GCM. Returns base64url string: iv.ciphertext.tag */
export function encryptMessage(plaintext: string, token: string): string {
  const key = deriveEncKey(token);
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
    const key = deriveEncKey(token);
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

// --- Message signing (HMAC-SHA256 with derived key) ---

/** Sign a message payload with HMAC-SHA256 using a derived signing key (C2 fix: separate from encryption) */
export function signMessage(payload: string, token: string): string {
  const key = deriveSignKey(token);
  return createHmac('sha256', key).update(payload).digest('base64url');
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
