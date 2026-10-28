import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { tokenStore } from '../lib/tokenStore';
import type { ChangeOwnPasswordInput } from '@tracker/shared';

interface ChangePasswordResult {
  accessToken: string;
  refreshToken: string;
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (payload: ChangeOwnPasswordInput) => {
      return apiClient.post<ChangePasswordResult>('/api/auth/change-password', payload);
    },
    onSuccess: (data) => {
      tokenStore.setTokens(data.accessToken, data.refreshToken);
    },
  });
}
