import type { FlowEntry } from '../types'

interface Props {
  flows?: FlowEntry[]
  isLoading: boolean
}

function statusColor(status: FlowEntry['status']) {
  switch (status) {
    case 'completed':
      return 'text-emerald-400'
    case 'failed':
      return 'text-red-400'
    default:
      return 'text-yellow-400'
  }
}

export function FlowTable({ flows = [], isLoading }: Props) {
  const downloadJson = async () => {
    const res = await fetch('/api/flows?export=json&limit=200');
    if (!res.ok) {
      alert('下载失败，请稍后重试');
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data.flows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flows.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadNdjson = () => {
    window.open('/api/flows?export=file', '_blank', 'noopener');
  };

  return (
    <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Recent Requests</h2>
          <p className="text-sm text-gray-400">最后 50 个请求的快照，用于调试与回放</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <span className="text-xs text-gray-500 animate-pulse">同步中...</span>}
          <button
            onClick={downloadJson}
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200"
          >
            导出 JSON
          </button>
          <button
            onClick={downloadNdjson}
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200"
          >
            下载 NDJSON
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-700">
              <th className="py-2 pr-4">时间</th>
              <th className="py-2 pr-4">模型</th>
              <th className="py-2 pr-4">状态</th>
              <th className="py-2 pr-4 hidden md:table-cell">摘要</th>
              <th className="py-2 pr-4 text-right">耗时</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow) => (
              <tr key={flow.id} className="border-b border-gray-800 hover:bg-gray-900/50">
                <td className="py-2 pr-4">{new Date(flow.createdAt).toLocaleTimeString()}</td>
                <td className="py-2 pr-4">
                  <div className="flex flex-col">
                    <span className="text-white">{flow.model}</span>
                    <span className="text-xs text-gray-500">{flow.protocol}</span>
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <span className={`text-xs font-semibold ${statusColor(flow.status)}`}>{flow.status}</span>
                  {flow.account && <p className="text-xs text-gray-500">{flow.account}</p>}
                </td>
                <td className="py-2 pr-4 hidden md:table-cell">
                  <p className="truncate text-gray-400">
                    {flow.error ? `⚠️ ${flow.error}` : flow.response || '—'}
                  </p>
                </td>
                <td className="py-2 pr-4 text-right text-gray-400">
                  {flow.latencyMs ? `${Math.round(flow.latencyMs)}ms` : '—'}
                </td>
              </tr>
            ))}
            {!flows.length && !isLoading && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  暂无请求
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 mt-3">
        想导出更多历史？运行 <code className="px-1 bg-gray-900 rounded">antigravity-claude-proxy flows export</code> 获取最近 7 天日志。
      </p>
    </section>
  )
}
