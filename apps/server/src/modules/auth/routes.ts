import { Router } from 'express';
import { z } from 'zod';
import { NODE_ENV, authConfig } from './config.js';
import {
  authenticate,
  refresh,
  revokeSession,
  AuthError,
  findUserById,
} from './authService.js';
import { signAccessToken } from './tokens.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { ROLES } from '@tracker/shared';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const devSwitchRoleSchema = z.object({
  role: z.enum(ROLES),
});

export const authRouter = Router();

authRouter.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 10 }),
  async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await authenticate(parsed.data.email, parsed.data.password);
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error("Login error", err); 
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

authRouter.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  try {
    const result = await refresh(parsed.data.refreshToken);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/logout', async (req, res) => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  await revokeSession(parsed.data.refreshToken);
  res.json({ ok: true });
});

// Return the current authenticated user (used to restore a session on reload).
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
  });
});

// Dev-only convenience for testing both roles without a second login. Must be
// unreachable outside development.
authRouter.post('/dev-switch-role', requireAuth, async (req, res) => {
  if (NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const parsed = devSwitchRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const accessToken = signAccessToken({
    sub: user.id,
    role: parsed.data.role,
    email: user.email,
    name: user.name,
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: parsed.data.role,
      is_active: user.is_active,
      created_at: user.created_at,
    },
  });
});

export { authConfig };
