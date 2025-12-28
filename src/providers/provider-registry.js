import { sendMessage, sendMessageStream, listModels } from '../cloudcode-client.js';

export class ProviderRegistry {
    constructor(accountManager) {
        this.accountManager = accountManager;
        this.providers = new Map();
    }

    register(provider) {
        this.providers.set(provider.id, provider);
    }

    get(providerId) {
        if (providerId && this.providers.has(providerId)) {
            return this.providers.get(providerId);
        }
        return this.providers.values().next().value;
    }

    list() {
        return Array.from(this.providers.values()).map(provider => ({
            id: provider.id,
            protocols: provider.protocols
        }));
    }
}

export function createDefaultRegistry(accountManager) {
    const registry = new ProviderRegistry(accountManager);

    registry.register({
        id: 'antigravity',
        displayName: 'Antigravity Cloud Code',
        protocols: ['anthropic', 'openai'],
        listModels: () => listModels(),
        send: (request) => sendMessage(request, accountManager),
        stream: (request) => sendMessageStream(request, accountManager)
    });

    return registry;
}

