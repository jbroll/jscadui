import type { Request } from 'express';

// better-auth's own IP read (getIp in better-auth/utils/get-request-ip) takes the
// FIRST X-Forwarded-For entry, not Express's trust-proxy-aware req.ip, so a
// forged leading entry would key its rate limiter. req.ip is the address Apache
// appended; pin the header to it before auth mounts. resolveAuthor itself reads
// only the session cookie, so the header is the auth IP surface.
export function pinForwardedFor(req: Request): void {
  // No resolved address means no trustworthy value; drop any forged header
  // rather than let better-auth read it.
  if (req.ip) req.headers['x-forwarded-for'] = req.ip;
  else delete req.headers['x-forwarded-for'];
}
