import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@tracker/shared';

/**
 * Require the caller (already authenticated by requireAuth) to have one of the
 * given roles. Must be applied AFTER requireAuth. This is a server-side check —
 * the role comes from the verified token, never the client.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role' });
      return;
    }
    next();
  };
}
