import { Activity, Users, Zap, Clock } from 'lucide-react';
import type { HealthStatus } from '../types';

interface StatsCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
}

function StatsCard({ icon, label, value, subValue, color = 'text-blue-400' }: StatsCardProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center gap-3">
        <div className={`p-2 bg-gray-700 rounded-lg ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-400">{label}</p>
          <p className="text-xl font-semibold text-gray-100">{value}</p>
          {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
        </div>
      </div>
    </div>
  );
}

interface StatsPanelProps {
  health: HealthStatus | undefined;
  isLoading: boolean;
}

export function StatsPanel({ health, isLoading }: StatsPanelProps) {
  const serverTime = health?.timestamp
    ? new Date(health.timestamp).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-pulse">
            <div className="h-16 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <StatsCard
        icon={<Activity className="w-5 h-5" />}
        label="Proxy Status"
        value={health?.status === 'ok' ? 'Online' : 'Offline'}
        color={health?.status === 'ok' ? 'text-green-400' : 'text-red-400'}
      />
      <StatsCard
        icon={<Users className="w-5 h-5" />}
        label="Active Accounts"
        value={`${health?.activeAccounts || 0} / ${health?.totalAccounts || 0}`}
        color="text-purple-400"
      />
      <StatsCard
        icon={<Zap className="w-5 h-5" />}
        label="Current Account"
        value={health?.currentAccount?.replace(/(.{2})(.*)(@.*)/, '$1***$3') || 'None'}
        color="text-yellow-400"
      />
      <StatsCard
        icon={<Clock className="w-5 h-5" />}
        label="Server Time"
        value={serverTime}
        color="text-blue-400"
      />
    </div>
  );
}
