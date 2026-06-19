import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { ParentNavigationInterceptor } from './ParentNavigationInterceptor';

/**
 * KUBO-198 — the parent feed-preview navigation interceptor.
 *
 * The parent feed preview (/parent/feed/preview) renders the upstream NoteCard,
 * whose links are context-agnostic and would resolve to MainLayout routes,
 * ejecting the parent out of the /parent/* shell. This wrapper rewrites those
 * clicks in the capture phase so the parent stays inside the parent shell:
 *   - profile anchors → /parent/profile/:npub
 *   - note anchors    → /parent/video/:id
 *   - bare card-body click → /parent/video/:eventId
 * Every other same-origin anchor is default-DENIED (so a stray inline link
 * can't eject the parent); external links pass through untouched.
 *
 * We assert via a mocked useNavigate: a recognized click calls nav with the
 * rewritten /parent path; a blocked click never calls nav AND has its default
 * prevented; a pass-through / external link is neither navigated nor prevented.
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
function clickAnchor(href: string) {
  navMock.mockClear();
  const { getByTestId } = render(
    <MemoryRouter>
      <ParentNavigationInterceptor pubkey={PUBKEY} eventId={EVENT_ID}>
        <a data-testid="link" href={href}>
          link
        </a>
      </ParentNavigationInterceptor>
    </MemoryRouter>,
  );

  const anchor = getByTestId('link');
  // dispatchEvent returns false when any handler called preventDefault — that's
  // our "blocked / rewritten" signal, evaluated after React's root-level
  // onClickCapture handler has run.
  const ev = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true });
  const prevented = !anchor.dispatchEvent(ev);

  return {
    navigated: navMock.mock.calls.length > 0,
    navTo: navMock.mock.calls[0]?.[0] as string | undefined,
    prevented,
  };
}

/**
 * Render the interceptor wrapping a non-anchor card body, click it, and report
 * the same signals. Mirrors a bare NoteCard card-body click.
 */
function clickBody() {
  navMock.mockClear();
  const { getByTestId } = render(
    <MemoryRouter>
      <ParentNavigationInterceptor pubkey={PUBKEY} eventId={EVENT_ID}>
        <div data-testid="card">card body</div>
      </ParentNavigationInterceptor>
    </MemoryRouter>,
  );

  const body = getByTestId('card');
  const ev = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true });
  const prevented = !body.dispatchEvent(ev);

  return {
    navigated: navMock.mock.calls.length > 0,
    navTo: navMock.mock.calls[0]?.[0] as string | undefined,
    prevented,
  };
}

describe('ParentNavigationInterceptor (KUBO-198)', () => {
  beforeEach(() => navMock.mockClear());

  // ── profile anchors → /parent/profile ──

  it('npub anchor → rewrites to /parent/profile/<npub>', () => {
    const r = clickAnchor(`/${NPUB}`);
    expect(r.navTo).toBe(`/parent/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  it('nip05 anchor → rewrites to /parent/profile from wrapper pubkey', () => {
    const r = clickAnchor('/alice@example.com');
    expect(r.navTo).toBe(`/parent/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  it('bare-domain nip05 anchor → rewrites to /parent/profile', () => {
    const r = clickAnchor('/example.com');
    expect(r.navTo).toBe(`/parent/profile/${NPUB}`);
    expect(r.prevented).toBe(true);
  });

  // ── note anchors → /parent/video ──

  it('note anchor → rewrites to /parent/video/<note>', () => {
    const note = nip19.noteEncode(EVENT_ID);
    const r = clickAnchor(`/${note}`);
    expect(r.navTo).toBe(`/parent/video/${note}`);
    expect(r.prevented).toBe(true);
  });

  it('nevent anchor → rewrites to /parent/video/<nevent>', () => {
    const nevent = nip19.neventEncode({ id: EVENT_ID });
    const r = clickAnchor(`/${nevent}`);
    expect(r.navTo).toBe(`/parent/video/${nevent}`);
    expect(r.prevented).toBe(true);
  });

  it('naddr anchor → rewrites to /parent/video/<naddr>', () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: 'post-1' });
    const r = clickAnchor(`/${naddr}`);
    expect(r.navTo).toBe(`/parent/video/${naddr}`);
    expect(r.prevented).toBe(true);
  });

  // ── bare card-body click → /parent/video/<eventId> ──

  it('bare card-body click → rewrites to /parent/video/<eventId>', () => {
    const r = clickBody();
    expect(r.navTo).toBe(`/parent/video/${EVENT_ID}`);
    expect(r.prevented).toBe(true);
  });

  // ── default-DENY: hashtag / relay / search / global / unknown ──

  it.each([
    ['hashtag', '/t/cats'],
    ['relay', '/r/wss%3A%2F%2Frelay.example.com'],
    ['search', '/search'],
    ['notifications', '/notifications'],
    ['global feed', '/'],
    ['unknown route', '/totally/made/up'],
  ])('%s anchor is BLOCKED (no nav, prevented)', (_label, href) => {
    const r = clickAnchor(href);
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(true);
  });

  // ── parent-shell paths pass through (already-in-shell links) ──

  it.each([
    `/parent/profile/${NPUB}`,
    `/parent/video/${EVENT_ID}`,
    '/parent/home',
    '/parent/trust',
  ])('parent-shell anchor %s passes through (no rewrite, not prevented)', (href) => {
    const r = clickAnchor(href);
    expect(r.navigated).toBe(false); // left to React Router's <Link>
    expect(r.prevented).toBe(false);
  });

  // ── external (cross-origin) links: untouched ──

  it('external cross-origin link is left untouched', () => {
    const r = clickAnchor('https://example.com/some/page');
    expect(r.navigated).toBe(false);
    expect(r.prevented).toBe(false);
  });
});
