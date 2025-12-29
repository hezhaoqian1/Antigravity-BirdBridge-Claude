#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { startProxy, stopProxy, getStatus as getProxyStatus } from '../src/index.js';
import { ensureClaudeConfig, getClaudeSettingsPath } from '../src/services/claude-config.js';
import { readPersistedFlows } from '../src/flow-monitor.js';
import { createBackup, listBackups, restoreBackup } from '../src/services/backup-service.js';
import { AccountManager } from '../src/account-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PORT = 8080;

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const args = process.argv.slice(2);
const command = args[0];
let proxyRunning = false;
let shuttingDown = false;
let shutdownRegistered = false;

async function ensureProxyStarted(options = {}) {
  if (proxyRunning) return;
  await startProxy(options);
  proxyRunning = true;
  registerShutdownHandlers();
}

async function gracefulShutdown(exitCode = null) {
  if (!proxyRunning || shuttingDown) {
    if (exitCode !== null) process.exit(exitCode);
    return;
  }
  shuttingDown = true;
  try {
    await stopProxy();
  } catch (error) {
    console.warn('[CLI] Failed to stop proxy cleanly:', error.message);
  } finally {
    proxyRunning = false;
    shuttingDown = false;
    if (exitCode !== null) {
      process.exit(exitCode);
    }
  }
}

