import { useEffect, useState } from 'react'
import type { AdminConfig } from '../types'

interface Props {
  config?: AdminConfig
  isLoading: boolean
  updating: boolean
  onToggleLan: (enabled: boolean, adminKey: string) => Promise<void>
  onBackup: (adminKey: string) => Promise<void>
}

export function ServicePanel({ config, isLoading, updating, onToggleLan, onBackup }: Props) {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('ag-admin-key') || '')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem('ag-admin-key', adminKey)
  }, [adminKey])

  const handleToggle = (next: boolean) => {
    if (!adminKey) {
      setStatus('请输入 Admin Key')
      return
    }
    onToggleLan(next, adminKey).then(
      () => setStatus(next ? '已开启 LAN 访问（重启后生效）' : '已关闭 LAN 访问'),
      (err) => setStatus(err.message),
    )
  }

  const handleBackup = () => {
    if (!adminKey) {
      setStatus('请输入 Admin Key')
      return
    }
    onBackup(adminKey)
      .then(() => setStatus('已创建备份'))
      .catch((err) => setStatus(err.message))
  }

  return (
    <section className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Controls</h2>
          <p className="text-sm text-gray-400">管理监听范围、备份与管理员凭证</p>
        </div>
        <span className="text-xs text-gray-500">
          host: {config?.listenHost ?? '...'} · flows: {config?.maxFlowEntries ?? 0}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="text-sm text-gray-400">Admin Key</label>
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="粘贴 X-Admin-Key"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {config?.adminKeyPreview && (
            <p className="text-xs text-gray-500">当前 Key 预览：{config.adminKeyPreview}</p>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-sm text-gray-400">LAN 访问</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleToggle(true)}
              disabled={isLoading || updating}
              className={`flex-1 px-3 py-2 rounded-lg ${
                config?.allowLanAccess
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-900 text-gray-400 border border-gray-700'
              }`}
            >
              启用
            </button>
            <button
              onClick={() => handleToggle(false)}
              disabled={isLoading || updating}
              className={`flex-1 px-3 py-2 rounded-lg ${
                !config?.allowLanAccess
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-900 text-gray-400 border border-gray-700'
              }`}
            >
              仅本机
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {config?.allowLanAccess ? '当前公开在局域网，重启后生效。' : '仅监听 127.0.0.1。'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={handleBackup}
          disabled={updating}
          className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 hover:bg-gray-700 transition"
        >
          立即备份配置
        </button>
        <span className="text-sm text-gray-500">{status}</span>
      </div>
    </section>
  )
}
