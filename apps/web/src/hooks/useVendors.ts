import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { EntityOption } from './useCustomers';

// Mirrors useCustomers.ts — see plan §3.5 for the role split (POST any role,
// PATCH/DELETE SUPER_ADMIN only). Keep no is_active soft-delete toggle.
export function useVendors(q?: string) {
  const query = useQuery({
    queryKey: ['entities', 'vendors', q ?? ''],
    queryFn: () =>
      apiClient.get<EntityOption[]>('/api/vendors' + (q ? `?q=${encodeURIComponent(q)}` : '')),
    staleTime: 30_000,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => apiClient.post<{ id: string }>('/api/vendors', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'vendors'] });
    },
  });
}

export function useRenameVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) => {
      const { id, name } = input;
      return apiClient.patch<{ ok: boolean }>(`/api/vendors/${id}`, { name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'vendors'] });
    },
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean; usageCount: number }>(`/api/vendors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'vendors'] });
    },
  });
}