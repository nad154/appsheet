import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { DriveFileEntry, DriveFolderInfo } from '@tracker/shared';

export function useDriveResolve(projectId: string | null) {
  const query = useQuery({
    queryKey: ['drive', 'resolve', projectId],
    queryFn: () => apiClient.get<DriveFolderInfo>(`/api/drive/resolve/${projectId}`),
    enabled: Boolean(projectId),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

export function useDriveBrowse(folderId: string | null) {
  const query = useQuery({
    queryKey: ['drive', 'browse', folderId ?? 'root'],
    queryFn: () =>
      apiClient.get<DriveFileEntry[]>(
        folderId ? `/api/drive/browse?folderId=${encodeURIComponent(folderId)}` : '/api/drive/browse',
      ),
    enabled: true,
    placeholderData: (prev) => prev,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useRefreshDriveBrowse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderId: string | null) => {
      await qc.invalidateQueries({ queryKey: ['drive', 'browse', folderId ?? 'root'] });
    },
  });
}
