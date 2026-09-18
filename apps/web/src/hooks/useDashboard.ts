import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  DashboardView,
  DashboardViewCreate,
  DashboardViewUpdate,
  ChartData,
  DashboardColumn,
  DashboardMetric,
  DashboardStageFilter,
  DrillDownResult,
} from '@tracker/shared';

export interface ChartFilterParams {
  metric?: DashboardMetric;
  stage?: DashboardStageFilter;
  year?: number | null;
}

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

export function useUpdateDashboardView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; body: DashboardViewUpdate }) =>
      apiClient.patch<{ ok: boolean }>(`/api/dashboard/views/${params.id}`, params.body),
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

function chartDataQueryString(column: DashboardColumn, filters: ChartFilterParams): string {
  const qs = new URLSearchParams();
  qs.set('column', column);
  qs.set('metric', filters.metric ?? 'count');
  qs.set('stage', filters.stage ?? 'all');
  if (filters.year != null) qs.set('year', String(filters.year));
  return qs.toString();
}

export function useChartData(column: DashboardColumn, filters: ChartFilterParams = {}) {
  const metric = filters.metric ?? 'count';
  const stage = filters.stage ?? 'all';
  const year = filters.year ?? null;
  const query = useQuery({
    queryKey: ['dashboard', 'chart-data', column, metric, stage, year],
    queryFn: () => apiClient.get<ChartData>(`/api/dashboard/chart-data?${chartDataQueryString(column, filters)}`),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

// Projects behind one chart slice/segment. Disabled until a slice is actually
// clicked (value != null). Only the stage/year filters matter here — the metric
// only changes bar heights, not which projects fall in a group.
export function useDrillDown(
  columnKey: DashboardColumn,
  value: string | null,
  filters: { stage?: DashboardStageFilter; year?: number | null } = {},
) {
  const stage = filters.stage ?? 'all';
  const year = filters.year ?? null;
  const query = useQuery({
    queryKey: ['dashboard', 'drill-down', columnKey, value, stage, year],
    queryFn: () =>
      apiClient.get<DrillDownResult>(
        `/api/dashboard/drill-down?column=${encodeURIComponent(
          columnKey,
        )}&value=${encodeURIComponent(value ?? '')}&stage=${encodeURIComponent(stage)}${
          year != null ? `&year=${year}` : ''
        }`,
      ),
    enabled: value != null,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}