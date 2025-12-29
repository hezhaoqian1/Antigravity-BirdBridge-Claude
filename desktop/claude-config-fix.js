#!/usr/bin/env node

import {
    ensureClaudeConfig,
    getClaudeSettingsPath
} from '../src/services/claude-config.js';

const port = Number(process.env.ANTIGRAVITY_PORT || process.env.PORT || 8080);

const updated = ensureClaudeConfig({ port });

process.stdout.write(
    `${JSON.stringify({
        healthy: true,
        port,
        settingsPath: getClaudeSettingsPath(),
        env: updated.env
    })}\n`
);
