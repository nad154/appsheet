import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { MarketSegment, MarketSegmentUsage, PublicUser, Role, UserUsage } from '@tracker/shared';

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

// Impact count for the permanent-delete confirmation (projects still carrying
// the segment label). `null` disables the query while the modal is closed.
export function useMarketSegmentUsage(id: string | null) {
  return useQuery({
    queryKey: ['settings', 'market-segments', id, 'usage'],
    queryFn: () => apiClient.get<MarketSegmentUsage>(`/api/settings/market-segments/${id}/usage`),
    enabled: !!id,
  });
}

// SUPER_ADMIN-only permanent delete. The server rejects an active segment (409),
// so the button is only offered for deactivated rows.
export function useDeleteMarketSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean }>(`/api/settings/market-segments/${id}`),
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

// Impact counts for the permanent-delete confirmation (projects assigned / PIC,
// issue assignments). `null` disables the query while the modal is closed.
export function useUserUsage(id: string | null) {
  return useQuery({
    queryKey: ['settings', 'users', id, 'usage'],
    queryFn: () => apiClient.get<UserUsage>(`/api/settings/users/${id}/usage`),
    enabled: !!id,
  });
}

// SUPER_ADMIN-only permanent delete. The server rejects an active user (409),
// so the button is only offered for deactivated rows. Invalidates the grid too:
// projects that referenced the user now render the "(deleted user)" marker.
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean }>(`/api/settings/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (input: { id: string; admin_password: string; new_password: string; confirm_password: string }) => {
      const { id, ...body } = input;
      return apiClient.post<{ ok: boolean }>(`/api/settings/users/${id}/password`, body);
    },
  });
}

export function useAgingThresholds() {
  const query = useQuery({
    queryKey: ['settings', 'aging-thresholds'],
    queryFn: () => apiClient.get<{ low_max_days: number; medium_max_days: number }>('/api/settings/aging-thresholds'),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useUpdateAgingThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { low_max_days: number; medium_max_days: number }) =>
      apiClient.patch<{ ok: boolean }>('/api/settings/aging-thresholds', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'aging-thresholds'] });
      qc.invalidateQueries({ queryKey: ['projects'] }); // Priority column will change
    },
  });
}