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
}

export interface AccountLimitsResponse {
  timestamp: string;
  totalAccounts: number;
  models: string[];
  accounts: AccountLimit[];
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
