import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ProjectVendorCreate, ProjectVendorLine } from '@tracker/shared';

// Vendor-line ops update /api/projects/:projectId/vendors*. Invalidating
// ['projects'] on success refreshes the grid, whose list embeds every project's
// vendor lines (planning_customers_vendors §3.2).
export function useProjectVendors(projectId: string, enabled = false) {
  const query = useQuery({
    queryKey: ['project-vendors', projectId],
    enabled,
    queryFn: () => apiClient.get<ProjectVendorLine[]>(`/api/projects/${projectId}/vendors`),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useAddVendorLine(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectVendorCreate) =>
      apiClient.post<{ id: string }>(`/api/projects/${projectId}/vendors`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-vendors'] });
    },
  });
}

export function useUpdateVendorLine(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; changes: Partial<ProjectVendorCreate> }) => {
      const { id, changes } = input;
      return apiClient.patch<{ ok: boolean }>(`/api/projects/${projectId}/vendors/${id}`, changes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-vendors'] });
    },
  });
}

export function useRemoveVendorLine(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean }>(`/api/projects/${projectId}/vendors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-vendors'] });
    },
  });
}