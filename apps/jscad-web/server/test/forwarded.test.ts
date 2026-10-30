import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { pinForwardedFor } from '../src/http/forwarded.js';

function fakeRequest(headers: Record<string, string>, ip?: string): Request {
  return { headers, ip } as unknown as Request;
}

describe('pinForwardedFor', () => {
  it('replaces a forged X-Forwarded-For with the trust-proxy-resolved address', () => {
    const req = fakeRequest({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }, '8.8.8.8');

    pinForwardedFor(req);

    expect(req.headers['x-forwarded-for']).toBe('8.8.8.8');
  });

  it('removes a forged header when there is no resolved address', () => {
    const req = fakeRequest({ 'x-forwarded-for': '9.9.9.9' });

    pinForwardedFor(req);

    expect(req.headers['x-forwarded-for']).toBeUndefined();
  });
});
