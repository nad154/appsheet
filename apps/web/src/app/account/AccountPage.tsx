import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changeOwnPasswordSchema, type ChangeOwnPasswordInput } from '@tracker/shared';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/Toast';
import { useChangePassword } from '../../hooks/useChangePassword';

export function AccountPage() {
  const { showToast } = useToast();
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ChangeOwnPasswordInput>({
    resolver: zodResolver(changeOwnPasswordSchema),
  });

  const onSubmit = (values: ChangeOwnPasswordInput) => {
    changePassword.mutate(values, {
      onSuccess: () => {
        showToast('Password changed.', 'success');
        reset();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to change password';
        showToast(message, 'error');
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Account"
        eyebrow="Profile"
        description="Manage your account security."
      />
      <section className="rounded-xl border border-border bg-surface shadow-card">
        <header className="border-b border-border bg-brand-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Change password</h2>
          <p className="text-xs text-ink-muted">Update your password for this account.</p>
        </header>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink" htmlFor="current_password">
              Current password
            </label>
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.current_password ? true : undefined}
              aria-describedby={errors.current_password ? 'current_password-error' : undefined}
              {...register('current_password')}
            />
            {errors.current_password && (
              <span id="current_password-error" role="alert" className="text-xs text-danger">
                {errors.current_password.message}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink" htmlFor="new_password">
              New password
            </label>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.new_password ? true : undefined}
              aria-describedby={errors.new_password ? 'new_password-error' : undefined}
              {...register('new_password')}
            />
            {errors.new_password && (
              <span id="new_password-error" role="alert" className="text-xs text-danger">
                {errors.new_password.message}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink" htmlFor="confirm_password">
              Confirm new password
            </label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.confirm_password ? true : undefined}
              aria-describedby={errors.confirm_password ? 'confirm_password-error' : undefined}
              {...register('confirm_password')}
            />
            {errors.confirm_password && (
              <span id="confirm_password-error" role="alert" className="text-xs text-danger">
                {errors.confirm_password.message}
              </span>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Changing...' : 'Change password'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
