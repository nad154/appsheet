import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window rate limiter keyed by IP. Sufficient for a
 * small LAN app (e.g., blast-hardening the login endpoint). Not distributed —
 * fine for a single-process deployment.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  const sweep = () => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now > b.resetAt) buckets.delete(key);
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';

    sweep();
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many attempts, try again later' });
      return;
    }

    next();
  };
}
