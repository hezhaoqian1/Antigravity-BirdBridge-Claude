import { useQuery } from '@tanstack/react-query'
import type { AccountLimit, HealthStatus } from '../types'

async function fetchAccountLimits(): Promise<AccountLimit[]> {
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
  return useQuery({
    queryKey: ['accountLimits'],
    queryFn: fetchAccountLimits,
  })
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000, // Refresh health more frequently
  })
}
