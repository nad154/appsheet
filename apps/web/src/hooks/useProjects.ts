import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ProjectList } from '@tracker/shared';

export interface ProjectQueryParams {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export function useProjects(params: ProjectQueryParams = {}) {
  const { page = 1, page_size = 50, sort_by, sort_dir } = params;

  const query = useQuery({
    queryKey: ['projects', { page, page_size, sort_by, sort_dir }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(page_size));
      if (sort_by) qs.set('sort_by', sort_by);
      if (sort_dir) qs.set('sort_dir', sort_dir);
      return apiClient.get<ProjectList>(`/api/projects?${qs.toString()}`);
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

// Active users eligible for PIC assignment (id + name). Available to any
// authenticated role; the settings users list is SUPER_ADMIN-only.
export type AssignableUser = { id: string; name: string };

export function useAssignableUsers() {
  const query = useQuery({
    queryKey: ['projects', 'assignable-users'],
    queryFn: () => apiClient.get<AssignableUser[]>('/api/projects/users'),
    staleTime: 60_000,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
