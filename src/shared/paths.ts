import type { OwnershipClaim } from './types.js';

/**
 * Normalize a repo-relative path: forward slashes, collapsed separators, no
 * leading './'. Returns null for paths we refuse to reason about — empty,
 * absolute, or containing a '..' segment. Case is preserved: lock storage and
 * git paths are case-sensitive throughout the codebase.
 */
export function normalizePath(p: string): string | null {
  let s = p
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  if (s === '' || s === '.' || s === '/') return null;
  if (s.startsWith('/')) return null;
  if (s.split('/').includes('..')) return null;
  return s;
}

/**
 * Canonicalize an ownership pattern. 'src/cart/**', 'src/cart/*' and
 * 'src/cart/' all become the prefix 'src/cart/' — the trailing slash marks a
 * subtree claim and prevents 'src/cart/' from matching 'src/cartography/x.ts'.
 * Anything else is an exact path. Returns null for invalid or whole-repo
 * patterns.
 */
export function canonicalizePattern(p: string): string | null {
  const s = normalizePath(p);
  if (s === null || s === '*' || s === '**') return null;
  if (s.endsWith('/**')) return s.slice(0, -2);
  if (s.endsWith('/*')) return s.slice(0, -1);
  return s;
}

/** A canonical pattern is a subtree prefix iff it ends with '/'. */
export function isPrefixPattern(pattern: string): boolean {
  return pattern.endsWith('/');
}

/** Does a normalized path fall under a canonical pattern? */
export function matchesClaim(path: string, pattern: string): boolean {
  return isPrefixPattern(pattern) ? path.startsWith(pattern) : path === pattern;
}

/**
 * Do two canonical patterns overlap? Equal exacts, an exact inside a prefix
 * (either direction), or one prefix containing the other. Exact 'src/cart'
 * and prefix 'src/cart/' do NOT overlap — no path can match both.
 */
export function patternsConflict(a: string, b: string): boolean {
  const ap = isPrefixPattern(a);
  const bp = isPrefixPattern(b);
  if (!ap && !bp) return a === b;
  if (ap && bp) return a.startsWith(b) || b.startsWith(a);
  const exact = ap ? b : a;
  const prefix = ap ? a : b;
  return exact.startsWith(prefix);
}

/** All existing claims whose pattern overlaps the (canonical) new pattern. */
export function findConflicts(pattern: string, existing: OwnershipClaim[]): OwnershipClaim[] {
  return existing.filter((c) => patternsConflict(pattern, c.pattern));
}

/** First claim covering a normalized path, or null. Overlap rejection at claim
 *  time guarantees at most one claim can match, so first-match is total. */
export function findOwner(path: string, claims: OwnershipClaim[]): OwnershipClaim | null {
  for (const c of claims) {
    if (matchesClaim(path, c.pattern)) return c;
  }
  return null;
}
