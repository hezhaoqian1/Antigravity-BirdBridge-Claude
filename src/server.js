/**
 * Express Server - Anthropic-compatible API
 * Proxies to Google Cloud Code via Antigravity
 * Supports multi-account load balancing
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { listModels, getModelQuotas } from './cloudcode-client.js';
import { forceRefresh } from './token-extractor.js';
import {
    REQUEST_BODY_LIMIT,
    BACKGROUND_TASK_PATTERNS,
    FREE_MODEL_FOR_BACKGROUND,
    MODEL_MAPPINGS,
    AVAILABLE_MODELS
} from './constants.js';
import { AccountManager } from './account-manager.js';
import { formatDuration } from './utils/helpers.js';
import { flowMonitor } from './flow-monitor.js';
import { getConfig, updateConfig } from './services/config-service.js';
import { createBackup, listBackups } from './services/backup-service.js';
import { openAIChatToAnthropic, anthropicToOpenAIChat } from './utils/openai-adapter.js';
import { createDefaultRegistry } from './providers/provider-registry.js';

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Initialize account manager (will be fully initialized on first request or startup)
const accountManager = new AccountManager();
const providerRegistry = createDefaultRegistry(accountManager);
const runtimeConfig = getConfig();
flowMonitor.setMaxEntries(runtimeConfig.maxFlowEntries || 200);

// Track initialization status
let isInitialized = false;
let initError = null;
let initPromise = null;

const ADMIN_HEADER = 'x-admin-key';

function hasValidAdminKey(req) {
    const config = getConfig();
    const expected = config.adminApiKey;
    if (!expected) return true;
    const provided = req.headers[ADMIN_HEADER] || req.query.adminKey;
    return typeof provided === 'string' && provided === expected;
}

function requireAdminAuth(req, res) {
    if (hasValidAdminKey(req)) {
        return true;
    }
    res.status(401).json({
        status: 'error',
        error: 'Invalid admin key. Provide via X-Admin-Key header.'
    });
    return false;
}

function sanitizeConfig(config) {
    const preview = config.adminApiKey ? `${config.adminApiKey.slice(0, 4)}***` : null;
    return {
        ...config,
        adminApiKey: undefined,
        adminKeyPreview: preview
    };
}

function summarizeResponseBody(response) {
    if (!response) return null;
    if (Array.isArray(response.content)) {
        const textBlock = response.content.find(block => block.text);
        if (textBlock?.text) {
            return textBlock.text.slice(0, 280);
        }
    }
    if (response.output) {
        return `${response.output}`.slice(0, 280);
    }
    if (response.completion) {
        return `${response.completion}`.slice(0, 280);
    }
    return null;
}

function getProviderId(req) {
    return req.header('x-provider') || req.query.provider || 'antigravity';
}

/**
 * Ensure account manager is initialized (with race condition protection)
 */
async function ensureInitialized() {
    if (isInitialized) return;

    // If initialization is already in progress, wait for it
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await accountManager.initialize();
            isInitialized = true;
            const status = accountManager.getStatus();
            console.log(`[Server] Account pool initialized: ${status.summary}`);
        } catch (error) {
            initError = error;
            initPromise = null; // Allow retry on failure
            console.error('[Server] Failed to initialize account manager:', error.message);
            throw error;
        }
    })();

    return initPromise;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// Serve static files from dashboard build directory
const dashboardPath = path.join(__dirname, '../dashboard/dist');
app.use(express.static(dashboardPath));

const SUPPORTED_MODEL_IDS = new Set([
    ...Object.keys(MODEL_MAPPINGS),
    ...Object.values(MODEL_MAPPINGS),
    ...AVAILABLE_MODELS.map(model => model.id)
]);

function isSupportedModel(modelId) {
    return typeof modelId === 'string' && SUPPORTED_MODEL_IDS.has(modelId);
}

/**
 * Token Saver: Detect if a request is a background task that can use a free model
 * (Inspired by Antigravity-Manager's unique feature)
 * @param {Array} messages - The messages array from the request
 * @param {string|Array} system - The system prompt
 * @returns {boolean} True if this is a background task
 */
