/**
 * Antigravity Claude Proxy
 * Entry point - exports lifecycle helpers for CLI + Desktop
 */

import { fileURLToPath } from 'url';
import app, { getRuntimeSnapshot } from './server.js';
import { DEFAULT_PORT } from './constants.js';
import { getConfig } from './services/config-service.js';
import { createBackup } from './services/backup-service.js';
import { cleanupOldFlows } from './flow-monitor.js';
import { describeClaudeConfigStatus } from './services/claude-config.js';

const __filename = fileURLToPath(import.meta.url);

let serverHandle = null;
let lastError = null;
let lastStatus = {
    running: false,
    host: null,
    port: null,
    startedAt: null,
    lanEnabled: false
};
let claudeConfigStatus = null;
let configWatcher = null;

async function bootstrapConfig() {
    await createBackup('startup').catch(() => {
        // Non-fatal if backup fails (e.g., permissions)
    });
    await cleanupOldFlows().catch(() => {
        // Flow retention failures are non-blocking
    });
}

function startClaudeMonitor(port) {
    const refresh = () => {
        try {
            claudeConfigStatus = describeClaudeConfigStatus({ port });
        } catch (error) {
            claudeConfigStatus = {
                healthy: false,
                error: error.message
            };
        }
    };
    refresh();
    if (!configWatcher) {
        configWatcher = setInterval(refresh, 5000);
    }
}

export async function startProxy(options = {}) {
    if (serverHandle) {
        return serverHandle;
    }

    const runtimeConfig = getConfig();
    const port = options.port || process.env.PORT || runtimeConfig.port || DEFAULT_PORT;
    const host = options.host || runtimeConfig.listenHost || '127.0.0.1';

    await bootstrapConfig();
    startClaudeMonitor(port);

    // Proactively initialize account manager on startup
    // This ensures accounts are loaded even if no API requests are made immediately
    try {
        const { ensureInitialized } = await import('./server.js');
        await ensureInitialized().catch(err => {
            console.warn('[Startup] Account manager initialization warning:', err.message);
        });
    } catch (err) {
        // Ignore - will initialize on first request
        console.warn('[Startup] Could not pre-initialize account manager:', err.message);
    }

    await new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            serverHandle = server;
            lastStatus = {
                running: true,
                host,
                port,
                startedAt: new Date().toISOString(),
                lanEnabled: host === '0.0.0.0'
            };

            console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Antigravity Claude Proxy Server                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Server running at: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}                  ║
║                                                              ║
║  Endpoints:                                                  ║
║    POST /v1/messages  - Anthropic Messages API               ║
║    POST /v1/chat/completions - OpenAI-compatible             ║
║    GET  /v1/models    - List available models                ║
║    GET  /health       - Health check                         ║
║    GET  /account-limits - Account status & quotas              ║
║    POST /refresh-token - Force token refresh                 ║
║    GET  /dashboard     - Web Dashboard UI                    ║
║                                                              ║
║  Usage with Claude Code:                                     ║
║    export ANTHROPIC_BASE_URL=http://localhost:${port}          ║
║    export ANTHROPIC_API_KEY=dummy                            ║
║    claude                                                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);

            if (host === '0.0.0.0') {
                console.log('[Security] LAN access enabled. Update via /api/admin/config to disable.');
            }
            console.log(`[Dashboard] http://localhost:${port}/dashboard`);
            resolve(server);
        });

        server.on('error', (err) => {
            lastError = err;
            reject(err);
        });
    });

    return serverHandle;
}

export async function stopProxy() {
    if (!serverHandle) return;
    await new Promise((resolve, reject) => {
        serverHandle.close((err) => {
            if (err) {
                lastError = err;
                reject(err);
                return;
            }
            serverHandle = null;
            lastStatus.running = false;
            if (configWatcher) {
                clearInterval(configWatcher);
                configWatcher = null;
            }
            resolve();
        });
    });
}

export function getStatus() {
    let accountSnapshot = null;
    try {
        accountSnapshot = getRuntimeSnapshot();
    } catch (error) {
        // ignore if server not initialized yet
    }

    return {
        ...lastStatus,
        currentAccount: accountSnapshot?.currentAccount || null,
        accountSummary: accountSnapshot?.status?.summary || null,
        accounts: accountSnapshot?.status?.accounts || [],
        recommendedAccount: accountSnapshot?.status?.recommendedAccount || null,
        claudeConfig: claudeConfigStatus,
        initialized: accountSnapshot?.initialized ?? false,
        initError: accountSnapshot?.initError || null,
        lastError: lastError ? lastError.message || String(lastError) : null
    };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith(__filename);

if (isDirectRun) {
    startProxy().catch((error) => {
        console.error('[Proxy] Failed to start:', error.message);
        process.exitCode = 1;
    });
}
