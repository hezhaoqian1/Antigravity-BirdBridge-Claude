import { useQuery } from '@tanstack/react-query'
import type { AccountLimitsResponse, HealthStatus } from '../types'

async function fetchAccountLimits(): Promise<AccountLimitsResponse> {
  const response = await fetch('/account-limits')
  if (!response.ok) {
    throw new Error('Failed to fetch account limits')
  }
  return response.json()
}

async function fetchHealth(): Promise<HealthStatus> {
  const response = await fetch('/health')
  if (!response.ok) {
    throw new Error('Failed to fetch health status')
  }
  return response.json()
}

export function useAccountLimits() {
  return useQuery<AccountLimitsResponse>({
    queryKey: ['accountLimits'],
    queryFn: fetchAccountLimits,
  })
}

export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000, // Refresh health more frequently
  })
}
