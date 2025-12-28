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
  return (
    <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Recent Requests</h2>
          <p className="text-sm text-gray-400">最后 50 个请求的快照，用于调试与回放</p>
        </div>
        {isLoading && <span className="text-xs text-gray-500 animate-pulse">同步中...</span>}
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
    </section>
  )
}
