import { z } from 'zod';

export const newPasswordRule = z.string().min(8).max(128);

const newPassword = newPasswordRule;

export const changeOwnPasswordSchema = z
  .object({
    current_password: z.string().min(1).max(128),
    new_password: newPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.new_password !== v.current_password, {
    path: ['new_password'],
    message: 'New password must differ from the current one',
  });

export const adminResetPasswordSchema = z
  .object({
    admin_password: z.string().min(1).max(128),
    new_password: newPassword,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match',
  });

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
