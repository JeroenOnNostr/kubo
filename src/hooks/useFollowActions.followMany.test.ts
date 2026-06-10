import { describe, expect, it } from 'vitest';

import { computeFollowListPTags } from './useFollowActions';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const p = (pk: string): string[] => ['p', pk];

describe('computeFollowListPTags — follow (batch into kind-3)', () => {
  it('adds all new targets to an empty list', () => {
    expect(computeFollowListPTags([], [A, B, C], 'follow')).toEqual([p(A), p(B), p(C)]);
  });

  it('appends only not-yet-followed targets, preserving existing order', () => {
    expect(computeFollowListPTags([p(A)], [A, B], 'follow')).toEqual([p(A), p(B)]);
  });

  it('dedupes repeated targets within the batch', () => {
    expect(computeFollowListPTags([], [B, B, B], 'follow')).toEqual([p(B)]);
  });

  it('returns null (skip publish) when every target is already followed', () => {
    expect(computeFollowListPTags([p(A), p(B)], [A, B], 'follow')).toBeNull();
  });

  it('returns null for an empty target list', () => {
    expect(computeFollowListPTags([p(A)], [], 'follow')).toBeNull();
  });
});

describe('computeFollowListPTags — unfollow (batch removal)', () => {
  it('removes every target pubkey', () => {
    expect(computeFollowListPTags([p(A), p(B), p(C)], [A, C], 'unfollow')).toEqual([p(B)]);
  });

  it('returns null (skip publish) when no target is present', () => {
    expect(computeFollowListPTags([p(A)], [B], 'unfollow')).toBeNull();
  });
});
