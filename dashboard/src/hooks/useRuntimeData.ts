import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminConfigResponse, FlowListResponse } from '../types'

async function fetchAdminConfig(): Promise<AdminConfigResponse> {
  const res = await fetch('/api/admin/config')
  if (!res.ok) throw new Error('Failed to fetch config')
  return res.json()
}

async function fetchFlows(): Promise<FlowListResponse> {
  const res = await fetch('/api/flows?limit=50')
  if (!res.ok) throw new Error('Failed to fetch flows')
  return res.json()
}

export function useAdminConfig() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin-config'],
    queryFn: fetchAdminConfig,
    staleTime: 10000,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown> & { adminKey: string }) => {
      const { adminKey, ...body } = payload
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to update config')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] })
    },
  })

  return { ...query, updateConfig: mutation.mutateAsync, updating: mutation.isPending }
}

export function useFlowList() {
  return useQuery({
    queryKey: ['flows'],
    queryFn: fetchFlows,
    refetchInterval: 15000,
  })
}

