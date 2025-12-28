import { RefreshCw, Rocket } from 'lucide-react';
import { useAccountLimits, useHealth } from './hooks/useAccountLimits';
import { useAdminConfig, useFlowList } from './hooks/useRuntimeData';
import { AccountCard } from './components/AccountCard';
import { StatsPanel } from './components/StatsPanel';
import { ServicePanel } from './components/ServicePanel';
import { FlowTable } from './components/FlowTable';

function App() {
  const { data: accountLimits, isLoading: accountsLoading, refetch: refetchAccounts, dataUpdatedAt } = useAccountLimits();
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: adminConfig, isLoading: configLoading, updateConfig, updating } = useAdminConfig();
  const { data: flowData, isLoading: flowsLoading } = useFlowList();

  const accounts = accountLimits?.accounts ?? [];
  const preferredModel =
    accountLimits?.models?.find((model) => model.includes('claude-sonnet')) ??
    accountLimits?.models?.find((model) => model.includes('claude')) ??
    accountLimits?.models?.[0];

  const handleRefresh = () => {
    refetchAccounts();
  };

  const handleToggleLan = (enabled: boolean, adminKey: string) =>
    updateConfig({ adminKey, allowLanAccess: enabled });

  const handleBackup = async (adminKey: string) => {
    const res = await fetch('/api/admin/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ label: 'dashboard' }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error?.error || '备份失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg">
                <Rocket className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-100">Antigravity Dashboard</h1>
                <p className="text-sm text-gray-500">Claude API Proxy Monitor</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-500">
                Last updated: {new Date(dataUpdatedAt || Date.now()).toLocaleTimeString()}
              </span>
              <button
                onClick={handleRefresh}
                disabled={accountsLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${accountsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Panel */}
        <StatsPanel health={health} isLoading={healthLoading} />

        <ServicePanel
          config={adminConfig?.config}
          isLoading={configLoading}
          updating={updating}
          onToggleLan={handleToggleLan}
          onBackup={handleBackup}
        />

        {/* Accounts Section */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Account Status
            {accounts && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({accounts.length}
                {accountLimits?.totalAccounts !== undefined ? ` / ${accountLimits.totalAccounts}` : ''})
              </span>
            )}
          </h2>
        </div>

        {/* Loading State */}
        {accountsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-800 rounded-lg p-4 border border-gray-700 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-gray-700 rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-gray-700 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-2 bg-gray-700 rounded" />
                  <div className="h-2 bg-gray-700 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Account Cards Grid */}
        {!accountsLoading && accounts && accounts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((account) => (
              <AccountCard
                key={account.email}
                account={account}
                isActive={health?.currentAccount === account.email}
                primaryModelId={preferredModel}
              />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!accountsLoading && accounts.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-4">
              <Rocket className="w-12 h-12 mx-auto opacity-50" />
            </div>
            <h3 className="text-lg font-medium text-gray-300">No Accounts Found</h3>
            <p className="text-gray-500 mt-2">
              Add accounts using the CLI to get started.
            </p>
          </div>
        )}

        <div className="mt-8">
          <FlowTable flows={flowData?.flows} isLoading={flowsLoading} />
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-sm text-gray-500">
          <span>Antigravity-BirdBridge-Claude v1.0</span>
          <span>Proxy: http://localhost:8080</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
