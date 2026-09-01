import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { PendingEdit, PendingEditDiff, PendingEditStatus } from '@tracker/shared';

export function usePendingEdits(status?: PendingEditStatus) {
  const query = useQuery({
    queryKey: ['pending-edits', { status }],
    queryFn: async () => {
      const qs = status ? `?status=${status}` : '';
      return apiClient.get<PendingEdit[]>(`/api/pending-edits${qs}`);
    },
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useMyPendingEdits() {
  const query = useQuery({
    queryKey: ['pending-edits', 'mine'],
    queryFn: () => apiClient.get<PendingEdit[]>('/api/pending-edits/mine'),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function usePendingEditDiff(editId: string | null) {
  const query = useQuery({
    queryKey: ['pending-edits', 'diff', editId],
    queryFn: async () => apiClient.get<PendingEditDiff>(`/api/pending-edits/${editId}/diff`),
    enabled: !!editId,
  });
  return {
    data: query.data,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

export function useApprovePendingEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (editId: string) => apiClient.post<{ ok: boolean }>(`/api/pending-edits/${editId}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-edits'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useRejectPendingEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ editId, note }: { editId: string; note?: string }) =>
      apiClient.post<{ ok: boolean }>(`/api/pending-edits/${editId}/reject`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-edits'] });
    },
  });
}
