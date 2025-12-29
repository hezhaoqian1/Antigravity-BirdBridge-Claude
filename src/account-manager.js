/**
 * Account Manager
 * Manages multiple Antigravity accounts with sticky selection,
 * automatic failover, and smart cooldown for rate-limited accounts.
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';
import {
    ACCOUNT_CONFIG_PATH,
    ANTIGRAVITY_DB_PATH,
    DEFAULT_COOLDOWN_MS,
    TOKEN_REFRESH_INTERVAL_MS,
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    DEFAULT_PROJECT_ID,
    SHORT_WAIT_THRESHOLD_MS,
    MAX_WAIT_BEFORE_ERROR_MS,
    TIME_WINDOW_LOCK_MS
} from './constants.js';
import { refreshAccessToken } from './oauth.js';
import { formatDuration } from './utils/helpers.js';

function nowMs() {
    return Date.now();
}

function hydrateStats(stats = {}) {
    return {
        successCount: stats.successCount || 0,
        errorCount: stats.errorCount || 0,
        lastSuccessAt: stats.lastSuccessAt || null,
        lastFailureAt: stats.lastFailureAt || null
    };
}

function computeUsageRatio(stats) {
    const total = Math.max(stats.successCount + stats.errorCount, 1);
    return {
        usageRatio: stats.successCount / total,
        errorRatio: stats.errorCount / total
    };
}

function clampScore(value) {
    return Math.round(Math.max(-100, Math.min(120, value)));
}

export class AccountManager {
    #accounts = [];
    #currentIndex = 0;
    #configPath;
    #settings = {};
    #initialized = false;

    // Per-account caches
    #tokenCache = new Map(); // email -> { token, extractedAt }
    #projectCache = new Map(); // email -> projectId

    // Time window lock for cache optimization (inspired by Antigravity-Manager)
    #lastUsedAccount = null; // email of last used account
    #lastUsedTime = null; // timestamp when last used

    constructor(configPath = ACCOUNT_CONFIG_PATH) {
        this.#configPath = configPath;
    }

    /**
     * Initialize the account manager by loading config
     */
    async initialize() {
        if (this.#initialized) return;

        try {
            // Check if config file exists using async access
            await access(this.#configPath, fsConstants.F_OK);
            const configData = await readFile(this.#configPath, 'utf-8');
            const config = JSON.parse(configData);

            this.#accounts = (config.accounts || []).map(acc => {
                const hydrated = {
                    ...acc,
                    isRateLimited: acc.isRateLimited || false,
                    rateLimitResetTime: acc.rateLimitResetTime || null,
                    lastUsed: acc.lastUsed || null,
                    stats: hydrateStats(acc.stats),
                    healthScore: acc.healthScore || 0,
                    recommended: false
                };
                hydrated.healthScore = this.#computeHealthScore(hydrated);
                return hydrated;
            });

            this.#settings = config.settings || {};
            this.#currentIndex = config.activeIndex || 0;

            // Clamp currentIndex to valid range
            if (this.#currentIndex >= this.#accounts.length) {
                this.#currentIndex = 0;
            }

            console.log(`[AccountManager] Loaded ${this.#accounts.length} account(s) from config`);
            this.#updateRecommendations();
        } catch (error) {
            if (error.code === 'ENOENT') {
                // No config file - use single account from Antigravity database
                console.log('[AccountManager] No config file found. Using Antigravity database (single account mode)');
            } else {
                console.error('[AccountManager] Failed to load config:', error.message);
            }
            // Fall back to default account
            await this.#loadDefaultAccount();
        }

        // Clear any expired rate limits
        this.clearExpiredLimits();

        this.#initialized = true;
    }

    /**
     * Load the default account from Antigravity's database
     */
    async #loadDefaultAccount() {
        try {
            const authData = this.#extractTokenFromDB();
            if (authData?.apiKey) {
                const baseAccount = {
                    email: authData.email || 'default@antigravity',
                    source: 'database',
                    isRateLimited: false,
                    rateLimitResetTime: null,
                    lastUsed: null,
                    stats: hydrateStats(),
                    isInvalid: false,
                    recommended: false
                };
                baseAccount.healthScore = this.#computeHealthScore(baseAccount);
                baseAccount.recommended = true;
                this.#accounts = [baseAccount];
                // Pre-cache the token
                this.#tokenCache.set(this.#accounts[0].email, {
                    token: authData.apiKey,
                    extractedAt: nowMs()
                });
                console.log(`[AccountManager] Loaded default account: ${this.#accounts[0].email}`);
            }
        } catch (error) {
            console.error('[AccountManager] Failed to load default account:', error.message);
            // Create empty account list - will fail on first request
            this.#accounts = [];
        }
    }

    /**
     * Extract token from Antigravity's SQLite database
     */
    #extractTokenFromDB(dbPath = ANTIGRAVITY_DB_PATH) {
        const result = execSync(
            `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus';"`,
            { encoding: 'utf-8', timeout: 5000 }
        );

        if (!result || !result.trim()) {
            throw new Error('No auth status found in database');
        }

        return JSON.parse(result.trim());
    }

    /**
     * Get the number of accounts
     * @returns {number} Number of configured accounts
     */
    getAccountCount() {
        return this.#accounts.length;
    }

    /**
     * Check if all accounts are rate-limited
     * @returns {boolean} True if all accounts are rate-limited
     */
    isAllRateLimited() {
        if (this.#accounts.length === 0) return false;
        return this.#accounts.every(acc => acc.isRateLimited);
    }

    /**
     * Get list of available (non-rate-limited, non-invalid) accounts
     * @returns {Array<Object>} Array of available account objects
     */
    getAvailableAccounts() {
        return this.#accounts.filter(acc => !acc.isRateLimited && !acc.isInvalid);
    }

    /**
     * Get list of invalid accounts
     * @returns {Array<Object>} Array of invalid account objects
     */
    getInvalidAccounts() {
        return this.#accounts.filter(acc => acc.isInvalid);
    }

    /**
     * Clear expired rate limits
     * @returns {number} Number of rate limits cleared
     */
    clearExpiredLimits() {
        const now = nowMs();
        let cleared = 0;

        for (const account of this.#accounts) {
            if (account.isRateLimited && account.rateLimitResetTime && account.rateLimitResetTime <= now) {
                account.isRateLimited = false;
                account.rateLimitResetTime = null;
                account.healthScore = this.#computeHealthScore(account);
                cleared++;
                console.log(`[AccountManager] Rate limit expired for: ${account.email}`);
            }
        }

        if (cleared > 0) {
            this.#updateRecommendations();
            this.saveToDisk();
        }

        return cleared;
    }

    /**
     * Clear all rate limits to force a fresh check
     * (Optimistic retry strategy)
     * @returns {void}
     */
    resetAllRateLimits() {
        for (const account of this.#accounts) {
            account.isRateLimited = false;
            // distinct from "clearing" expired limits, we blindly reset here
            // we keep the time? User said "clear isRateLimited value, and rateLimitResetTime"
            // So we clear both.
            account.rateLimitResetTime = null;
        }
        this.#updateRecommendations();
        console.log('[AccountManager] Reset all rate limits for optimistic retry');
    }

    #computeHealthScore(account) {
        const stateWeight = account.isInvalid ? -50 : account.isRateLimited ? -20 : 30;
        const { usageRatio, errorRatio } = computeUsageRatio(account.stats);
        const remainingMs = account.rateLimitResetTime ? account.rateLimitResetTime - nowMs() : 0;
        const cooldownFactor = account.isRateLimited
            ? Math.max(0, 1 - Math.min(1, remainingMs / DEFAULT_COOLDOWN_MS))
            : 1;
        const score =
            stateWeight +
            (1 - usageRatio) * 30 +
            (1 - errorRatio) * 20 +
            cooldownFactor * 10;
        return clampScore(score);
    }

    #updateRecommendations() {
        let topScore = -Infinity;
        for (const account of this.#accounts) {
            if (account.healthScore > topScore && !account.isInvalid) {
                topScore = account.healthScore;
            }
        }
        this.#accounts.forEach(account => {
            account.recommended = !account.isInvalid && account.healthScore === topScore && topScore > 0;
        });
    }

    /**
     * Pick the next available account (fallback when current is unavailable).
     * Sets activeIndex to the selected account's index.
     * @returns {Object|null} The next available account or null if none available
     */
    pickNext() {
        this.clearExpiredLimits();

        const available = this.getAvailableAccounts();
        if (available.length === 0) {
            return null;
        }

        const ordered = this.#accounts
            .map((acc, idx) => ({ acc, idx }))
            .filter(({ acc }) => !acc.isRateLimited && !acc.isInvalid)
            .sort((a, b) => {
                const scoreDelta = (b.acc.healthScore || 0) - (a.acc.healthScore || 0);
                if (scoreDelta !== 0) return scoreDelta;
                return (b.acc.stats.lastSuccessAt || 0) - (a.acc.stats.lastSuccessAt || 0);
            });

        const picked = ordered[0];
        if (!picked) return null;

        this.#currentIndex = picked.idx;
        picked.acc.lastUsed = nowMs();

        const position = picked.idx + 1;
        const total = this.#accounts.length;
        console.log(`[AccountManager] Using account: ${picked.acc.email} (${position}/${total})`);

        this.saveToDisk();
        return picked.acc;
    }

    /**
     * Get the current account without advancing the index (sticky selection).
     * Used for cache continuity - sticks to the same account until rate-limited.
     * @returns {Object|null} The current account or null if unavailable/rate-limited
     */
    getCurrentStickyAccount() {
        this.clearExpiredLimits();

        if (this.#accounts.length === 0) {
            return null;
        }

        // Clamp index to valid range
        if (this.#currentIndex >= this.#accounts.length) {
            this.#currentIndex = 0;
        }

        // Get current account directly (activeIndex = current account)
        const account = this.#accounts[this.#currentIndex];

        // Return if available
        if (account && !account.isRateLimited && !account.isInvalid) {
                account.lastUsed = nowMs();
            // Persist the change (don't await to avoid blocking)
            this.saveToDisk();
            return account;
        }

        return null;
    }

    /**
     * Check if we should wait for the current account's rate limit to reset.
     * Implements intelligent wait/switch strategy:
     * - ≤10s: always wait (SHORT_WAIT_THRESHOLD_MS)
     * - 10-60s: switch if other accounts available, otherwise wait
     * - >60s: error immediately (MAX_WAIT_BEFORE_ERROR_MS)
     * @returns {{shouldWait: boolean, waitMs: number, account: Object|null, shouldSwitch: boolean}}
     */
    shouldWaitForCurrentAccount() {
        if (this.#accounts.length === 0) {
            return { shouldWait: false, waitMs: 0, account: null, shouldSwitch: false };
        }

        // Clamp index to valid range
        if (this.#currentIndex >= this.#accounts.length) {
            this.#currentIndex = 0;
        }

        // Get current account directly (activeIndex = current account)
        const account = this.#accounts[this.#currentIndex];

        if (!account || account.isInvalid) {
            return { shouldWait: false, waitMs: 0, account: null, shouldSwitch: false };
        }

        if (account.isRateLimited && account.rateLimitResetTime) {
            const waitMs = account.rateLimitResetTime - nowMs();

            if (waitMs <= 0) {
                // Already expired
                return { shouldWait: false, waitMs: 0, account, shouldSwitch: false };
            }

            // ≤10s: always wait (not worth switching)
            if (waitMs <= SHORT_WAIT_THRESHOLD_MS) {
                return { shouldWait: true, waitMs, account, shouldSwitch: false };
            }

            // 10-60s: check if other accounts are available
            if (waitMs <= MAX_WAIT_BEFORE_ERROR_MS) {
                const available = this.getAvailableAccounts();
                if (available.length > 0) {
                    // Other accounts available - switch instead of waiting
                    return { shouldWait: false, waitMs, account, shouldSwitch: true };
                }
                // No other accounts - wait
                return { shouldWait: true, waitMs, account, shouldSwitch: false };
            }

            // >60s: don't wait, will trigger error
            return { shouldWait: false, waitMs, account, shouldSwitch: false };
        }

        return { shouldWait: false, waitMs: 0, account, shouldSwitch: false };
    }

    /**
     * Pick an account with sticky selection preference and time window lock.
     * Implements:
     * 1. Time window lock: 60s内强制复用同一账号 (for cache optimization)
     * 2. Intelligent wait/switch strategy
     * @returns {{account: Object|null, waitMs: number}} Account to use and optional wait time
     */
    pickStickyAccount() {
        // Time window lock: If we used an account within TIME_WINDOW_LOCK_MS, prefer it
        if (this.#lastUsedAccount && this.#lastUsedTime) {
            const timeSinceLastUse = nowMs() - this.#lastUsedTime;
            if (timeSinceLastUse < TIME_WINDOW_LOCK_MS) {
                // Find the last used account
                const lockedAccount = this.#accounts.find(a => a.email === this.#lastUsedAccount);
                if (lockedAccount && !lockedAccount.isRateLimited && !lockedAccount.isInvalid) {
                    lockedAccount.lastUsed = nowMs();
                    this.#lastUsedTime = nowMs();
                    this.saveToDisk();
                    return { account: lockedAccount, waitMs: 0 };
                }
                // Locked account is rate-limited or invalid, check if we should wait
                if (lockedAccount && lockedAccount.isRateLimited && lockedAccount.rateLimitResetTime) {
                    const waitMs = lockedAccount.rateLimitResetTime - nowMs();
                    // If short wait (≤10s), wait for the locked account to maintain cache
                    if (waitMs > 0 && waitMs <= SHORT_WAIT_THRESHOLD_MS) {
                        console.log(`[AccountManager] Time window lock: waiting ${formatDuration(waitMs)} for ${lockedAccount.email}`);
                        return { account: null, waitMs };
                    }
                }
            }
        }

        // First try to get the current sticky account
        const stickyAccount = this.getCurrentStickyAccount();
        if (stickyAccount) {
            // Update time window lock
            this.#lastUsedAccount = stickyAccount.email;
            this.#lastUsedTime = nowMs();
            return { account: stickyAccount, waitMs: 0 };
        }

        // Check if we should wait for current account
        const waitInfo = this.shouldWaitForCurrentAccount();

        if (waitInfo.shouldSwitch) {
            // Switch to another account instead of waiting
            console.log(`[AccountManager] Switching from ${waitInfo.account.email} (wait ${formatDuration(waitInfo.waitMs)}) to another account`);
            const nextAccount = this.pickNext();
            if (nextAccount) {
                // Update time window lock
                this.#lastUsedAccount = nextAccount.email;
                this.#lastUsedTime = nowMs();
                console.log(`[AccountManager] Switched to: ${nextAccount.email}`);
            }
            return { account: nextAccount, waitMs: 0 };
        }

        if (waitInfo.shouldWait) {
            console.log(`[AccountManager] Waiting ${formatDuration(waitInfo.waitMs)} for sticky account: ${waitInfo.account.email}`);
            return { account: null, waitMs: waitInfo.waitMs };
        }

        // Current account unavailable for too long, switch to next available
        const nextAccount = this.pickNext();
        if (nextAccount) {
            // Update time window lock
            this.#lastUsedAccount = nextAccount.email;
            this.#lastUsedTime = nowMs();
            console.log(`[AccountManager] Switched to new account for cache: ${nextAccount.email}`);
        }
        return { account: nextAccount, waitMs: 0 };
    }

    /**
     * Mark an account as rate-limited
     * @param {string} email - Email of the account to mark
     * @param {number|null} resetMs - Time in ms until rate limit resets (optional)
     */
    markRateLimited(email, resetMs = null) {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return;

        account.isRateLimited = true;
        const cooldownMs = resetMs || this.#settings.cooldownDurationMs || DEFAULT_COOLDOWN_MS;
        account.rateLimitResetTime = nowMs() + cooldownMs;
        account.stats.errorCount += 1;
        account.stats.lastFailureAt = nowMs();
        account.healthScore = this.#computeHealthScore(account);
        this.#updateRecommendations();

        console.log(
            `[AccountManager] Rate limited: ${email}. Available in ${formatDuration(cooldownMs)}`
        );

        this.saveToDisk();
    }

    /**
     * Mark an account as invalid (credentials need re-authentication)
     * @param {string} email - Email of the account to mark
     * @param {string} reason - Reason for marking as invalid
     */
    markInvalid(email, reason = 'Unknown error') {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return;

        account.isInvalid = true;
        account.invalidReason = reason;
        account.invalidAt = nowMs();

        console.log(
            `[AccountManager] ⚠ Account INVALID: ${email}`
        );
        console.log(
            `[AccountManager]   Reason: ${reason}`
        );
        console.log(
            `[AccountManager]   Run 'npm run accounts' to re-authenticate this account`
        );

        account.healthScore = this.#computeHealthScore(account);
        this.#updateRecommendations();
        this.saveToDisk();
    }

    recordSuccess(email) {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return;
        account.stats.successCount += 1;
        account.stats.lastSuccessAt = nowMs();
        account.lastUsed = nowMs();
        account.isRateLimited = false;
        account.rateLimitResetTime = null;
        account.isInvalid = false;
        account.healthScore = this.#computeHealthScore(account);
        this.#updateRecommendations();
        this.saveToDisk();
    }

    recordFailure(email, details = {}) {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return;
        account.stats.errorCount += 1;
        account.stats.lastFailureAt = nowMs();
        if (details.invalidate) {
            account.isInvalid = true;
            account.invalidReason = details.invalidate;
        }
        if (typeof details.rateLimitMs === 'number') {
            account.isRateLimited = true;
            account.rateLimitResetTime = nowMs() + details.rateLimitMs;
        }
        account.healthScore = this.#computeHealthScore(account);
        this.#updateRecommendations();
        this.saveToDisk();
    }

    /**
     * Get the minimum wait time until any account becomes available
     * @returns {number} Wait time in milliseconds
     */
    getMinWaitTimeMs() {
        if (!this.isAllRateLimited()) return 0;

        const now = nowMs();
        let minWait = Infinity;
        let soonestAccount = null;

        for (const account of this.#accounts) {
            if (account.rateLimitResetTime) {
                const wait = account.rateLimitResetTime - now;
                if (wait > 0 && wait < minWait) {
                    minWait = wait;
                    soonestAccount = account;
                }
            }
        }

        if (soonestAccount) {
            console.log(`[AccountManager] Shortest wait: ${formatDuration(minWait)} (account: ${soonestAccount.email})`);
        }

        return minWait === Infinity ? DEFAULT_COOLDOWN_MS : minWait;
    }

    /**
     * Get OAuth token for an account
     * @param {Object} account - Account object with email and credentials
     * @returns {Promise<string>} OAuth access token
     * @throws {Error} If token refresh fails
     */
    async getTokenForAccount(account) {
        // Check cache first
        const cached = this.#tokenCache.get(account.email);
        if (cached && (nowMs() - cached.extractedAt) < TOKEN_REFRESH_INTERVAL_MS) {
            return cached.token;
        }

        // Get fresh token based on source
        let token;

        if (account.source === 'oauth' && account.refreshToken) {
            // OAuth account - use refresh token to get new access token
            try {
                const tokens = await refreshAccessToken(account.refreshToken);
                token = tokens.accessToken;
                // Clear invalid flag on success
                if (account.isInvalid) {
                    account.isInvalid = false;
                    account.invalidReason = null;
                    await this.saveToDisk();
                }
                console.log(`[AccountManager] Refreshed OAuth token for: ${account.email}`);
            } catch (error) {
                console.error(`[AccountManager] Failed to refresh token for ${account.email}:`, error.message);
                // Mark account as invalid (credentials need re-auth)
                this.markInvalid(account.email, error.message);
                throw new Error(`AUTH_INVALID: ${account.email}: ${error.message}`);
            }
        } else if (account.source === 'manual' && account.apiKey) {
            token = account.apiKey;
        } else {
            // Extract from database
            const dbPath = account.dbPath || ANTIGRAVITY_DB_PATH;
            const authData = this.#extractTokenFromDB(dbPath);
            token = authData.apiKey;
        }

        // Cache the token
        this.#tokenCache.set(account.email, {
            token,
            extractedAt: nowMs()
        });

        return token;
    }

    /**
     * Get project ID for an account
     * @param {Object} account - Account object
     * @param {string} token - OAuth access token
     * @returns {Promise<string>} Project ID
     */
    async getProjectForAccount(account, token) {
        // Check cache first
        const cached = this.#projectCache.get(account.email);
        if (cached) {
            return cached;
        }

        // OAuth or manual accounts may have projectId specified
        if (account.projectId) {
            this.#projectCache.set(account.email, account.projectId);
            return account.projectId;
        }

        // Discover project via loadCodeAssist API
        const project = await this.#discoverProject(token);
        this.#projectCache.set(account.email, project);
        return project;
    }

    /**
     * Discover project ID via Cloud Code API
     */
    async #discoverProject(token) {
        for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
            try {
                const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        ...ANTIGRAVITY_HEADERS
                    },
                    body: JSON.stringify({
                        metadata: {
                            ideType: 'IDE_UNSPECIFIED',
                            platform: 'PLATFORM_UNSPECIFIED',
                            pluginType: 'GEMINI'
                        }
                    })
                });

                if (!response.ok) continue;

                const data = await response.json();

                if (typeof data.cloudaicompanionProject === 'string') {
                    return data.cloudaicompanionProject;
                }
                if (data.cloudaicompanionProject?.id) {
                    return data.cloudaicompanionProject.id;
                }
            } catch (error) {
                console.log(`[AccountManager] Project discovery failed at ${endpoint}:`, error.message);
            }
        }

        console.log(`[AccountManager] Using default project: ${DEFAULT_PROJECT_ID}`);
        return DEFAULT_PROJECT_ID;
    }

    /**
     * Clear project cache for an account (useful on auth errors)
     * @param {string|null} email - Email to clear cache for, or null to clear all
     */
    clearProjectCache(email = null) {
        if (email) {
            this.#projectCache.delete(email);
        } else {
            this.#projectCache.clear();
        }
    }

    /**
     * Clear token cache for an account (useful on auth errors)
     * @param {string|null} email - Email to clear cache for, or null to clear all
     */
    clearTokenCache(email = null) {
        if (email) {
            this.#tokenCache.delete(email);
        } else {
            this.#tokenCache.clear();
        }
    }

    /**
     * Save current state to disk (async)
     * @returns {Promise<void>}
     */
    async saveToDisk() {
        try {
            // Ensure directory exists
            const dir = dirname(this.#configPath);
            await mkdir(dir, { recursive: true });

            const config = {
                accounts: this.#accounts.map(acc => ({
                    email: acc.email,
                    source: acc.source,
                    dbPath: acc.dbPath || null,
                    refreshToken: acc.source === 'oauth' ? acc.refreshToken : undefined,
                    apiKey: acc.source === 'manual' ? acc.apiKey : undefined,
                    projectId: acc.projectId || undefined,
                    addedAt: acc.addedAt || undefined,
                    isRateLimited: acc.isRateLimited,
                    rateLimitResetTime: acc.rateLimitResetTime,
                    isInvalid: acc.isInvalid || false,
                    invalidReason: acc.invalidReason || null,
                    lastUsed: acc.lastUsed,
                    stats: acc.stats,
                    healthScore: acc.healthScore,
                    recommended: acc.recommended
                })),
                settings: this.#settings,
                activeIndex: this.#currentIndex
            };

            await writeFile(this.#configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('[AccountManager] Failed to save config:', error.message);
        }
    }

    /**
     * Get status object for logging/API
     * @returns {{accounts: Array, settings: Object}} Status object with accounts and settings
     */
    getStatus() {
        const available = this.getAvailableAccounts();
        const rateLimited = this.#accounts.filter(a => a.isRateLimited);
        const invalid = this.getInvalidAccounts();
        const sorted = this.#accounts
            .filter(a => !a.isInvalid)
            .sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
        const recommended = sorted[0]?.email || null;

        return {
            total: this.#accounts.length,
            available: available.length,
            rateLimited: rateLimited.length,
            invalid: invalid.length,
            recommendedAccount: recommended,
            summary: `${this.#accounts.length} total, ${available.length} available, ${rateLimited.length} rate-limited, ${invalid.length} invalid`,
            accounts: this.#accounts.map(a => ({
                email: a.email,
                source: a.source,
                isRateLimited: a.isRateLimited,
                rateLimitResetTime: a.rateLimitResetTime,
                isInvalid: a.isInvalid || false,
                invalidReason: a.invalidReason || null,
                lastUsed: a.lastUsed,
                stats: a.stats,
                healthScore: a.healthScore,
                recommended: a.recommended,
                nextAvailableAt: a.isRateLimited ? a.rateLimitResetTime : null
            }))
        };
    }

    /**
     * Get the currently active account (last used in time window)
     * @returns {object|null} The current account or null if none
     */
    getCurrentAccount() {
        if (this.#lastUsedAccount && this.#accounts.length > 0) {
            return this.#accounts.find(a => a.email === this.#lastUsedAccount) || null;
        }
        // Return the account at current index
        if (this.#accounts.length > 0) {
            return this.#accounts[this.#currentIndex] || this.#accounts[0];
        }
        return null;
    }

    /**
     * Get settings
     * @returns {Object} Current settings object
     */
    getSettings() {
        return { ...this.#settings };
    }

    /**
     * Get all accounts (internal use for quota fetching)
     * Returns the full account objects including credentials
     * @returns {Array<Object>} Array of account objects
     */
    getAllAccounts() {
        return this.#accounts;
    }
}

export default AccountManager;
