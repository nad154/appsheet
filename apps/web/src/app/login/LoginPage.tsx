import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { AlertIcon } from '../../components/ui/icons';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

const inputCls =
  'h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/grid';

  const onSubmit = async (values: LoginForm) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            PT
          </span>
          <h1 className="text-xl font-semibold text-ink">Project Tracker</h1>
          <p className="text-sm text-ink-muted">Sign in to continue</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" className={inputCls} {...register('email')} />
          {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink" htmlFor="password">
            Password
          </label>
          <input id="password" type="password" autoComplete="current-password" className={inputCls} {...register('password')} />
          {errors.password && <p className="text-xs text-danger">{errors.password.message}</p>}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={isSubmitting} className="h-10 w-full">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
