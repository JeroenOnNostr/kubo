import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { KidComments } from './KidPostDetailPage';

/**
 * KUBO-163 — NIP-22 comments on the kid post-detail page are filtered through
 * the per-author TEPP check: a comment whose author the kid's construct denies
 * (blacklisted / globally restricted / unadmitted) must not render, even though
 * comments are fetched from arbitrary authors with no relay-side scope.
 */

const ALLOWED = 'a'.repeat(64);
const DENIED = 'b'.repeat(64);

const comment = (id: string, pubkey: string): NostrEvent => ({
  id: id.padEnd(64, '0'),
  pubkey,
  kind: 1111,
  content: `comment ${id}`,
  tags: [],
  created_at: 1000,
  sig: '0'.repeat(128),
});

const root = (): NostrEvent => ({
  id: 'r'.repeat(64),
  pubkey: ALLOWED,
  kind: 1,
  content: 'root',
  tags: [],
  created_at: 900,
  sig: '0'.repeat(128),
});

vi.mock('@/hooks/useComments', () => ({
  useComments: () => ({
    data: {
      topLevelComments: [comment('c1', ALLOWED), comment('c2', DENIED)],
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: { metadata: undefined } }),
}));

// Drive per-author visibility: DENIED is hidden, everyone else visible.
vi.mock('@/hooks/useKuboTeppEvaluateAuthor', () => ({
  useKuboTeppEvaluateAuthor: (pubkey: string | undefined) => ({
    visible: pubkey !== DENIED,
  }),
}));

describe('KidComments TEPP author filter (KUBO-163)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides comments whose author the construct denies when enforced', () => {
    render(<KidComments event={root()} kidPubkey={ALLOWED} />);
    expect(screen.getByText('comment c1')).toBeInTheDocument();
    expect(screen.queryByText('comment c2')).not.toBeInTheDocument();
  });

  it('shows every comment when TEPP is not enforced (kidPubkey undefined)', () => {
    render(<KidComments event={root()} kidPubkey={undefined} />);
    expect(screen.getByText('comment c1')).toBeInTheDocument();
    expect(screen.getByText('comment c2')).toBeInTheDocument();
  });
});