function registerShutdownHandlers() {
  if (shutdownRegistered) return;
  const handler = (signal) => {
    console.log(`\n[CLI] Caught ${signal}, shutting down proxy...`);
    gracefulShutdown(0);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  process.on('exit', () => {
    if (proxyRunning && !shuttingDown) {
      stopProxy().catch(() => {});
    }
  });
  shutdownRegistered = true;
}

function parseFlag(flagArgs, name, fallback = null) {
  const idx = flagArgs.indexOf(name);
  if (idx === -1) return fallback;
  return flagArgs[idx + 1] || fallback;
}

async function handleFlowsCommand(subArgs) {
  const action = subArgs[0];
  const flags = subArgs.slice(1);
  if (action !== 'export') {
    console.log('Usage: antigravity-claude-proxy flows export [--days N] [--limit N] [--output file.json]');
    return;
  }

  const days = Math.max(parseInt(parseFlag(flags, '--days', '1'), 10) || 1, 1);
  const limit = Math.min(parseInt(parseFlag(flags, '--limit', '200'), 10) || 200, 1000);
  const output = parseFlag(flags, '--output', null);

  const flows = await readPersistedFlows({ days, limit });
  const payload = JSON.stringify(flows, null, 2);

  if (output) {
    writeFileSync(output, payload);
    console.log(`Exported ${flows.length} flows to ${output}`);
  } else {
    console.log(payload);
  }
}

async function showAccountsStatus() {
  const manager = new AccountManager();
  await manager.initialize();
  const status = manager.getStatus();
  const runtime = getProxyStatus();

  console.log(`Accounts: ${status.available}/${status.total} available (${status.rateLimited} limited, ${status.invalid} invalid)`);
  if (status.recommendedAccount) {
    console.log(`Recommended: ${status.recommendedAccount}`);
  }
  if (runtime?.currentAccount) {
    console.log(`Current account: ${runtime.currentAccount}`);
  }
  if (runtime?.claudeConfig && runtime.claudeConfig.healthy === false) {
    console.log('');
    console.log('⚠ Claude CLI 配置已被修改，与代理不一致。');
    console.log(`文件: ${runtime.claudeConfig.settingsPath}`);
    console.log('运行 `antigravity-claude-proxy run` 或在桌面 App 中点击 “Reconfigure Claude CLI” 可自动修复。');
  }
  console.log('');

  const header = `${'Email'.padEnd(28)}${'Status'.padEnd(16)}${'Next'.padEnd(18)}${'Health'.padEnd(8)}Success`;
  console.log(header);
  console.log('-'.repeat(header.length));

  status.accounts.forEach((account) => {
    const label = account.recommended ? `⭐ ${account.email}` : account.email;
    const state = account.isInvalid
      ? 'invalid'
      : account.isRateLimited
      ? 'rate-limited'
      : 'ok';
    const next = account.nextAvailableAt
      ? new Date(account.nextAvailableAt).toLocaleTimeString()
      : 'now';
    const score = (account.healthScore ?? 0).toString().padStart(3, ' ');
    const stats = account.stats || { successCount: 0, errorCount: 0 };
    const total = (stats.successCount || 0) + (stats.errorCount || 0);
    const successPct = total > 0 ? Math.round((stats.successCount / total) * 100) : 100;
    console.log(
      `${label.padEnd(28)}${state.padEnd(16)}${next.padEnd(18)}${score.padEnd(8)}${stats.successCount}/${total} (${successPct}%)`
    );
  });
}

function showHelp() {
  console.log(`
antigravity-claude-proxy v${packageJson.version}

Proxy server for using Antigravity's Claude models with Claude Code CLI.

USAGE:
  antigravity-claude-proxy <command> [options]

COMMANDS:
  run                   Auto-configure Claude Code and start proxy (recommended)
  start                 Start the proxy server only (default port: 8080)
  flows export          Export stored flow logs (JSON) with optional filters
  dashboard             Open the local dashboard in your browser
  accounts              Manage Google accounts (interactive)
  accounts status       Show account health / rate limit status
  accounts add          Add a new Google account via OAuth
  accounts list         List all configured accounts
  accounts remove       Remove accounts interactively
  accounts verify       Verify account tokens are valid
  accounts clear        Remove all accounts
  config show           Print current proxy configuration
  config lan <on|off>   Toggle LAN access (requires restart)
  config backup [label] Create a config/accounts backup
  config list           List stored config backups
  config restore <id>   Restore a backup (restart required)
  backup [label]        Legacy alias for config backup

OPTIONS:
  --help, -h            Show this help message
  --version, -v         Show version number

ENVIRONMENT:
  PORT                  Server port (default: 8080)

EXAMPLES:
  antigravity-claude-proxy run          # One-click setup and start
  antigravity-claude-proxy start
  PORT=3000 antigravity-claude-proxy start
  antigravity-claude-proxy accounts add
`);
}

function configureClaude(port) {
  const targetPort = port || process.env.PORT || DEFAULT_PORT;
  ensureClaudeConfig({ port: targetPort });
  console.log(`Claude Code configured: ${getClaudeSettingsPath()}`);
  console.log(`Proxy URL: http://localhost:${targetPort}\n`);
}

function showVersion() {
  console.log(packageJson.version);
}

function openDashboard() {
  const port = process.env.PORT || DEFAULT_PORT;
  const url = `http://localhost:${port}/dashboard`;
  const platform = process.platform;
  let cmd = 'xdg-open';
  if (platform === 'darwin') cmd = 'open';
  if (platform === 'win32') cmd = 'start';
  console.log(`Opening ${url} ...`);
  spawn(cmd, [url], { stdio: 'inherit', shell: true });
}

async function handleConfigCommand(subArgs) {
  const action = subArgs[0] || 'show';
  const value = subArgs[1];
  const { getConfig, updateConfig } = await import('../src/services/config-service.js');

  if (action === 'show') {
    console.log(JSON.stringify(getConfig(), null, 2));
    return;
  }

  if (action === 'lan') {
    if (!['on', 'off'].includes(value)) {
      console.log('Usage: antigravity-claude-proxy config lan <on|off>');
      return;
    }
    const updated = updateConfig({ allowLanAccess: value === 'on' });
    await createBackup('config-change').catch(() => {});
    console.log(`LAN access ${value === 'on' ? 'enabled' : 'disabled'}. Restart the server to apply.`);
    console.log(`Listen host: ${updated.listenHost}`);
    return;
  }

  if (action === 'backup') {
    const label = value || 'manual';
    const backup = await createBackup(label);
    console.log(`Backup created: ${backup.path}`);
    return;
  }

  if (action === 'list') {
    const backups = await listBackups();
    if (!backups.length) {
      console.log('No backups found.');
      return;
    }
    console.log('Available backups:');
    backups.forEach((backup) => {
      console.log(`- ${backup.name} (${backup.createdAt})`);
    });
    return;
  }

  if (action === 'restore') {
    if (!value) {
      console.log('Usage: antigravity-claude-proxy config restore <backup-name>');
      return;
    }
    await restoreBackup(value);
    console.log(`Backup "${value}" restored. Restart the proxy to apply.`);
    return;
  }

  console.log('Unknown config action. Try "show", "lan", "backup", "list", or "restore".');
}

async function handleBackupCommand(label = 'manual') {
  const backup = await createBackup(label);
  console.log(`Backup created at ${backup.path}`);
}

async function main() {
  // Handle flags
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
  }

  // Handle commands
  switch (command) {
    case 'run':
      // Auto-configure and start
      try {
        configureClaude();
      } catch (err) {
        console.warn(`[CLI] Warning: failed to update Claude settings (${err.message}). Continuing...`);
      }
      await ensureProxyStarted();
      break;

    case 'start':
    case undefined:
      // Default to starting the server
      await ensureProxyStarted();
      break;

    case 'accounts': {
      // Pass remaining args to accounts CLI
      const subCommand = args[1] || 'add';
      if (subCommand === 'status') {
        await showAccountsStatus();
        break;
      }
      process.argv = ['node', 'accounts-cli.js', subCommand, ...args.slice(2)];
      await import('../src/accounts-cli.js');
      break;
    }

    case 'flows':
      await handleFlowsCommand(args.slice(1));
      break;

    case 'dashboard':
      openDashboard();
      break;

    case 'config':
      await handleConfigCommand(args.slice(1));
      break;

    case 'backup':
      await handleBackupCommand(args[1]);
      break;

    case 'help':
      showHelp();
      break;

    case 'version':
      showVersion();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "antigravity-proxy --help" for usage information.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.stack || err.message);
  process.exit(1);
});
