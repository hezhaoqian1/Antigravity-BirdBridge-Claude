#!/usr/bin/env node

/**
 * Desktop daemon for running the Antigravity proxy inside a Tauri-managed Node process.
 */

import { startProxy, stopProxy, getStatus } from '../src/index.js';
import { ensureClaudeConfig } from '../src/services/claude-config.js';

const port = process.env.ANTIGRAVITY_PORT ? Number(process.env.ANTIGRAVITY_PORT) : undefined;
const host = process.env.ANTIGRAVITY_HOST || undefined;

function emit(event, payload = {}) {
    try {
        process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
    } catch {
        // Ignore broken pipe errors
    }
}

async function main() {
    try {
        await ensureClaudeConfig({ port });
    } catch (error) {
        emit('error', { message: `Failed to configure Claude CLI: ${error.message}` });
    }

    try {
        await startProxy({ port, host });
        emit('status', { phase: 'started', snapshot: getStatus() });
    } catch (error) {
        emit('error', { message: error.message });
        process.exit(1);
    }

    const interval = setInterval(() => {
        emit('status', { phase: 'heartbeat', snapshot: getStatus() });
    }, 5000);

    const shutdown = async (signal = 'SIGTERM') => {
        clearInterval(interval);
        emit('status', { phase: 'stopping', reason: signal });
        try {
            await stopProxy();
            emit('status', { phase: 'stopped', snapshot: getStatus() });
        } catch (error) {
            emit('error', { message: `Failed to stop proxy: ${error.message}` });
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
    emit('error', { message: error.message });
    process.exit(1);
});
