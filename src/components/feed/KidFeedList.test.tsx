import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

// Tablet-mode column count — drive the grid/single-column layout from tests
// (the harness mocks matchMedia to always report false, so mock the hook directly).
const mockColumns = vi.fn(() => 1);

vi.mock('@/hooks/useKidFeedColumns', () => ({
  useKidFeedColumns: () => mockColumns(),
}));

// KUBO-159: KidFeedList now runs items through the render-side TEPP filter as
// defense-in-depth. Mock it so we can drive shouldShow from the test; the
// default is PASS (filter disabled — parent surfaces / non-enforced kids).
const mockTeppFilter = vi.fn();

vi.mock('@/hooks/useKuboTeppFeedFilter', () => ({
  useKuboTeppFeedFilter: () => mockTeppFilter(),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // MemoryRouter so KidNavigationInterceptor's useNavigate() has a Router.
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Default every test to a single column; grid tests override per-test.
beforeEach(() => {
  mockColumns.mockReturnValue(1);
});

describe('KidFeedList capAtIndex (KUBO-066)', () => {
  beforeEach(() => {
    mockTeppFilter.mockReturnValue({ enabled: false, shouldShow: () => true });
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

/**
 * KUBO-159 — render-side TEPP filter wired into KidFeedList as
 * defense-in-depth. When the filter is enabled (TEPP enforced for the active
 * kid), items whose author/references the construct denies must be hidden, even
 * though they passed the query-time author allowlist (e.g. event-list/relay-list
 * permissions the allowlist can't express).
 */
describe('KidFeedList TEPP render-side filter (KUBO-159)', () => {
  const eventWithPubkey = (i: number, pubkeyByte: string): NostrEvent => ({
    ...makeEvent(i),
    pubkey: `00000000000000000000000000000000000000000000000000000000000000${pubkeyByte}`,
  });

  beforeEach(() => {
    mockFeed.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              { event: eventWithPubkey(0, 'aa') }, // allowed
              { event: eventWithPubkey(1, 'bb') }, // denied author
              { event: eventWithPubkey(2, 'aa') }, // allowed
            ],
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

  it('hides items whose author the construct denies when the filter is enabled', () => {
    const deniedPubkey =
      '00000000000000000000000000000000000000000000000000000000000000bb';
    mockTeppFilter.mockReturnValue({
      enabled: true,
      shouldShow: (event: NostrEvent) => event.pubkey !== deniedPubkey,
    });

    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" />
      </Wrapper>,
    );

    // The denied-author item (index 1) is dropped; the two allowed items remain.
    const items = document.querySelectorAll('[data-kid-feed-item]');
    expect(items).toHaveLength(2);
    // No NoteCard rendered for the denied author's note.
    const notes = screen.getAllByTestId('note');
    expect(notes).toHaveLength(2);
  });

  it('passes everything through when the filter is disabled (parent / non-enforced)', () => {
    mockTeppFilter.mockReturnValue({ enabled: false, shouldShow: () => false });

    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" />
      </Wrapper>,
    );

    // shouldShow returns false but enabled:false means it is never consulted.
    expect(document.querySelectorAll('[data-kid-feed-item]')).toHaveLength(3);
  });
});

/**
 * Tablet mode: the feed lays tiles out in a responsive grid, and the "Next
 * post" cap advances a full ROW at a time (no half-height single-column peek).
 */
describe('KidFeedList tablet grid', () => {
  beforeEach(() => {
    mockTeppFilter.mockReturnValue({ enabled: false, shouldShow: () => true });
    mockFeed.mockReturnValue({
      data: {
        pages: [
          { items: [0, 1, 2, 3, 4].map((i) => ({ event: makeEvent(i) })) },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: false,
      isLoading: false,
    });
  });

  it('renders a grid when tablet mode reports multiple columns', () => {
    mockColumns.mockReturnValue(2);
    const { container } = render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" />
      </Wrapper>,
    );
    expect(container.querySelector('.grid.grid-cols-2')).toBeTruthy();
    expect(document.querySelectorAll('[data-kid-feed-item]')).toHaveLength(5);
  });

  it('stays a centered single column when columns is 1', () => {
    mockColumns.mockReturnValue(1);
    const { container } = render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" />
      </Wrapper>,
    );
    expect(container.querySelector('.grid')).toBeNull();
    // Single-column list is width-capped and centered.
    expect(container.querySelector('.flex.flex-col.max-w-md.mx-auto')).toBeTruthy();
  });

  it('reveals whole rows with no half-height peek when capped in grid mode', () => {
    mockColumns.mockReturnValue(2);
    render(
      <Wrapper>
        <KidFeedList variant="kid" emptyMessage="empty" capAtIndex={2} />
      </Wrapper>,
    );
    const getItem = (idx: number) =>
      document.querySelector<HTMLElement>(`[data-kid-feed-item="${idx}"]`);
    // First row (idx 0,1) fully visible, no peek.
    [0, 1].forEach((idx) => {
      expect(getItem(idx)!.style.display).not.toBe('none');
      expect(getItem(idx)!.style.maxHeight).toBe('');
    });
    // idx 2 onward hidden entirely — no 12px peek in grid mode.
    [2, 3, 4].forEach((idx) => {
      expect(getItem(idx)!.style.display).toBe('none');
      expect(getItem(idx)!.style.maxHeight).toBe('');
    });
  });
});