function isBackgroundTask(messages, system) {
    // Combine all content into a single string for pattern matching
    const allContent = [];

    // Add system prompt
    if (system) {
        if (typeof system === 'string') {
            allContent.push(system.toLowerCase());
        } else if (Array.isArray(system)) {
            system.forEach(s => {
                if (typeof s === 'string') allContent.push(s.toLowerCase());
                else if (s.text) allContent.push(s.text.toLowerCase());
            });
        }
    }

    // Add message content (focus on first few messages)
    const messagesToCheck = messages.slice(0, 3);
    for (const msg of messagesToCheck) {
        if (typeof msg.content === 'string') {
            allContent.push(msg.content.toLowerCase());
        } else if (Array.isArray(msg.content)) {
            msg.content.forEach(block => {
                if (block.text) allContent.push(block.text.toLowerCase());
            });
        }
    }

    const combined = allContent.join(' ');

    // Check against background task patterns
    for (const pattern of BACKGROUND_TASK_PATTERNS) {
        if (combined.includes(pattern.toLowerCase())) {
            return true;
        }
    }

    return false;
}

/**
 * Parse error message to extract error type, status code, and user-friendly message
 * Now supports 503 with Retry-After for rate limit errors (inspired by ProxyCast)
 */
function parseError(error, accountManager = null) {
    let errorType = 'api_error';
    let statusCode = 500;
    let errorMessage = error.message;
    let retryAfterSeconds = null;

    if (error.message.includes('401') || error.message.includes('UNAUTHENTICATED')) {
        errorType = 'authentication_error';
        statusCode = 401;
        errorMessage = 'Authentication failed. Make sure Antigravity is running with a valid token.';
    } else if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('QUOTA_EXHAUSTED')) {
        // Use 503 with Retry-After for rate limit errors (inspired by ProxyCast)
        errorType = 'overloaded_error';
        statusCode = 503;

        // Try to extract the quota reset time from the error
        const resetMatch = error.message.match(/quota will reset after ((\d+)h)?(\d+)m(\d+)s|(\d+)s/i);
        const modelMatch = error.message.match(/"model":\s*"([^"]+)"/);
        const model = modelMatch ? modelMatch[1] : 'the model';

        // Calculate retry-after seconds
        if (resetMatch) {
            const hours = parseInt(resetMatch[2] || '0', 10);
            const minutes = parseInt(resetMatch[3] || '0', 10);
            const seconds = parseInt(resetMatch[4] || resetMatch[5] || '0', 10);
            retryAfterSeconds = hours * 3600 + minutes * 60 + seconds;
            errorMessage = `You have exhausted your capacity on ${model}. Quota will reset after ${resetMatch[0]}.`;
        } else {
            // Try to get from account manager if provided
            if (accountManager && accountManager.isAllRateLimited()) {
                const waitMs = accountManager.getMinWaitTimeMs();
                retryAfterSeconds = Math.ceil(waitMs / 1000);
            } else {
                retryAfterSeconds = 60; // Default 60 seconds
            }
            errorMessage = `You have exhausted your capacity on ${model}. Please wait for your quota to reset.`;
        }
    } else if (error.message.includes('invalid_request_error') || error.message.includes('INVALID_ARGUMENT')) {
        errorType = 'invalid_request_error';
        statusCode = 400;
        const msgMatch = error.message.match(/"message":"([^"]+)"/);
        if (msgMatch) errorMessage = msgMatch[1];
    } else if (error.message.includes('All endpoints failed')) {
        errorType = 'api_error';
        statusCode = 503;
        errorMessage = 'Unable to connect to Claude API. Check that Antigravity is running.';
    } else if (error.message.includes('PERMISSION_DENIED')) {
        errorType = 'permission_error';
        statusCode = 403;
        errorMessage = 'Permission denied. Check your Antigravity license.';
    }

    return { errorType, statusCode, errorMessage, retryAfterSeconds };
}

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
    try {
        await ensureInitialized();
        const status = accountManager.getStatus();
        const current = accountManager.getCurrentAccount();

        res.json({
            status: 'ok',
            activeAccounts: status.available,
            totalAccounts: status.total,
            currentAccount: current?.email || null,
            accounts: status.summary,
            available: status.available,
            rateLimited: status.rateLimited,
            invalid: status.invalid,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Account limits endpoint - fetch quota/limits for all accounts × all models
 * Returns a table showing remaining quota and reset time for each combination
 * Use ?format=table for ASCII table output, default is JSON
 */
app.get('/account-limits', async (req, res) => {
    try {
        await ensureInitialized();
        const allAccounts = accountManager.getAllAccounts();
        const format = req.query.format || 'json';

        // Fetch quotas for each account in parallel
        const results = await Promise.allSettled(
            allAccounts.map(async (account) => {
                // Skip invalid accounts
                if (account.isInvalid) {
                    return {
                        email: account.email,
                        status: 'invalid',
                        error: account.invalidReason,
                        models: {}
                    };
                }

                try {
                    const token = await accountManager.getTokenForAccount(account);
                    const quotas = await getModelQuotas(token);

                    return {
                        email: account.email,
                        status: 'ok',
                        models: quotas
                    };
                } catch (error) {
                    return {
                        email: account.email,
                        status: 'error',
                        error: error.message,
                        models: {}
                    };
                }
            })
        );

        // Process results
        const accountLimits = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    email: allAccounts[index].email,
                    status: 'error',
                    error: result.reason?.message || 'Unknown error',
                    models: {}
                };
            }
        });

        // Collect all unique model IDs
        const allModelIds = new Set();
        for (const account of accountLimits) {
            for (const modelId of Object.keys(account.models || {})) {
                allModelIds.add(modelId);
            }
        }

        const sortedModels = Array.from(allModelIds).filter(m => m.includes('claude')).sort();

        // Return ASCII table format
        if (format === 'table') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');

            // Build table
            const lines = [];
            const timestamp = new Date().toLocaleString();
            lines.push(`Account Limits (${timestamp})`);

            // Get account status info
            const status = accountManager.getStatus();
            lines.push(`Accounts: ${status.total} total, ${status.available} available, ${status.rateLimited} rate-limited, ${status.invalid} invalid`);
            lines.push('');

            // Table 1: Account status
            const accColWidth = 25;
            const statusColWidth = 15;
            const lastUsedColWidth = 25;
            const resetColWidth = 25;

            let accHeader = 'Account'.padEnd(accColWidth) + 'Status'.padEnd(statusColWidth) + 'Last Used'.padEnd(lastUsedColWidth) + 'Quota Reset';
            lines.push(accHeader);
            lines.push('─'.repeat(accColWidth + statusColWidth + lastUsedColWidth + resetColWidth));

            for (const acc of status.accounts) {
                const shortEmail = acc.email.split('@')[0].slice(0, 22);
                const lastUsed = acc.lastUsed ? new Date(acc.lastUsed).toLocaleString() : 'never';

                // Get status and error from accountLimits
                const accLimit = accountLimits.find(a => a.email === acc.email);
                let accStatus;
                if (acc.isInvalid) {
                    accStatus = 'invalid';
                } else if (acc.isRateLimited) {
                    const remaining = acc.rateLimitResetTime ? acc.rateLimitResetTime - Date.now() : 0;
                    accStatus = remaining > 0 ? `limited (${formatDuration(remaining)})` : 'rate-limited';
                } else {
                    accStatus = accLimit?.status || 'ok';
                }

                // Get reset time from quota API
                const claudeModel = sortedModels.find(m => m.includes('claude'));
                const quota = claudeModel && accLimit?.models?.[claudeModel];
                const resetTime = quota?.resetTime
                    ? new Date(quota.resetTime).toLocaleString()
                    : '-';

                let row = shortEmail.padEnd(accColWidth) + accStatus.padEnd(statusColWidth) + lastUsed.padEnd(lastUsedColWidth) + resetTime;

                // Add error on next line if present
                if (accLimit?.error) {
                    lines.push(row);
                    lines.push('  └─ ' + accLimit.error);
                } else {
                    lines.push(row);
                }
            }
            lines.push('');

            // Calculate column widths
            const modelColWidth = Math.max(25, ...sortedModels.map(m => m.length)) + 2;
            const accountColWidth = 22;

            // Header row
            let header = 'Model'.padEnd(modelColWidth);
            for (const acc of accountLimits) {
                const shortEmail = acc.email.split('@')[0].slice(0, 18);
                header += shortEmail.padEnd(accountColWidth);
            }
            lines.push(header);
            lines.push('─'.repeat(modelColWidth + accountLimits.length * accountColWidth));

            // Data rows
            for (const modelId of sortedModels) {
                let row = modelId.padEnd(modelColWidth);
                for (const acc of accountLimits) {
                    const quota = acc.models?.[modelId];
                    let cell;
                    if (acc.status !== 'ok') {
                        cell = `[${acc.status}]`;
                    } else if (!quota) {
                        cell = '-';
                    } else if (quota.remainingFraction === null) {
                        cell = '0% (exhausted)';
                    } else {
                        const pct = Math.round(quota.remainingFraction * 100);
                        cell = `${pct}%`;
                    }
                    row += cell.padEnd(accountColWidth);
                }
                lines.push(row);
            }

            return res.send(lines.join('\n'));
        }

        // Default: JSON format
        res.json({
            timestamp: new Date().toLocaleString(),
            totalAccounts: allAccounts.length,
            models: sortedModels,
            accounts: accountLimits.map(acc => ({
                email: acc.email,
                status: acc.status,
                error: acc.error || null,
                limits: Object.fromEntries(
                    sortedModels.map(modelId => {
                        const quota = acc.models?.[modelId];
                        if (!quota) {
                            return [modelId, null];
                        }
                        return [modelId, {
                            remaining: quota.remainingFraction !== null
                                ? `${Math.round(quota.remainingFraction * 100)}%`
                                : 'N/A',
                            remainingFraction: quota.remainingFraction,
                            resetTime: quota.resetTime || null
                        }];
                    })
                )
            }))
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * Force token refresh endpoint
 */
app.post('/refresh-token', async (req, res) => {
    try {
        await ensureInitialized();
        // Clear all caches
        accountManager.clearTokenCache();
        accountManager.clearProjectCache();
        // Force refresh default token
        const token = await forceRefresh();
        res.json({
            status: 'ok',
            message: 'Token caches cleared and refreshed',
            tokenPrefix: token.substring(0, 10) + '...'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * Provider metadata
 */
app.get('/api/providers', (req, res) => {
    res.json({ providers: providerRegistry.list() });
});

/**
 * Flow monitor endpoints
 */
app.get('/api/flows', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json({ flows: flowMonitor.listFlows(limit) });
});

app.get('/api/flows/:id', (req, res) => {
    const flow = flowMonitor.getFlow(req.params.id);
    if (!flow) {
        return res.status(404).json({ error: 'Flow not found' });
    }
    res.json(flow);
});

app.delete('/api/flows', (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    flowMonitor.reset();
    res.json({ status: 'ok' });
});

/**
 * Admin config + backup endpoints
 */
app.get('/api/admin/config', (req, res) => {
    res.json({ config: sanitizeConfig(getConfig()) });
});

app.post('/api/admin/config', (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    const payload = req.body || {};
    const allowed = {};

    if (typeof payload.allowLanAccess === 'boolean') {
        allowed.allowLanAccess = payload.allowLanAccess;
    }
    if (typeof payload.maxFlowEntries === 'number') {
        allowed.maxFlowEntries = Math.max(50, Math.min(payload.maxFlowEntries, 2000));
    }
    if (typeof payload.telemetry === 'boolean') {
        allowed.telemetry = payload.telemetry;
    }

    const updated = updateConfig(allowed);
    flowMonitor.setMaxEntries(updated.maxFlowEntries || 200);
    res.json({
        status: 'ok',
        requiresRestart: Object.prototype.hasOwnProperty.call(allowed, 'allowLanAccess'),
        config: sanitizeConfig(updated)
    });
});

app.get('/api/admin/backups', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    const backups = await listBackups();
    res.json({ backups });
});

app.post('/api/admin/backup', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    const label = req.body?.label || 'manual';
    const backup = await createBackup(label);
    res.json({ status: 'ok', backup });
});

/**
 * List models endpoint (OpenAI-compatible format)
 */
app.get('/v1/models', (req, res) => {
    const provider = providerRegistry.get(getProviderId(req));
    if (!provider) {
        return res.status(404).json({ error: 'Unknown provider' });
    }
    const models = provider.listModels ? provider.listModels() : listModels();
    res.json(models);
});

/**
 * OpenAI-compatible chat completions endpoint
 */
app.post('/v1/chat/completions', async (req, res) => {
    let flow = null;
    let started = null;
    const provider = providerRegistry.get(getProviderId(req));
    if (!provider) {
        return res.status(404).json({ error: 'Unknown provider' });
    }

    if (req.body?.stream) {
        return res.status(400).json({
            error: { message: 'Streaming via OpenAI chat completions is not supported yet.' }
        });
    }

    try {
        await ensureInitialized();
        const anthropicPayload = openAIChatToAnthropic(req.body);
        flow = flowMonitor.startFlow({
            protocol: 'openai',
            route: '/v1/chat/completions',
            model: anthropicPayload.model,
            provider: provider.id,
            stream: false,
            account: accountManager.getCurrentAccount()?.email || null,
            requestBody: anthropicPayload
        });

        started = Date.now();
        const response = await provider.send(anthropicPayload);
        const openaiResponse = anthropicToOpenAIChat(response, req.body);
        flowMonitor.completeFlow(flow.id, {
            responseSummary: summarizeResponseBody(response),
            usage: response?.usage || response?.usageMetadata || null,
            latencyMs: Date.now() - started,
            account: accountManager.getCurrentAccount()?.email || null
        });
        res.json(openaiResponse);
    } catch (error) {
        console.error('[OpenAI] Error:', error);
        if (flow) {
            flowMonitor.completeFlow(flow.id, {
                error: error.message,
                latencyMs: started ? Date.now() - started : null
            });
        }
        res.status(500).json({
            error: { message: error.message }
        });
    }
});

/**
 * Main messages endpoint - Anthropic Messages API compatible
 */
app.post('/v1/messages', async (req, res) => {
    let flowEntry = null;
    let started = null;
    let provider = null;
    try {
        // Ensure account manager is initialized
        await ensureInitialized();
        provider = providerRegistry.get(getProviderId(req));
        if (!provider) {
            return res.status(404).json({
                type: 'error',
                error: { type: 'not_found_error', message: 'Unknown provider' }
            });
        }

        // Optimistic Retry: If ALL accounts are rate-limited, reset them to force a fresh check.
        // If we have some available accounts, we try them first.
        if (accountManager.isAllRateLimited()) {
            console.log('[Server] All accounts rate-limited. Resetting state for optimistic retry.');
            accountManager.resetAllRateLimits();
        }

        const {
            model,
            messages,
            max_tokens,
            stream,
            system,
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        } = req.body;

        // Validate required fields
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                type: 'error',
                error: {
                    type: 'invalid_request_error',
                    message: 'messages is required and must be an array'
                }
            });
        }

        // Token Saver: Detect background tasks and redirect to a cheaper model
        let effectiveModel = model || 'claude-3-5-sonnet-20241022';
        const canDowngrade =
            (!tools || tools.length === 0) &&
            !thinking &&
            isSupportedModel(FREE_MODEL_FOR_BACKGROUND);

        if (canDowngrade && isBackgroundTask(messages, system)) {
            console.log(
                `[TOKEN_SAVER] Detected background task, redirecting from ${effectiveModel} to ${FREE_MODEL_FOR_BACKGROUND}`
            );
            effectiveModel = FREE_MODEL_FOR_BACKGROUND;
        }

        // Build the request object
        const request = {
            model: effectiveModel,
            messages,
            max_tokens: max_tokens || 4096,
            stream,
            system,
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        };

        console.log(`[API] Request for model: ${request.model}, stream: ${!!stream}`);

        // Debug: Log message structure to diagnose tool_use/tool_result ordering
        if (process.env.DEBUG) {
            console.log('[API] Message structure:');
            messages.forEach((msg, i) => {
                const contentTypes = Array.isArray(msg.content)
                    ? msg.content.map(c => c.type || 'text').join(', ')
                    : (typeof msg.content === 'string' ? 'text' : 'unknown');
                console.log(`  [${i}] ${msg.role}: ${contentTypes}`);
            });
        }

        flowEntry = flowMonitor.startFlow({
            protocol: 'anthropic',
            route: '/v1/messages',
            model: request.model,
            provider: provider.id,
            stream: !!stream,
            account: accountManager.getCurrentAccount()?.email || null,
            requestBody: request
        });
        started = Date.now();

        if (stream) {
            // Handle streaming response
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            // Flush headers immediately to start the stream
            res.flushHeaders();

            try {
                // Use the streaming generator with account manager
                for await (const event of provider.stream(request)) {
                    flowMonitor.appendChunk(flowEntry.id, event);
                    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    // Flush after each event for real-time streaming
                    if (res.flush) res.flush();
                }
                res.end();
                flowMonitor.completeFlow(flowEntry.id, {
                    responseSummary: '[stream]',
                    latencyMs: Date.now() - started,
                    account: accountManager.getCurrentAccount()?.email || null
                });

            } catch (streamError) {
                console.error('[API] Stream error:', streamError);
                flowMonitor.completeFlow(flowEntry.id, {
                    error: streamError.message,
                    latencyMs: Date.now() - started
                });

                const { errorType, errorMessage, retryAfterSeconds } = parseError(streamError, accountManager);

                // Add Retry-After header for rate limit errors
                if (retryAfterSeconds) {
                    res.write(`retry: ${retryAfterSeconds * 1000}\n`);
                }

                res.write(`event: error\ndata: ${JSON.stringify({
                    type: 'error',
                    error: { type: errorType, message: errorMessage }
                })}\n\n`);
                res.end();
            }

        } else {
            // Handle non-streaming response
            const response = await provider.send(request);
            flowMonitor.completeFlow(flowEntry.id, {
                responseSummary: summarizeResponseBody(response),
                usage: response?.usage,
                latencyMs: Date.now() - started,
                account: accountManager.getCurrentAccount()?.email || null
            });
            res.json(response);
        }

    } catch (error) {
        console.error('[API] Error:', error);
        if (flowEntry) {
            flowMonitor.completeFlow(flowEntry.id, {
                error: error.message,
                latencyMs: started ? Date.now() - started : null
            });
        }

        let { errorType, statusCode, errorMessage, retryAfterSeconds } = parseError(error, accountManager);

        // For auth errors, try to refresh token
        if (errorType === 'authentication_error') {
            console.log('[API] Token might be expired, attempting refresh...');
            try {
                accountManager.clearProjectCache();
                accountManager.clearTokenCache();
                await forceRefresh();
                errorMessage = 'Token was expired and has been refreshed. Please retry your request.';
            } catch (refreshError) {
                errorMessage = 'Could not refresh token. Make sure Antigravity is running.';
            }
        }

        console.log(`[API] Returning error response: ${statusCode} ${errorType} - ${errorMessage}`);

        // Check if headers have already been sent (for streaming that failed mid-way)
        if (res.headersSent) {
            console.log('[API] Headers already sent, writing error as SSE event');
            res.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: errorType, message: errorMessage }
            })}\n\n`);
            res.end();
        } else {
            // Add Retry-After header for 503 errors (inspired by ProxyCast)
            if (retryAfterSeconds && statusCode === 503) {
                res.setHeader('Retry-After', retryAfterSeconds);
                console.log(`[API] Added Retry-After header: ${retryAfterSeconds}s`);
            }
            res.status(statusCode).json({
                type: 'error',
                error: {
                    type: errorType,
                    message: errorMessage
                }
            });
        }
    }
});

/**
 * SPA fallback - serve index.html for dashboard routes
 */
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
});

app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
});

/**
 * Catch-all for unsupported API endpoints
 */
app.use('/v1/*', (req, res) => {
    res.status(404).json({
        type: 'error',
        error: {
            type: 'not_found_error',
            message: `Endpoint ${req.method} ${req.originalUrl} not found`
        }
    });
});

/**
 * Root redirect to dashboard
 */
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

export default app;
