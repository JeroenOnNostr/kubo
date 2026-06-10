import { describe, expect, it } from 'vitest';

import {
  ASSOC_TTL_SECONDS,
  ASSOC_RENEWAL_WINDOW_SECONDS,
  assocExpirationAt,
  shouldRenewAssociation,
} from './assocExpiry';

const DAY = 24 * 60 * 60;

describe('assoc expiry constants', () => {
  it('TTL is 365 days (KUBO-149 backstop)', () => {
    expect(ASSOC_TTL_SECONDS).toBe(365 * DAY);
  });

  it('renewal window is 60 days and well inside the TTL', () => {
    expect(ASSOC_RENEWAL_WINDOW_SECONDS).toBe(60 * DAY);
    expect(ASSOC_RENEWAL_WINDOW_SECONDS).toBeLessThan(ASSOC_TTL_SECONDS);
  });
});

describe('assocExpirationAt', () => {
  it('returns now + TTL', () => {
    const now = 1_000_000;
    expect(assocExpirationAt(now)).toBe(now + ASSOC_TTL_SECONDS);
  });
});

describe('shouldRenewAssociation', () => {
  const now = 2_000_000;

  it('renews when there is no current association (null)', () => {
    expect(shouldRenewAssociation(null, now)).toBe(true);
    expect(shouldRenewAssociation(undefined, now)).toBe(true);
    expect(shouldRenewAssociation(NaN, now)).toBe(true);
  });

  it('renews when already expired', () => {
    expect(shouldRenewAssociation(now - 1, now)).toBe(true);
  });

  it('renews when inside the renewal window of expiry', () => {
    const expiry = now + ASSOC_RENEWAL_WINDOW_SECONDS - 1;
    expect(shouldRenewAssociation(expiry, now)).toBe(true);
  });

  it('does NOT renew when comfortably before the window (e.g. fresh 1y assoc)', () => {
    const freshExpiry = assocExpirationAt(now);
    expect(shouldRenewAssociation(freshExpiry, now)).toBe(false);
  });

  it('boundary: exactly one window away does not renew', () => {
    const expiry = now + ASSOC_RENEWAL_WINDOW_SECONDS;
    expect(shouldRenewAssociation(expiry, now)).toBe(false);
  });
});
