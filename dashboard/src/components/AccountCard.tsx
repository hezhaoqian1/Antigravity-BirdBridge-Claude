import { User, AlertCircle, CheckCircle, Clock, Star } from 'lucide-react';
import type { AccountLimit, AccountQuota } from '../types';
import { QuotaBar } from './QuotaBar';

interface AccountCardProps {
  account: AccountLimit;
  isActive?: boolean;
  primaryModelId?: string;
}

function formatCountdown(target?: number | null) {
  if (!target) return null
  const remaining = target - Date.now()
  if (remaining <= 0) return null
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function pickQuota(
  limits: AccountLimit['limits'],
  preferredModel?: string,
): { id: string; data: AccountQuota } | null {
  if (!limits) return null;
  const candidates = new Set<string>();
  if (preferredModel) candidates.add(preferredModel);
  Object.keys(limits).forEach((modelId) => candidates.add(modelId));

  for (const modelId of candidates) {
    const quota = limits[modelId];
    if (quota) {
      return { id: modelId, data: quota };
    }
  }

  return null;
}

function formatModelId(modelId?: string) {
  if (!modelId) return 'Unknown Model';
  return modelId
    .replace(/claude-?/i, 'Claude ')
    .replace(/-/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function AccountCard({ account, isActive = false, primaryModelId }: AccountCardProps) {
  const { email, status, limits, error, meta } = account;
  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
  const isLoggedIn = status === 'ok' && !meta?.isInvalid;
  const quotaInfo = pickQuota(limits, primaryModelId);
  const quotaPercent =
    quotaInfo?.data.remainingFraction !== null && quotaInfo?.data.remainingFraction !== undefined
      ? Math.round(Math.max(0, Math.min(1, quotaInfo.data.remainingFraction)) * 100)
      : null;
  const tierLabel = formatModelId(quotaInfo?.id);
  const resetTime = quotaInfo?.data.resetTime ? new Date(quotaInfo.data.resetTime).toLocaleTimeString() : null;
  const countdown = meta?.isRateLimited ? formatCountdown(meta.nextAvailableAt || meta.rateLimitResetTime) : null;
  const healthScore = meta?.healthScore;
  const stats = meta?.stats;
  const totalCalls = stats ? stats.successCount + stats.errorCount : 0;
  const successRate = stats && totalCalls > 0 ? Math.round((stats.successCount / totalCalls) * 100) : null;

  const getStatusIcon = () => {
    if (error || meta?.isInvalid) return <AlertCircle className="w-5 h-5 text-red-400" />;
    if (!isLoggedIn) return <Clock className="w-5 h-5 text-yellow-400" />;
    return <CheckCircle className="w-5 h-5 text-green-400" />;
  };

  const getStatusText = () => {
    if (meta?.isInvalid) return meta.invalidReason ? `Invalid (${meta.invalidReason})` : 'Invalid';
    if (error) return 'Error';
    if (meta?.isRateLimited) return countdown ? `Cooldown ${countdown}` : 'Rate-limited';
    if (!isLoggedIn) return 'Unavailable';
    if (quotaPercent === 0) return 'Quota Exhausted';
    return 'Active';
  };

  return (
    <div
      className={`bg-gray-800 rounded-lg p-4 border transition-all duration-200 ${
        isActive
          ? 'border-blue-500 shadow-lg shadow-blue-500/20'
          : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-700 rounded-full">
            <User className="w-5 h-5 text-gray-300" />
          </div>
          <div>
            <p className="font-medium text-gray-200">{maskedEmail}</p>
            <p className="text-xs text-gray-500">
              {tierLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span
            className={`text-sm ${
              error
                ? 'text-red-400'
                : !isLoggedIn
                ? 'text-yellow-400'
                : 'text-green-400'
            }`}
          >
            {getStatusText()}
          </span>
          {meta?.recommended && (
            <span className="flex items-center gap-1 text-xs text-amber-300">
              <Star className="w-3 h-3" /> 推荐
            </span>
          )}
          {typeof healthScore === 'number' && (
            <span className="text-xs px-2 py-0.5 bg-gray-700 rounded-full text-gray-200">
              Health {healthScore}
            </span>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Quota Bars */}
      {quotaInfo ? (
        <div className="space-y-3">
          {quotaPercent !== null ? (
            <QuotaBar
              used={100 - quotaPercent}
              total={100}
              label="Quota Remaining"
            />
          ) : (
            <p className="text-xs text-gray-500">Quota percentage unavailable</p>
          )}
          {resetTime && (
            <p className="text-xs text-gray-500 text-right">
              Resets: {resetTime}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No quota data returned for this account.
        </p>
      )}

      {/* Active Indicator */}
      {isActive && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            Currently Active
          </span>
        </div>
      )}

      {stats && (
        <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 flex justify-between">
          <span>Success: {stats.successCount} / {totalCalls}</span>
          {successRate !== null && <span>{successRate}% ok</span>}
        </div>
      )}
    </div>
  );
}
