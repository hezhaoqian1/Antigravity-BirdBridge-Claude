import { User, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import type { AccountLimit } from '../types';
import { QuotaBar } from './QuotaBar';

interface AccountCardProps {
  account: AccountLimit;
  isActive?: boolean;
}

export function AccountCard({ account, isActive = false }: AccountCardProps) {
  const { email, isLoggedIn, limits, error } = account;

  // Mask email for privacy
  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');

  const getStatusIcon = () => {
    if (error) return <AlertCircle className="w-5 h-5 text-red-400" />;
    if (!isLoggedIn) return <Clock className="w-5 h-5 text-yellow-400" />;
    return <CheckCircle className="w-5 h-5 text-green-400" />;
  };

  const getStatusText = () => {
    if (error) return 'Error';
    if (!isLoggedIn) return 'Not Logged In';
    if (limits && limits.remainingDailyTokens === 0) return 'Quota Exhausted';
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
              {limits?.tier || 'Unknown Tier'}
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
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Quota Bars */}
      {limits && (
        <div className="space-y-3">
          <QuotaBar
            used={limits.dailyTokenLimit - limits.remainingDailyTokens}
            total={limits.dailyTokenLimit}
            label="Daily Tokens"
          />
          <QuotaBar
            used={limits.minuteRequestLimit - limits.remainingMinuteRequests}
            total={limits.minuteRequestLimit}
            label="Requests/min"
          />
          {limits.resetTime && (
            <p className="text-xs text-gray-500 text-right">
              Resets: {new Date(limits.resetTime).toLocaleTimeString()}
            </p>
          )}
        </div>
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
    </div>
  );
}
