interface QuotaBarProps {
  used: number;
  total: number;
  label: string;
  showPercentage?: boolean;
}

export function QuotaBar({ used, total, label, showPercentage = true }: QuotaBarProps) {
  const remaining = total - used;
  const percentage = total > 0 ? Math.round((remaining / total) * 100) : 0;

  // Color based on remaining percentage
  const getBarColor = () => {
    if (percentage > 50) return 'bg-green-500';
    if (percentage > 20) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300">
          {formatNumber(remaining)} / {formatNumber(total)}
          {showPercentage && (
            <span className="ml-2 text-gray-500">({percentage}%)</span>
          )}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getBarColor()} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
