// Wait for Tauri to be ready
async function waitForTauri(timeout = 5000) {
  const getInvoker = () => window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || window.__TAURI__?.tauri?.invoke;
  if (getInvoker()) return window.__TAURI__;

  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      if (getInvoker()) {
        cleanup();
        resolve(window.__TAURI__);
      } else if (Date.now() - start >= timeout) {
        cleanup();
        reject(new Error('Tauri API not available'));
      }
    };

    const events = ['tauri://ready', 'DOMContentLoaded', 'load'];
    events.forEach((evt) => window.addEventListener(evt, check, { once: false }));
    const interval = setInterval(check, 50);

    function cleanup() {
      clearInterval(interval);
      events.forEach((evt) => window.removeEventListener(evt, check));
    }

    check();
  });
}

const invoke = async (...args) => {
  const tauri = await waitForTauri().catch(() => null);
  const invoker = tauri?.core?.invoke || tauri?.invoke || tauri?.tauri?.invoke;
  if (!invoker) {
    throw new Error('Tauri API not available');
  }
  return invoker(...args);
};

const $ = (id) => document.getElementById(id);

// Element references
const indicatorEl = $('status-indicator');
const statusTextEl = $('status-text');
const statusMetaEl = $('status-meta');
const portEl = $('port-value');
const lanEl = $('lan-value');
const accountEl = $('account-value');
const updatedEl = $('updated-value');
const errorEl = $('error-box');
const errorIndicatorEl = $('error-indicator');
const configWarningEl = $('config-warning');
const configPathEl = $('config-path');
const startBtn = $('start-btn');
const stopBtn = $('stop-btn');
const dashboardBtn = $('dashboard-btn');
const logsBtn = $('logs-btn');
const repairBtn = $('repair-btn');

function setIndicator(state) {
  if (!indicatorEl) return;
  indicatorEl.classList.remove('indicator-running', 'indicator-idle', 'indicator-warning');
  indicatorEl.classList.add({
    running: 'indicator-running',
    warning: 'indicator-warning',
    idle: 'indicator-idle',
  }[state] || 'indicator-idle');
}

function formatDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString();
}

function formatAccount(email) {
  if (!email || email === '—') return '—';
  // Truncate long emails for display
  if (email.length > 20) {
    const parts = email.split('@');
    if (parts.length === 2) {
      const name = parts[0].slice(0, 8);
      const domain = parts[1].slice(0, 8);
      return `${name}...@${domain}...`;
    }
    return email.slice(0, 18) + '...';
  }
  return email;
}

function setBusy(isBusy) {
  if (startBtn) startBtn.disabled = isBusy;
  if (stopBtn) stopBtn.disabled = isBusy;
  if (repairBtn) repairBtn.disabled = isBusy;
  if (dashboardBtn) dashboardBtn.disabled = isBusy;
}

function setError(message) {
  if (errorEl) {
    const hasError = message && message !== 'None' && message !== 'Ready';
    errorEl.textContent = message || 'Ready';
    errorEl.classList.toggle('has-error', hasError);
    if (errorIndicatorEl) {
      errorIndicatorEl.classList.toggle('hidden', !hasError);
    }
  }
}

function updateUI(status) {
  // Handle null/undefined status
  if (!status) {
    setIndicator('idle');
    if (statusTextEl) statusTextEl.textContent = 'Loading...';
    if (statusMetaEl) statusMetaEl.textContent = 'Initializing...';
    return;
  }

  const running = !!status.running;
  const hasError = Boolean(status.last_error);
  setIndicator(running ? 'running' : hasError ? 'warning' : 'idle');

  if (statusTextEl) {
    statusTextEl.textContent = running ? 'Proxy Running' : 'Proxy Stopped';
  }

  if (statusMetaEl) {
    const port = status.snapshot?.port ?? '—';
    const account = status.snapshot?.currentAccount || 'No Account';
    statusMetaEl.textContent = status.snapshot
      ? `Port ${port} · ${account}`
      : 'Not started';
  }

  if (portEl) portEl.textContent = status.snapshot?.port ?? '8080';
  if (lanEl) {
    const lanEnabled = status.snapshot?.lanEnabled;
    lanEl.textContent = lanEnabled ? 'Enabled' : 'Disabled';
    lanEl.style.color = lanEnabled ? '#f59e0b' : '';
  }
  if (accountEl) accountEl.textContent = formatAccount(status.snapshot?.currentAccount);
  if (updatedEl) updatedEl.textContent = formatDate(status.last_update);

  // Update error display
  setError(status.last_error || (running ? 'Proxy running normally' : 'Ready'));

  // Update button states
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;

  // Config warning
  const configStatus = status.config;
  if (configWarningEl) {
    if (configStatus && !configStatus.healthy) {
      configWarningEl.classList.remove('hidden');
      if (configPathEl) configPathEl.textContent = configStatus.settings_path || '~/.claude/settings.json';
    } else {
      configWarningEl.classList.add('hidden');
    }
  }
}

async function refreshStatus() {
  try {
    const status = await invoke('fetch_status');
    updateUI(status);
  } catch (error) {
    console.error('Failed to fetch status:', error);
    setError(error?.message || String(error));
    updateUI(null);
  }
}

async function guarded(action, successMessage) {
  setBusy(true);
  try {
    await action();
    if (successMessage) {
      setError(successMessage);
    }
    await refreshStatus();
  } catch (error) {
    console.error(error);
    setError(error?.message || String(error));
  } finally {
    setBusy(false);
  }
}

// Event listeners with null checks
if (startBtn) {
  startBtn.addEventListener('click', () =>
    guarded(() => invoke('start_proxy'), 'Proxy started successfully')
  );
}

if (stopBtn) {
  stopBtn.addEventListener('click', () =>
    guarded(() => invoke('stop_proxy'), 'Proxy stopped')
  );
}

if (dashboardBtn) {
  dashboardBtn.addEventListener('click', async () => {
    try {
      await invoke('open_dashboard');
    } catch (error) {
      setError(error?.message || String(error));
    }
  });
}

if (logsBtn) {
  logsBtn.addEventListener('click', async () => {
    try {
      await invoke('view_logs');
    } catch (error) {
      setError(error?.message || String(error));
    }
  });
}

if (repairBtn) {
  repairBtn.addEventListener('click', () =>
    guarded(() => invoke('repair_claude_config'), 'Claude CLI configured successfully')
  );
}

// Initial load with retry
function initApp() {
  // Set initial loading state
  if (statusTextEl) statusTextEl.textContent = 'Connecting...';
  if (statusMetaEl) statusMetaEl.textContent = 'Waiting for Tauri...';

  // Wait a bit for Tauri to be ready
  waitForTauri()
    .then(() => {
      refreshStatus();
      setInterval(refreshStatus, 5000);
    })
    .catch((error) => {
      setError(error?.message || String(error));
    });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
