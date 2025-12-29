#!/usr/bin/env node

import {
    needsClaudeReconfigure,
    getClaudeSettingsPath,
    getClaudeSettings,
    buildProxyEnv
} from '../src/services/claude-config.js';

const port = Number(process.env.ANTIGRAVITY_PORT || process.env.PORT || 8080);

const healthy = !needsClaudeReconfigure({ port });

const payload = {
    healthy,
    port,
    settingsPath: getClaudeSettingsPath(),
    expected: buildProxyEnv(port),
    current: getClaudeSettings().env || {}
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
