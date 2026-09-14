import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// Drive mutations for the folder link/create controls and the document upload
// cell. On success each invalidates the projects query so the grid/modal
// refetch and show the updated drive_folder_id / uploaded_doc_* values.

export function useLinkFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; folderInput: string }) =>
      apiClient.post<{ ok: boolean }>(`/api/drive/${input.projectId}/link`, {
        folderInput: input.folderInput,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['drive'] });
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; folderName?: string }) =>
      apiClient.post<{ folderId: string }>(`/api/drive/${input.projectId}/create-folder`, {
        folderName: input.folderName,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['drive'] });
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', input.file);
      return apiClient.post<{ id: string; name: string }>(
        `/api/drive/${input.projectId}/upload`,
        formData,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}