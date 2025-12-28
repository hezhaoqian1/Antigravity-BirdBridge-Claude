import crypto from 'crypto';

export class FlowMonitor {
    constructor(maxEntries = 200) {
        this.maxEntries = maxEntries;
        this.flows = [];
        this.flowMap = new Map();
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

