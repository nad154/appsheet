import { z } from 'zod';

export const agingThresholdsSchema = z.object({
  low_max_days: z.number().int().positive(),
  medium_max_days: z.number().int().positive(),
}).refine((v) => v.medium_max_days > v.low_max_days, {
  message: 'medium_max_days must be greater than low_max_days',
});

export type AgingThresholdsInput = z.infer<typeof agingThresholdsSchema>;