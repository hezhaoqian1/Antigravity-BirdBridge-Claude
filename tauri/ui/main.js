const { tauri } = window.__TAURI__ || {}

const $ = (id) => document.getElementById(id)

const indicatorEl = $('status-indicator')
const statusTextEl = $('status-text')
const statusMetaEl = $('status-meta')
const portEl = $('port-value')
const lanEl = $('lan-value')
const accountEl = $('account-value')
const updatedEl = $('updated-value')
const errorEl = $('error-box')
const configWarningEl = $('config-warning')
const configPathEl = $('config-path')
const startBtn = $('start-btn')
const stopBtn = $('stop-btn')
const dashboardBtn = $('dashboard-btn')
const logsBtn = $('logs-btn')
const repairBtn = $('repair-btn')

const invoke = (...args) => tauri?.invoke?.(...args)

function setIndicator(state) {
  indicatorEl.classList.remove('indicator-running', 'indicator-idle', 'indicator-warning')
  indicatorEl.classList.add({
    running: 'indicator-running',
    warning: 'indicator-warning',
    idle: 'indicator-idle',
  }[state] || 'indicator-idle')
}

function formatDate(value) {
  if (!value) return '—'
  const dt = new Date(value)
  return dt.toLocaleTimeString()
}

function setBusy(isBusy) {
  startBtn.disabled = isBusy
  stopBtn.disabled = isBusy
  repairBtn.disabled = isBusy
}

function updateUI(status) {
  const running = !!status.running
  const hasError = Boolean(status.last_error)
  setIndicator(running ? 'running' : hasError ? 'warning' : 'idle')
  statusTextEl.textContent = running ? 'Proxy running' : 'Proxy stopped'
  statusMetaEl.textContent = status.snapshot
    ? `Port ${status.snapshot.port ?? '—'} · ${
        status.snapshot.currentAccount || 'Account —'
      }`
    : 'Port — · Account —'

  portEl.textContent = status.snapshot?.port ?? '—'
  lanEl.textContent = status.snapshot?.lanEnabled ? 'Enabled' : 'Disabled'
  accountEl.textContent = status.snapshot?.currentAccount ?? '—'
  updatedEl.textContent = formatDate(status.last_update)
  errorEl.textContent = status.last_error || 'None'
  startBtn.disabled = running
  stopBtn.disabled = !running

  const configStatus = status.config
  if (configStatus && !configStatus.healthy) {
    configWarningEl.classList.remove('hidden')
    configPathEl.textContent = configStatus.settings_path || '~/.claude/settings.json'
  } else {
    configWarningEl.classList.add('hidden')
  }
}

async function refreshStatus() {
  try {
    const status = await invoke('fetch_status')
    updateUI(status)
  } catch (error) {
    console.error(error)
    errorEl.textContent = error?.message || String(error)
  }
}

async function guarded(action) {
  setBusy(true)
  try {
    await action()
    await refreshStatus()
  } catch (error) {
    console.error(error)
    errorEl.textContent = error?.message || String(error)
  } finally {
    setBusy(false)
  }
}

startBtn.addEventListener('click', () =>
  guarded(() => invoke('start_proxy'))
)
stopBtn.addEventListener('click', () =>
  guarded(() => invoke('stop_proxy'))
)
dashboardBtn.addEventListener('click', () =>
  invoke('open_dashboard').catch((error) => {
    errorEl.textContent = error?.message || String(error)
  })
)
logsBtn.addEventListener('click', () =>
  invoke('view_logs').catch((error) => {
    errorEl.textContent = error?.message || String(error)
  })
)
repairBtn.addEventListener('click', () =>
  guarded(() => invoke('repair_claude_config'))
)

refreshStatus()
setInterval(refreshStatus, 5000)
