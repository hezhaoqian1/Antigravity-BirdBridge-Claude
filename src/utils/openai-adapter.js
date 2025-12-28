/**
 * Utilities to translate between OpenAI Chat Completions requests and
 * Anthropic Messages requests used internally by the proxy.
 */

function normalizeContent(content) {
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part.type === 'text' && part.text) return part.text;
                if (part.type === 'image_url' && part.image_url?.url) {
                    return `[image:${part.image_url.url}]`;
                }
                return JSON.stringify(part);
            })
            .join('\n');
    }
    if (typeof content === 'string') {
        return content;
    }
    if (content?.text) return content.text;
    return '';
}

export function openAIChatToAnthropic(body = {}) {
    const {
        model,
        messages = [],
        max_tokens = 4096,
        stream = false,
        temperature,
        top_p,
        tools,
        tool_choice
    } = body;

    const anthropicMessages = messages.map((message) => {
        if (Array.isArray(message.content)) {
            return {
                role: message.role,
                content: message.content
                    .map((part) => {
                        if (part.type === 'text' && part.text) {
                            return { type: 'text', text: part.text };
                        }
                        if (part.type === 'tool_result') {
                            return {
                                type: 'tool_result',
                                tool_use_id: part.tool_call_id || part.id || 'tool',
                                content: part.content || part.output_text || ''
                            };
                        }
                        return { type: 'text', text: normalizeContent(part) };
                    })
            };
        }

        return {
            role: message.role,
            content: normalizeContent(message.content)
        };
    });

    return {
        model,
        messages: anthropicMessages,
        max_tokens,
        stream,
        temperature,
        top_p,
        tools,
        tool_choice
    };
}

export function anthropicToOpenAIChat(response, originalRequest = {}) {
    const { id = `chatcmpl_${Date.now()}`, created = Date.now() / 1000 } = response;
    const textContent = response?.content || response?.output || response?.choices?.[0]?.message?.content;

    const message = {
        role: 'assistant',
        content: Array.isArray(textContent)
            ? textContent.map((block) => block.text || block.content || '').join('\n')
            : textContent || ''
    };

    return {
        id,
        object: 'chat.completion',
        created,
        model: originalRequest.model,
        choices: [
            {
                index: 0,
                message,
                finish_reason: response?.stop_reason || response?.stop || 'stop'
            }
        ],
        usage: response?.usage || response?.usageMetadata || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };
}
