import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { KidNavigationInterceptor } from './KidNavigationInterceptor';

/**
 * KUBO-158 — the interceptor's default-DENY anchor matrix.
 *
 * Layer 1 of the kid-shell escape fix. Same-origin anchors inside a kid
 * NoteCard are intercepted in the capture phase; only kid-shell destinations
 * (npub/note rewritten to /kid/profile|post, or anchors already pointing at
 * /kid) navigate. Hashtag (/t/), relay (/r/), /search, and unknown paths are
 * BLOCKED (preventDefault, no navigation). External cross-origin links are
 * left untouched.
 *
 * We assert via a mocked useNavigate: a recognized in-shell click calls nav
 * with the rewritten /kid path; a blocked click never calls nav AND has its
 * default prevented; an external link is neither navigated nor prevented.
 */

const navMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navMock,
}));

// A real pubkey so npubEncode / the nip05 fallback produce a valid npub.
const PUBKEY =
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const NPUB = nip19.npubEncode(PUBKEY);
const EVENT_ID =
  '00000000000000000000000000000000000000000000000000000000000000aa';

/**
 * Render the interceptor wrapping a single anchor with `href`, click it, and
 * report whether navigation happened (and to where) and whether the click's
 * default was prevented (the signal of a block / rewrite).
 */
function clickAnchor(href: string, viewOnly = false) {
  navMock.mockClear();
  const { getByTestId } = render(
    <MemoryRouter>
      <KidNavigationInterceptor
        pubkey={PUBKEY}
        eventId={EVENT_ID}
        viewOnly={viewOnly}
      >
        <a data-testid="link" href={href}>
          link
        </a>
      </KidNavigationInterceptor>
    </MemoryRouter>,
  );

  const anchor = getByTestId('link');
  // dispatchEvent returns false when any handler called preventDefault — that's
  // our "blocked / rewritten" signal, evaluated after React's root-level
  // onClickCapture handler has run. (The interceptor uses React synthetic
  // capture, so reading defaultPrevented from a bubble-phase native listener
  // would race ahead of it; the dispatch return value does not.)
  const ev = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true });
  const prevented = !anchor.dispatchEvent(ev);

  return {
    navigated: navMock.mock.calls.length > 0,
    navTo: navMock.mock.calls[0]?.[0] as string | undefined,
    prevented,
  };
}

describe('KidNavigationInterceptor default-DENY matrix (KUBO-158)', () => {
  beforeEach(() => navMock.mockClear());

  // ── npub / note / nip05: keep current behaviour (rewrite into kid shell) ──

  it('npub anchor → rewrites to /kid/profile/<npub> (normal)', () => {
    const r = clickAnchor(`/${NPUB}`);
    expect(r.navTo).toBe(`/kid/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  it('note anchor → rewrites to /kid/post/<id> (normal)', () => {
    const note = nip19.noteEncode(EVENT_ID);
    const r = clickAnchor(`/${note}`);
    expect(r.navTo).toBe(`/kid/post/${note}`);
    expect(r.prevented).toBe(true);
  });

  it('nevent anchor → rewrites to /kid/post/<id> (normal)', () => {
    const nevent = nip19.neventEncode({ id: EVENT_ID });
    const r = clickAnchor(`/${nevent}`);
    expect(r.navTo).toBe(`/kid/post/${nevent}`);
    expect(r.prevented).toBe(true);
  });

  it('nip05 anchor → rewrites to /kid/profile from wrapper pubkey (normal)', () => {
    const r = clickAnchor('/alice@example.com');
    expect(r.navTo).toBe(`/kid/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  it('bare-domain nip05 anchor → rewrites to /kid/profile (normal)', () => {
    const r = clickAnchor('/example.com');
    expect(r.navTo).toBe(`/kid/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  // ── view-only: npub / note / nip05 blocked outright (no navigation) ──

  it('npub anchor blocked in view-only (no nav, prevented)', () => {
    const r = clickAnchor(`/${NPUB}`, true);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  it('note anchor blocked in view-only (no nav, prevented)', () => {
    const r = clickAnchor(`/${nip19.noteEncode(EVENT_ID)}`, true);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  it('nip05 anchor blocked in view-only (no nav, prevented)', () => {
    const r = clickAnchor('/alice@example.com', true);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  // ── default-DENY: hashtag / relay / search / notifications / unknown ──

  it.each([
    ['hashtag', '/t/cats'],
    ['relay', '/r/wss%3A%2F%2Frelay.example.com'],
    ['search', '/search'],
    ['notifications', '/notifications'],
    ['global feed', '/'],
    ['unknown route', '/totally/made/up'],
  ])('%s anchor is BLOCKED for the kid (no nav, prevented)', (_label, href) => {
    const r = clickAnchor(href);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  it.each([
    ['hashtag', '/t/cats'],
    ['relay', '/r/wss%3A%2F%2Frelay.example.com'],
    ['search', '/search'],
    ['unknown route', '/totally/made/up'],
  ])('%s anchor is BLOCKED in view-only too (no nav, prevented)', (_label, href) => {
    const r = clickAnchor(href, true);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  // ── kid-shell paths pass through (already-in-shell links) ──

  it.each([
    '/kid',
    '/kid/favorites',
    '/kid/blobbi',
    `/kid/profile/${NPUB}`,
    `/kid/post/${EVENT_ID}`,
  ])('kid-shell anchor %s passes through (no rewrite, not prevented)', (href) => {
    const r = clickAnchor(href);
    expect(r.navigated).toBe(false); // left to React Router's <Link>
    expect(r.prevented).toBe(false);
  });

  // ── external (cross-origin) links keep current behaviour: untouched ──

  it('external cross-origin link is left untouched (normal)', () => {
    const r = clickAnchor('https://example.com/some/page');
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(false);
  });

  it('external cross-origin link is left untouched (view-only)', () => {
    const r = clickAnchor('https://example.com/some/page', true);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(false);
  });
});
