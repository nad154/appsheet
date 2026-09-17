import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export type EntityOption = { id: string; name: string };

// Customer lookup list for dropdowns/type-ahead. q present → server-side
// ILIKE filter (LIMIT 20); absent → the full list (plain dropdown / prefetch).
export function useCustomers(q?: string) {
  const query = useQuery({
    queryKey: ['entities', 'customers', q ?? ''],
    queryFn: () =>
      apiClient.get<EntityOption[]>('/api/customers' + (q ? `?q=${encodeURIComponent(q)}` : '')),
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

// Any authenticated role may add a customer (plan §3.5) — STAFF adds new
// customers inline from the combobox while building a project.
export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => apiClient.post<{ id: string }>('/api/customers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'customers'] });
    },
  });
}

// SUPER_ADMIN-only mutations, used from the Settings page.
export function useRenameCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) => {
      const { id, name } = input;
      return apiClient.patch<{ ok: boolean }>(`/api/customers/${id}`, { name });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'customers'] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean; usageCount: number }>(`/api/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entities', 'customers'] });
    },
  });
}