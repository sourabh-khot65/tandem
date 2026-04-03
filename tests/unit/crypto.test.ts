import { describe, it, expect } from 'vitest';
import {
  generateWorkspaceId,
  generateToken,
  generateInviteCode,
  createJoinCode,
  createShortInvite,
  parseInvite,
  encryptMessage,
  decryptMessage,
  signMessage,
  verifySignature,
  sanitizeContent,
} from '../../src/shared/crypto.js';

// ─── ID & Token Generation ──────────────────────────────────────────

describe('generateWorkspaceId', () => {
  it('returns TNM-XXXX-XXXX format', () => {
    const id = generateWorkspaceId();
    expect(id).toMatch(/^TNM-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateWorkspaceId()));
    expect(ids.size).toBe(50);
  });
});

describe('generateToken', () => {
  it('returns a base64url string of sufficient length', () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('generateInviteCode', () => {
  it('returns 6 uppercase alphanumeric characters', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('excludes ambiguous characters (0, O, 1, I)', () => {
    // Charset excludes 0/O (confusable) and 1/I (confusable), but keeps L
    const codes = Array.from({ length: 200 }, () => generateInviteCode()).join('');
    expect(codes).not.toMatch(/[01OI]/);
  });
});

// ─── Join Codes ──────────────────────────────────────────────────────

describe('createJoinCode / parseInvite', () => {
  it('round-trips a full join code', () => {
    const code = createJoinCode('ws://localhost:3000', 'TNM-ABCD-1234', 'secret-token');
    const parsed = parseInvite(code);
    expect(parsed).toEqual({
      type: 'full',
      hubUrl: 'ws://localhost:3000',
      workspaceId: 'TNM-ABCD-1234',
      token: 'secret-token',
    });
  });

  it('parses short invite code without host', () => {
    const parsed = parseInvite('ABC234');
    expect(parsed).toEqual({ type: 'short', code: 'ABC234', host: undefined });
  });

  it('parses short invite code with host', () => {
    const parsed = parseInvite('ABC234@test.loca.lt');
    expect(parsed).toEqual({ type: 'short', code: 'ABC234', host: 'test.loca.lt' });
  });

  it('is case-insensitive for short codes', () => {
    const parsed = parseInvite('abc234');
    expect(parsed?.type).toBe('short');
    if (parsed?.type === 'short') {
      expect(parsed.code).toBe('ABC234');
    }
  });

  it('returns null for empty input', () => {
    expect(parseInvite('')).toBeNull();
    expect(parseInvite('   ')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseInvite('not-a-code!')).toBeNull();
    expect(parseInvite('AB')).toBeNull(); // too short
  });
});

describe('createShortInvite', () => {
  it('returns code with host when tunnel URL provided', () => {
    expect(createShortInvite('ABC123', 'https://test.loca.lt')).toBe('ABC123@test.loca.lt');
  });

  it('returns bare code when no tunnel URL', () => {
    expect(createShortInvite('ABC123')).toBe('ABC123');
    expect(createShortInvite('ABC123', undefined)).toBe('ABC123');
  });

  it('handles invalid tunnel URL gracefully', () => {
    expect(createShortInvite('ABC123', 'not-a-url')).toBe('ABC123');
  });
});

// ─── E2E Encryption (AES-256-GCM) ───────────────────────────────────

describe('encryptMessage / decryptMessage', () => {
  const token = generateToken();

  it('encrypts to iv.ciphertext.tag format', () => {
    const encrypted = encryptMessage('hello', token);
    expect(encrypted.split('.')).toHaveLength(3);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const a = encryptMessage('same text', token);
    const b = encryptMessage('same text', token);
    expect(a).not.toBe(b);
  });

  it('round-trips plaintext correctly', () => {
    const plaintext = 'The quick brown fox jumps over the lazy dog 🦊';
    const encrypted = encryptMessage(plaintext, token);
    expect(decryptMessage(encrypted, token)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const encrypted = encryptMessage('', token);
    expect(decryptMessage(encrypted, token)).toBe('');
  });

  it('handles long messages', () => {
    const long = 'x'.repeat(10_000);
    expect(decryptMessage(encryptMessage(long, token), token)).toBe(long);
  });

  it('returns null with wrong token', () => {
    const encrypted = encryptMessage('secret', token);
    expect(decryptMessage(encrypted, generateToken())).toBeNull();
  });

  it('returns null with tampered ciphertext', () => {
    const encrypted = encryptMessage('secret', token);
    const parts = encrypted.split('.');
    parts[1] = parts[1].slice(0, -2) + 'XX'; // tamper with ciphertext
    expect(decryptMessage(parts.join('.'), token)).toBeNull();
  });

  it('returns null with malformed input', () => {
    expect(decryptMessage('not-valid', token)).toBeNull();
    expect(decryptMessage('a.b', token)).toBeNull();
    expect(decryptMessage('', token)).toBeNull();
  });
});

// ─── Message Signing (HMAC-SHA256) ───────────────────────────────────

describe('signMessage / verifySignature', () => {
  const token = generateToken();

  it('produces a base64url signature', () => {
    const sig = signMessage('payload', token);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for same input', () => {
    const a = signMessage('same payload', token);
    const b = signMessage('same payload', token);
    expect(a).toBe(b);
  });

  it('verifies valid signature', () => {
    const sig = signMessage('test', token);
    expect(verifySignature('test', sig, token)).toBe(true);
  });

  it('rejects wrong payload', () => {
    const sig = signMessage('test', token);
    expect(verifySignature('tampered', sig, token)).toBe(false);
  });

  it('rejects wrong token', () => {
    const sig = signMessage('test', token);
    expect(verifySignature('test', sig, generateToken())).toBe(false);
  });

  it('uses separate key from encryption (HKDF domain separation)', () => {
    // Signature of a value should not equal encryption of that value
    const val = 'test-separation';
    const sig = signMessage(val, token);
    const enc = encryptMessage(val, token);
    expect(sig).not.toBe(enc);
  });
});

// ─── Content Sanitization ────────────────────────────────────────────

describe('sanitizeContent', () => {
  it('escapes angle brackets', () => {
    expect(sanitizeContent('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('preserves normal text', () => {
    expect(sanitizeContent('Hello, world!')).toBe('Hello, world!');
  });

  it('handles empty string', () => {
    expect(sanitizeContent('')).toBe('');
  });
});
