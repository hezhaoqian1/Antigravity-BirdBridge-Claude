import crypto from 'crypto';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FLOW_ROOT = join(homedir(), '.antigravity-proxy', 'flows');
const DEFAULT_RETENTION_DAYS = 7;

function ensureDate(input) {
    if (!input) return new Date();
    if (input instanceof Date) return input;
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }
    return new Date();
}

function formatDayKey(dateLike) {
    const date = ensureDate(dateLike);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function ensureFlowDir() {
    await fs.mkdir(FLOW_ROOT, { recursive: true });
}

function getFlowLogPath(dayLike = new Date()) {
    let key;
    if (typeof dayLike === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dayLike)) {
            key = dayLike;
        } else {
            const dateObj = new Date(dayLike);
            key = Number.isNaN(dateObj.getTime()) ? formatDayKey(new Date()) : formatDayKey(dateObj);
        }
    } else {
        key = formatDayKey(dayLike);
    }
    return join(FLOW_ROOT, `${key}.ndjson`);
}

async function appendFlowRecord(record) {
    await ensureFlowDir();
    const filePath = getFlowLogPath(record.createdAt || record.updatedAt || new Date().toISOString());
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`);
}

function serializeFlow(flow) {
    return {
        id: flow.id,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        status: flow.status,
        protocol: flow.protocol,
        route: flow.route,
        model: flow.model,
        provider: flow.provider,
        stream: flow.stream,
        account: flow.account,
        request: flow.request,
        response: flow.response,
        error: flow.error,
        chunks: flow.chunks,
        usage: flow.usage,
        latencyMs: flow.latencyMs
    };
}

function getRetentionThreshold(retentionDays = DEFAULT_RETENTION_DAYS) {
    const now = new Date();
    now.setDate(now.getDate() - retentionDays);
    return now;
}

async function removeOldFiles(retentionDays = DEFAULT_RETENTION_DAYS) {
    await ensureFlowDir();
    const entries = await fs.readdir(FLOW_ROOT, { withFileTypes: true });
    const threshold = getRetentionThreshold(retentionDays);
    const minKey = formatDayKey(threshold);

    await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
            .map(async (entry) => {
                const name = entry.name.replace('.ndjson', '');
                if (name < minKey) {
                    await fs.rm(join(FLOW_ROOT, entry.name), { force: true });
                }
            })
    );
}

export class FlowMonitor {
    constructor(maxEntries = 200) {
        this.maxEntries = maxEntries;
        this.flows = [];
        this.flowMap = new Map();
        this.persistChain = Promise.resolve();
    }

    setMaxEntries(limit) {
        this.maxEntries = limit;
        this._trim();
    }

    startFlow(meta) {
        const flow = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            updatedAt: null,
            status: 'in_progress',
            protocol: meta.protocol,
            route: meta.route,
            model: meta.model,
            provider: meta.provider || 'antigravity',
            stream: !!meta.stream,
            account: meta.account || null,
            request: meta.requestBody ? this._sanitize(meta.requestBody) : {},
            response: null,
            error: null,
            chunks: [],
            latencyMs: null
        };

        this.flows.unshift(flow);
        this.flowMap.set(flow.id, flow);
        this._trim();
        return flow;
    }

    appendChunk(flowId, chunk) {
        const flow = this.flowMap.get(flowId);
        if (!flow) return;
        flow.chunks.push({
            timestamp: new Date().toISOString(),
            type: chunk.type,
            size: chunk.data ? JSON.stringify(chunk.data).length : 0
        });
        flow.updatedAt = new Date().toISOString();
    }

    completeFlow(flowId, payload) {
        const flow = this.flowMap.get(flowId);
        if (!flow) return;

        flow.status = payload.error ? 'failed' : 'completed';
        flow.response = payload.responseSummary || null;
        flow.error = payload.error || null;
        flow.account = payload.account || flow.account;
        flow.usage = payload.usage || null;
        flow.latencyMs = payload.latencyMs ?? null;
        flow.updatedAt = new Date().toISOString();

        this.persistChain = this.persistChain
            .catch(() => {})
            .then(async () => {
                try {
                    await appendFlowRecord(serializeFlow(flow));
                    await cleanupOldFlows();
                } catch (error) {
                    console.warn('[FlowMonitor] Failed to persist flow record:', error.message);
                }
            });
    }

    listFlows(limit = 50) {
        return this.flows.slice(0, limit);
    }

    getFlow(flowId) {
        return this.flowMap.get(flowId) || null;
    }

    reset() {
        this.flows = [];
        this.flowMap.clear();
    }

    _trim() {
        if (this.flows.length <= this.maxEntries) return;
        const removed = this.flows.splice(this.maxEntries);
        for (const flow of removed) {
            this.flowMap.delete(flow.id);
        }
    }

    _sanitize(payload) {
        try {
            const clone = JSON.parse(JSON.stringify(payload));
            if (Array.isArray(clone.messages)) {
                clone.messages = clone.messages.slice(0, 3);
            }
            return clone;
        } catch {
            return {};
        }
    }
}

export const flowMonitor = new FlowMonitor();

export async function cleanupOldFlows(retentionDays = DEFAULT_RETENTION_DAYS) {
    try {
        await removeOldFiles(retentionDays);
    } catch (error) {
        console.warn('[FlowMonitor] cleanupOldFlows error:', error.message);
    }
}

export async function readPersistedFlows({ days = 1, limit = 500, day } = {}) {
    await ensureFlowDir();
    const flows = [];
    const dayKeys = [];

    if (day) {
        dayKeys.push(day);
    } else {
        const startDate = new Date();
        for (let i = 0; i < days; i += 1) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() - i);
            dayKeys.push(formatDayKey(d));
        }
    }

    for (const key of dayKeys) {
        if (flows.length >= limit) break;
        const filePath = getFlowLogPath(key);
        if (!existsSync(filePath)) continue;
        try {
            const contents = await fs.readFile(filePath, 'utf-8');
            const lines = contents.trim().split('\n').filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i -= 1) {
                try {
                    flows.push(JSON.parse(lines[i]));
                } catch {
                    // skip malformed line
                }
                if (flows.length >= limit) break;
            }
        } catch (error) {
            console.warn(`[FlowMonitor] Failed to read ${filePath}:`, error.message);
        }
    }

    return flows;
}

export function getFlowLogDirectory() {
    return FLOW_ROOT;
}

export function getDailyLogPath(day) {
    return getFlowLogPath(day);
}

export function formatFlowDayKey(input = new Date()) {
    return formatDayKey(input);
}
