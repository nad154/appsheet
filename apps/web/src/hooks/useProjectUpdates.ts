import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ProjectUpdateHistory } from '@tracker/shared';

export function useProjectUpdateHistory(projectId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['project-updates', projectId],
    queryFn: async () => {
      const data = await apiClient.get<ProjectUpdateHistory>(`/api/projects/${projectId}/updates`);
      // Fetching marks the entries read server-side — reflect that in the grid
      // immediately so the unread dot clears without a full page reload.
      qc.invalidateQueries({ queryKey: ['projects'] });
      return data;
    },
    enabled: !!projectId,
    staleTime: 0,
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error };
}