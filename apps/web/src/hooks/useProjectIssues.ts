import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ProjectIssueHistory } from '@tracker/shared';

// SUPER_ADMIN-only endpoints: full issue history + add-issue. STAFF never
// fetches these; they only ever see the latest issue in the grid row.

export function useProjectIssues(projectId: string | null) {
  const query = useQuery({
    queryKey: ['project-issues', projectId],
    queryFn: () => apiClient.get<ProjectIssueHistory>(`/api/projects/${projectId}/issues`),
    enabled: !!projectId,
    staleTime: 0,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useAddIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { issue_text: string; issue_date?: string; assignee_id?: string | null }) =>
      apiClient.post<{ id: string }>(`/api/projects/${projectId}/issues`, input),
    onSuccess: () => {
      // Adding an issue syncs projects.issues + the history — refresh the grid
      // and re-open history so the new entry shows immediately.
      qc.invalidateQueries({ queryKey: ['project-issues', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}