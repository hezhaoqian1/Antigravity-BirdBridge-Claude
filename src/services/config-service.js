import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import crypto from 'crypto';

const CONFIG_ROOT = join(homedir(), '.config', 'antigravity-proxy');
const CONFIG_PATH = join(CONFIG_ROOT, 'config.json');

const DEFAULT_CONFIG = {
    version: 1,
    allowLanAccess: false,
    listenHost: '127.0.0.1',
    adminApiKey: '',
    telemetry: false,
    maxFlowEntries: 200,
    createdAt: new Date().toISOString()
};

let cachedConfig = null;

function ensureConfigDir() {
    if (!existsSync(CONFIG_ROOT)) {
        mkdirSync(CONFIG_ROOT, { recursive: true });
    }
}

function generateAdminKey() {
    return crypto.randomBytes(24).toString('hex');
}

function hydrateConfig(raw) {
    const config = { ...DEFAULT_CONFIG, ...raw };
    if (!config.adminApiKey) {
        config.adminApiKey = generateAdminKey();
    }
    if (!config.updatedAt) {
        config.updatedAt = new Date().toISOString();
    }
    return config;
}

function loadConfigFromDisk() {
    ensureConfigDir();
    if (!existsSync(CONFIG_PATH)) {
        const initial = hydrateConfig(DEFAULT_CONFIG);
        try {
            writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2));
        } catch (error) {
            console.warn('[ConfigService] Failed to persist config.json:', error.message);
        }
        return initial;
    }

    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        return hydrateConfig(parsed);
    } catch (error) {
        console.error('[ConfigService] Failed to parse config.json, using defaults:', error.message);
        const fallback = hydrateConfig(DEFAULT_CONFIG);
        writeFileSync(CONFIG_PATH, JSON.stringify(fallback, null, 2));
        return fallback;
    }
}

export function getConfig() {
    if (!cachedConfig) {
        cachedConfig = loadConfigFromDisk();
    }
    return { ...cachedConfig };
}

export function updateConfig(patch) {
    const current = getConfig();
    const allowLanAccess = typeof patch.allowLanAccess === 'boolean' ? patch.allowLanAccess : current.allowLanAccess;
    const next = {
        ...current,
        ...patch,
        allowLanAccess,
        listenHost: allowLanAccess ? '0.0.0.0' : '127.0.0.1',
        updatedAt: new Date().toISOString()
    };

    cachedConfig = next;
    ensureConfigDir();
    try {
        writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
    } catch (error) {
        console.warn('[ConfigService] Failed to persist config.json:', error.message);
    }
    return { ...next };
}

export function getConfigPath() {
    ensureConfigDir();
    return CONFIG_PATH;
}

export function getConfigRoot() {
    ensureConfigDir();
    return CONFIG_ROOT;
}
