import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

const DEFAULT_ENV = {
    ANTHROPIC_AUTH_TOKEN: 'test',
    ANTHROPIC_MODEL: 'claude-opus-4-5-thinking',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5-thinking',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5-thinking',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5',
    CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-4-5-thinking'
};

function ensureClaudeDir() {
    if (!existsSync(CLAUDE_DIR)) {
        mkdirSync(CLAUDE_DIR, { recursive: true });
    }
}

export function getClaudeSettings() {
    ensureClaudeDir();
    if (!existsSync(CLAUDE_SETTINGS_PATH)) {
        return {};
    }
    try {
        const data = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch {
        // Ignore parse errors, fallback to empty
    }
    return {};
}

export function buildProxyEnv(port = 8080) {
    return {
        ...DEFAULT_ENV,
        ANTHROPIC_BASE_URL: `http://localhost:${port}`
    };
}

export function ensureClaudeConfig(options = {}) {
    const port = options.port || process.env.PORT || 8080;
    const settings = getClaudeSettings();
    const currentEnv = settings.env || {};
    const mergedEnv = { ...currentEnv, ...buildProxyEnv(port) };

    const next = {
        ...settings,
        env: mergedEnv
    };

    ensureClaudeDir();
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(next, null, 2));
    return next;
}

export function needsClaudeReconfigure(options = {}) {
    const port = options.port || process.env.PORT || 8080;
    const settings = getClaudeSettings();
    const desired = buildProxyEnv(port);
    const currentEnv = settings.env || {};
    return Object.entries(desired).some(([key, value]) => currentEnv[key] !== value);
}

export function getClaudeSettingsPath() {
    ensureClaudeDir();
    return CLAUDE_SETTINGS_PATH;
}

export function describeClaudeConfigStatus(options = {}) {
    const port = options.port || process.env.PORT || 8080;
    const needsFix = needsClaudeReconfigure({ port });
    return {
        settingsPath: getClaudeSettingsPath(),
        healthy: !needsFix,
        expectedEnv: buildProxyEnv(port),
        current: getClaudeSettings().env || {}
    };
}
