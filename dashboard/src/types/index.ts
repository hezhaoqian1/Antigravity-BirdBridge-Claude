export interface AccountQuota {
  remaining: string | null;
  remainingFraction: number | null;
  resetTime: string | null;
}

export interface AccountLimit {
  email: string;
  status: string;
  error: string | null;
  limits: Record<string, AccountQuota | null>;
  meta?: AccountMeta | null;
}

export interface AccountLimitsResponse {
  timestamp: string;
  totalAccounts: number;
  models: string[];
  recommendedAccount?: string | null;
  accounts: AccountLimit[];
}

export interface AccountStats {
  successCount: number;
  errorCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface AccountMeta {
  isRateLimited: boolean;
  rateLimitResetTime: number | null;
  nextAvailableAt: number | null;
  isInvalid: boolean;
  invalidReason: string | null;
  lastUsed: number | null;
  stats: AccountStats;
  healthScore: number;
  recommended: boolean;
}

export interface HealthStatus {
  status: string;
  activeAccounts: number;
  totalAccounts: number;
  currentAccount: string | null;
  timestamp: string;
}

export interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  backgroundTasksRedirected: number;
  uptime: number;
}

export interface FlowUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface FlowEntry {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  status: 'in_progress' | 'completed' | 'failed';
  protocol: string;
  route: string;
  model: string;
  provider: string;
  stream: boolean;
  account: string | null;
  request: Record<string, unknown>;
  response: string | null;
  error: string | null;
  chunks: Array<{
    timestamp: string;
    type: string;
    size: number;
  }>;
  usage?: FlowUsage | null;
  latencyMs?: number | null;
}

export interface FlowListResponse {
  flows: FlowEntry[];
  source?: {
    memory: number;
    persisted: number;
  };
}

export interface AdminConfig {
  allowLanAccess: boolean;
  listenHost: string;
  telemetry: boolean;
  maxFlowEntries: number;
  adminKeyPreview: string | null;
  updatedAt: string;
}

export interface AdminConfigResponse {
  config: AdminConfig;
}
