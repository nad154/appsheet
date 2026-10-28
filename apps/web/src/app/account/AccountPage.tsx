import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changeOwnPasswordSchema, type ChangeOwnPasswordInput } from '@tracker/shared';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Account</h1>
        <p className="text-sm text-ink-muted">Manage your account security.</p>
      </div>
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Change password</h2>
          <p className="text-xs text-ink-muted">Update your password for this account.</p>
        </header>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink">Current password</label>
            <Input type="password" autoComplete="current-password" {...register('current_password')} />
            {errors.current_password && <span className="text-xs text-danger">{errors.current_password.message}</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink">New password</label>
            <Input type="password" autoComplete="new-password" {...register('new_password')} />
            {errors.new_password && <span className="text-xs text-danger">{errors.new_password.message}</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink">Confirm new password</label>
            <Input type="password" autoComplete="new-password" {...register('confirm_password')} />
            {errors.confirm_password && <span className="text-xs text-danger">{errors.confirm_password.message}</span>}
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
