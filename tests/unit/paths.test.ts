import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  canonicalizePattern,
  isPrefixPattern,
  matchesClaim,
  patternsConflict,
  findConflicts,
  findOwner,
} from '../../src/shared/paths.js';
import type { OwnershipClaim } from '../../src/shared/types.js';

const claim = (pattern: string, owner = 'alice'): OwnershipClaim => ({ pattern, owner, createdAt: 0 });

// ─── normalizePath ──────────────────────────────────────────────────

describe('normalizePath', () => {
  it('passes clean relative paths through', () => {
    expect(normalizePath('src/cart/totals.ts')).toBe('src/cart/totals.ts');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\cart\\totals.ts')).toBe('src/cart/totals.ts');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('src//cart///totals.ts')).toBe('src/cart/totals.ts');
  });

  it('strips leading ./ segments', () => {
    expect(normalizePath('./src/cart/totals.ts')).toBe('src/cart/totals.ts');
    expect(normalizePath('././src/x.ts')).toBe('src/x.ts');
  });

  it('trims whitespace', () => {
    expect(normalizePath('  src/x.ts ')).toBe('src/x.ts');
  });

  it('rejects empty, dot, and absolute paths', () => {
    expect(normalizePath('')).toBeNull();
    expect(normalizePath('.')).toBeNull();
    expect(normalizePath('./')).toBeNull();
    expect(normalizePath('/etc/passwd')).toBeNull();
  });

  it('rejects paths with .. segments', () => {
    expect(normalizePath('../secrets.env')).toBeNull();
    expect(normalizePath('src/../../x')).toBeNull();
  });

  it('does not fold case', () => {
    expect(normalizePath('SRC/Cart/X.ts')).toBe('SRC/Cart/X.ts');
  });
});

// ─── canonicalizePattern ────────────────────────────────────────────

describe('canonicalizePattern', () => {
  it('turns /** and /* suffixes into a trailing-slash prefix', () => {
    expect(canonicalizePattern('src/cart/**')).toBe('src/cart/');
    expect(canonicalizePattern('src/cart/*')).toBe('src/cart/');
    expect(canonicalizePattern('src/cart/')).toBe('src/cart/');
  });

  it('leaves exact paths as exact', () => {
    expect(canonicalizePattern('src/shared/money.ts')).toBe('src/shared/money.ts');
    expect(isPrefixPattern('src/shared/money.ts')).toBe(false);
    expect(isPrefixPattern('src/cart/')).toBe(true);
  });

  it('rejects whole-repo and invalid patterns', () => {
    expect(canonicalizePattern('**')).toBeNull();
    expect(canonicalizePattern('*')).toBeNull();
    expect(canonicalizePattern('/abs/**')).toBeNull();
    expect(canonicalizePattern('../up/**')).toBeNull();
  });

  it('normalizes before canonicalizing', () => {
    expect(canonicalizePattern('./src\\cart/**')).toBe('src/cart/');
  });
});

// ─── matchesClaim ───────────────────────────────────────────────────

describe('matchesClaim', () => {
  it('matches paths under a prefix', () => {
    expect(matchesClaim('src/cart/totals.ts', 'src/cart/')).toBe(true);
    expect(matchesClaim('src/cart/deep/x.ts', 'src/cart/')).toBe(true);
  });

  it('does not let a prefix bleed into sibling directories', () => {
    expect(matchesClaim('src/cartography/map.ts', 'src/cart/')).toBe(false);
  });

  it('matches exact patterns only exactly', () => {
    expect(matchesClaim('src/x.ts', 'src/x.ts')).toBe(true);
    expect(matchesClaim('src/x.ts.bak', 'src/x.ts')).toBe(false);
  });
});

// ─── patternsConflict / findConflicts ───────────────────────────────

describe('patternsConflict', () => {
  it('flags equal exacts', () => {
    expect(patternsConflict('src/x.ts', 'src/x.ts')).toBe(true);
    expect(patternsConflict('src/x.ts', 'src/y.ts')).toBe(false);
  });

  it('flags an exact inside a prefix, both directions', () => {
    expect(patternsConflict('src/cart/totals.ts', 'src/cart/')).toBe(true);
    expect(patternsConflict('src/cart/', 'src/cart/totals.ts')).toBe(true);
  });

  it('flags nested prefixes, both directions', () => {
    expect(patternsConflict('src/cart/', 'src/')).toBe(true);
    expect(patternsConflict('src/', 'src/cart/')).toBe(true);
  });

  it('does not flag sibling prefixes or the cart/cartography boundary', () => {
    expect(patternsConflict('src/cart/', 'src/checkout/')).toBe(false);
    expect(patternsConflict('src/cart/', 'src/cartography/')).toBe(false);
  });

  it('exact "src/cart" and prefix "src/cart/" do not conflict', () => {
    expect(patternsConflict('src/cart', 'src/cart/')).toBe(false);
  });
});

describe('findConflicts / findOwner', () => {
  const claims = [claim('src/cart/', 'alice'), claim('src/shared/money.ts', 'bob')];

  it('finds the overlapping claims', () => {
    expect(findConflicts('src/cart/totals.ts', claims)).toEqual([claims[0]]);
    expect(findConflicts('src/', claims)).toEqual(claims);
    expect(findConflicts('docs/', claims)).toEqual([]);
  });

  it('finds the owner of a path', () => {
    expect(findOwner('src/cart/totals.ts', claims)?.owner).toBe('alice');
    expect(findOwner('src/shared/money.ts', claims)?.owner).toBe('bob');
    expect(findOwner('src/other.ts', claims)).toBeNull();
  });
});
