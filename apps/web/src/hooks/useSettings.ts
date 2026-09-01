import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { MarketSegment, PublicUser, Role } from '@tracker/shared';

export function useMarketSegments() {
  const query = useQuery({
    queryKey: ['settings', 'market-segments'],
    queryFn: () => apiClient.get<MarketSegment[]>('/api/settings/market-segments'),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateMarketSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; sort_order?: number }) =>
      apiClient.post<{ id: string }>('/api/settings/market-segments', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'market-segments'] });
    },
  });
}

export function useUpdateMarketSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label?: string; is_active?: boolean; sort_order?: number }) => {
      const { id, ...body } = input;
      return apiClient.patch<{ ok: boolean }>(`/api/settings/market-segments/${id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'market-segments'] });
    },
  });
}

export function useUsers() {
  const query = useQuery({
    queryKey: ['settings', 'users'],
    queryFn: () => apiClient.get<PublicUser[]>('/api/settings/users'),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string; role: Role }) =>
      apiClient.post<{ id: string }>('/api/settings/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      email?: string;
      role?: Role;
      is_active?: boolean;
    }) => {
      const { id, ...body } = input;
      return apiClient.patch<{ ok: boolean }>(`/api/settings/users/${id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
    },
  });
}