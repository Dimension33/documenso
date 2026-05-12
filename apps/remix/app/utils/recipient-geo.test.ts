import { describe, expect, it } from 'vitest';

import { enforceUsOnlySigning } from './recipient-geo';

const makeRequest = (country: string | null): Request => {
  const headers = new Headers();
  if (country !== null) {
    headers.set('cf-ipcountry', country);
  }
  return new Request('https://sign.d2dhq.com/sign/abc/complete', { headers });
};

describe('enforceUsOnlySigning', () => {
  it('allows US requests', () => {
    expect(() => enforceUsOnlySigning(makeRequest('US'))).not.toThrow();
  });

  it('allows requests when CF header is missing (local dev / non-CF deploy)', () => {
    expect(() => enforceUsOnlySigning(makeRequest(null))).not.toThrow();
  });

  it('handles lowercase CF country codes', () => {
    // CF normally returns uppercase but the loader should not assume.
    expect(() => enforceUsOnlySigning(makeRequest('us'))).not.toThrow();
  });

  it('blocks non-US country codes with 403', () => {
    let thrown: unknown = null;
    try {
      enforceUsOnlySigning(makeRequest('GB'));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  it('blocks CF anonymized / Tor sentinel codes', () => {
    expect(() => enforceUsOnlySigning(makeRequest('XX'))).toThrow();
    expect(() => enforceUsOnlySigning(makeRequest('T1'))).toThrow();
  });

  it('blocks whitespace-padded non-US codes', () => {
    expect(() => enforceUsOnlySigning(makeRequest(' CA '))).toThrow();
  });
});
