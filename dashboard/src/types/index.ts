export interface AccountLimit {
  email: string;
  isLoggedIn: boolean;
  limits: {
    tier: string;
    dailyTokenLimit: number;
    remainingDailyTokens: number;
    minuteRequestLimit: number;
    remainingMinuteRequests: number;
    resetTime?: string;
  } | null;
  error?: string;
}

export interface HealthStatus {
  status: string;
  activeAccounts: number;
  totalAccounts: number;
  currentAccount: string | null;
}

export interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  backgroundTasksRedirected: number;
  uptime: number;
}
