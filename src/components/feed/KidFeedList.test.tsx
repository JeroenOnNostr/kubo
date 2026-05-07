import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { MutableRefObject, ReactNode } from 'react';

import { KidFeedList } from './KidFeedList';

/**
 * KUBO-066 — verify the scroll-cap clipping applied by `capAtIndex`:
 *   idx < capAtIndex    → visible, full height
 *   idx === capAtIndex  → 12px peek (next locked post)
 *   idx > capAtIndex    → display:none (hidden entirely)
 *
 * Mocks `useKidFeed` and `useMuteList` so we can drive the rendered list
 * from the test. `NoteCard` is stubbed out to a minimal tag since we only
 * care about the wrapper styles applied by `KidFeedList`.
 */
vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => ({ muteItems: [] }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: undefined, metadata: undefined }),
}));

vi.mock('@/hooks/useKuboFamily', async (orig) => ({
  ...(await orig<object>()),
  getKidSettings: () => ({ viewOnly: false, age: 6, dailyLimitMin: 45 }),
}));

vi.mock('@/components/NoteCard', () => ({
  NoteCard: ({ event }: { event: NostrEvent }) => (
    <div data-testid="note" style={{ height: 400 }}>
      {event.id.slice(0, 8)}
    </div>
  ),
}));

const makeEvent = (i: number): NostrEvent => ({
  id: `00000000000000000000000000000000000000000000000000000000000000${i.toString().padStart(2, '0')}`,
  pubkey: '00000000000000000000000000000000000000000000000000000000000000aa',
  created_at: 1000 + i,
  kind: 1,
  tags: [],
  content: `post ${i}`,
  sig: '00',
});

const mockFeed = vi.fn();

vi.mock('@/hooks/useKidFeed', () => ({
  useKidFeed: () => mockFeed(),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('KidFeedList capAtIndex (KUBO-066)', () => {
  beforeEach(() => {
    mockFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: [0, 1, 2, 3, 4].map((i) => ({ event: makeEvent(i) })),
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: false,
      isLoading: false,
    });
  });

  it('renders all posts at full height when capAtIndex is undefined', () => {
    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" />
      </Wrapper>,
    );
    const items = document.querySelectorAll('[data-kid-feed-item]');
    expect(items).toHaveLength(5);
    items.forEach((el) => {
      // No inline capStyle applied.
      expect((el as HTMLElement).style.display).not.toBe('none');
      expect((el as HTMLElement).style.maxHeight).toBe('');
    });
    // Infinite-scroll sentinel present.
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('clips posts past capAtIndex and peeks the cap post at 12px', () => {
    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" capAtIndex={1} />
      </Wrapper>,
    );
    const getItem = (idx: number) =>
      document.querySelector<HTMLElement>(`[data-kid-feed-item="${idx}"]`);

    // idx 0 — full render.
    expect(getItem(0)!.style.display).not.toBe('none');
    expect(getItem(0)!.style.maxHeight).toBe('');

    // idx 1 — 12px peek.
    expect(getItem(1)!.style.maxHeight).toBe('12px');
    expect(getItem(1)!.style.overflow).toBe('hidden');

    // idx 2..4 — hidden.
    [2, 3, 4].forEach((idx) => {
      expect(getItem(idx)!.style.display).toBe('none');
    });
  });

  it('grows the cap monotonically when capAtIndex increases', () => {
    const { rerender } = render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" capAtIndex={1} />
      </Wrapper>,
    );
    const peekBefore = document.querySelector<HTMLElement>(
      '[data-kid-feed-item="1"]',
    )!;
    expect(peekBefore.style.maxHeight).toBe('12px');

    rerender(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" capAtIndex={2} />
      </Wrapper>,
    );
    const item1After = document.querySelector<HTMLElement>(
      '[data-kid-feed-item="1"]',
    )!;
    const item2After = document.querySelector<HTMLElement>(
      '[data-kid-feed-item="2"]',
    )!;
    expect(item1After.style.maxHeight).toBe(''); // full render
    expect(item1After.style.display).not.toBe('none');
    expect(item2After.style.maxHeight).toBe('12px'); // new peek
  });

  it('hides the infinite-scroll sentinel when capped', () => {
    const { container } = render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" capAtIndex={1} />
      </Wrapper>,
    );
    // The sentinel is a div with className "h-1" — not rendered in capped mode.
    const sentinel = container.querySelector('.h-1');
    expect(sentinel).toBeNull();
  });

  it('populates postRefs with each rendered post wrapper', () => {
    let capturedRefs: MutableRefObject<(HTMLElement | null)[]> | null = null;
    function Harness() {
      const refs = useRef<(HTMLElement | null)[]>([]);
      capturedRefs = refs;
      return <KidFeedList variant="kid" emptyMessage="empty" postRefs={refs} />;
    }
    render(
      <Wrapper>
        <Harness />
      </Wrapper>,
    );
    expect(capturedRefs).not.toBeNull();
    const refArr = capturedRefs!.current;
    // Five posts rendered → five refs populated, each matching the
    // corresponding data-kid-feed-item element.
    expect(refArr.filter(Boolean)).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const el = document.querySelector<HTMLElement>(
        `[data-kid-feed-item="${i}"]`,
      );
      expect(refArr[i]).toBe(el);
    }
  });

  it('renders empty state when no feed items', () => {
    mockFeed.mockReturnValue({
      data: { pages: [{ items: [] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: false,
      isLoading: false,
    });
    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="no posts" capAtIndex={1} />
      </Wrapper>,
    );
    expect(screen.getByText('no posts')).toBeInTheDocument();
  });
});
