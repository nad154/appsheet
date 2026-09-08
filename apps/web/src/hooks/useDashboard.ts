import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { DashboardView, DashboardViewCreate, ChartData, DashboardColumn } from '@tracker/shared';

export function useDashboardViews() {
  const query = useQuery({
    queryKey: ['dashboard', 'views'],
    queryFn: () => apiClient.get<DashboardView[]>('/api/dashboard/views'),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateDashboardView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DashboardViewCreate) => apiClient.post<{ id: string }>('/api/dashboard/views', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'views'] }),
  });
}

export function useDeleteDashboardView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean }>(`/api/dashboard/views/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'views'] }),
  });
}

export function useChartData(column: DashboardColumn) {
  const query = useQuery({
    queryKey: ['dashboard', 'chart-data', column],
    queryFn: () => apiClient.get<ChartData>(`/api/dashboard/chart-data?column=${column}`),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}