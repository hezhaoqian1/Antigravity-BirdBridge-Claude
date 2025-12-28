#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PORT = 8080;

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
antigravity-claude-proxy v${packageJson.version}

Proxy server for using Antigravity's Claude models with Claude Code CLI.

USAGE:
  antigravity-claude-proxy <command> [options]

COMMANDS:
  run                   Auto-configure Claude Code and start proxy (recommended)
  start                 Start the proxy server only (default port: 8080)
  dashboard             Open the local dashboard in your browser
  accounts              Manage Google accounts (interactive)
  accounts add          Add a new Google account via OAuth
  accounts list         List all configured accounts
  accounts remove       Remove accounts interactively
  accounts verify       Verify account tokens are valid
  accounts clear        Remove all accounts
  config show           Print current proxy configuration
  config lan <on|off>   Toggle LAN access (requires restart)
  backup [label]        Create a config/accounts backup

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

function setupClaudeConfig() {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  const port = process.env.PORT || 8080;

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
    console.log(`Created ${claudeDir}`);
  }

  // Read existing settings or create new
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      // Validate settings is a plain object
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  // Merge env settings
  const proxyEnv = {
    ANTHROPIC_AUTH_TOKEN: 'test',
    ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    ANTHROPIC_MODEL: 'claude-opus-4-5-thinking',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5-thinking',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-thinking',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5',
    CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-4-5-thinking'
  };

  settings.env = { ...settings.env, ...proxyEnv };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`Claude Code configured: ${settingsPath}`);
  console.log(`Proxy URL: http://localhost:${port}\n`);
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
    console.log(`LAN access ${value === 'on' ? 'enabled' : 'disabled'}. Restart the server to apply.`);
    console.log(`Listen host: ${updated.listenHost}`);
    return;
  }

  console.log('Unknown config action. Try "show" or "lan".');
}

async function handleBackupCommand(label = 'manual') {
  const { createBackup } = await import('../src/services/backup-service.js');
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
        setupClaudeConfig();
      } catch (err) {
        console.warn(`[CLI] Warning: failed to update Claude settings (${err.message}). Continuing...`);
      }
      await import('../src/index.js');
      break;

    case 'start':
    case undefined:
      // Default to starting the server
      await import('../src/index.js');
      break;

    case 'accounts': {
      // Pass remaining args to accounts CLI
      const subCommand = args[1] || 'add';
      process.argv = ['node', 'accounts-cli.js', subCommand, ...args.slice(2)];
      await import('../src/accounts-cli.js');
      break;
    }

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
