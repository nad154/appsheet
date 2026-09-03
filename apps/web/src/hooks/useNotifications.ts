import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export interface Notification {
  id: string;
  recipient_id: string;
  type: 'NEW_APPROVAL' | 'AGING_ALERT';
  project_id: string | null;
  pending_edit_id: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export function useNotifications() {
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiClient.get<Notification[]>('/api/notifications'),
    refetchInterval: 30_000,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useUnreadCount() {
  const query = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiClient.get<{ count: number }>('/api/notifications/unread-count'),
    refetchInterval: 15_000,
  });
  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<{ ok: boolean }>(`/api/notifications/${id}/read`, {}),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    },
  });
}

export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ ok: boolean }>('/api/notifications/read-all', {}),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    },
  });
}
