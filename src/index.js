/**
 * Antigravity Claude Proxy
 * Entry point - starts the proxy server
 */

import app from './server.js';
import { DEFAULT_PORT } from './constants.js';
import { getConfig } from './services/config-service.js';
import { createBackup } from './services/backup-service.js';

const runtimeConfig = getConfig();
const PORT = process.env.PORT || runtimeConfig.port || DEFAULT_PORT;
const HOST = runtimeConfig.listenHost || '127.0.0.1';

createBackup('startup').catch(() => {
    // Non-fatal if backup fails (e.g., permissions)
});

app.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Antigravity Claude Proxy Server                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Server running at: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}                  ║
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
║    export ANTHROPIC_BASE_URL=http://localhost:${PORT}          ║
║    export ANTHROPIC_API_KEY=dummy                            ║
║    claude                                                    ║
║                                                              ║
║  Add Google accounts:                                        ║
║    npm run accounts                                          ║
║                                                              ║
║  Prerequisites (if no accounts configured):                  ║
║    - Antigravity must be running                             ║
║    - Have a chat panel open in Antigravity                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

    if (HOST === '0.0.0.0') {
        console.log('[Security] LAN access enabled. Update via /api/admin/config to disable.');
    }
    console.log(`[Dashboard] http://localhost:${PORT}/dashboard`);
});
