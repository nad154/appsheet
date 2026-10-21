import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImportMapping,
  ImportPreviewResponse,
  ImportCommitResponse,
  ProjectImportRequest,
} from '@tracker/shared';
import { apiClient } from '../lib/api-client';
import { useToast } from '../components/Toast';

const MAPPING_KEY = ['preferences', 'import-mapping'];

const EMPTY_MAPPING: ImportMapping = { mapping: {}, version: 1 };

/**
 * The user's saved CSV column mapping (plan §7) — per user, persisted in
 * user_preferences so it follows them across browsers. Loaded when the import
 * wizard opens so auto-suggest can prefer it.
 */
export function useImportMapping() {
  const qc = useQueryClient();
  const { showToast } = useToast();

  const query = useQuery({
    queryKey: MAPPING_KEY,
    queryFn: () => apiClient.get<ImportMapping>('/api/me/preferences/import-mapping'),
  });

  const save = useMutation({
    mutationFn: (value: ImportMapping) =>
      apiClient.put<ImportMapping>('/api/me/preferences/import-mapping', value),
    onSuccess: (data) => qc.setQueryData(MAPPING_KEY, data),
    onError: () => showToast("Couldn't save your column mapping.", 'error'),
  });

  const clear = useMutation({
    mutationFn: () => apiClient.del<{ ok: boolean }>('/api/me/preferences/import-mapping'),
    onSuccess: () => qc.setQueryData(MAPPING_KEY, EMPTY_MAPPING),
    onError: () => showToast("Couldn't reset your column mapping.", 'error'),
  });

  return {
    mapping: query.data?.mapping,
    isLoading: query.isLoading,
    save,
    clear,
  };
}

/** POST /api/import/projects/preview — validation only, never writes. */
export function usePreviewImport() {
  return useMutation<ImportPreviewResponse, Error, ProjectImportRequest>({
    mutationFn: (body) => apiClient.post<ImportPreviewResponse>('/api/import/projects/preview', body),
  });
}

/** POST /api/import/projects/commit — all-or-nothing, re-validates server-side. */
export function useCommitImport() {
  return useMutation<ImportCommitResponse, Error, ProjectImportRequest>({
    mutationFn: (body) => apiClient.post<ImportCommitResponse>('/api/import/projects/commit', body),
  });
}
