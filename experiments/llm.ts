export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export async function chatCompletion(args: {
    apiBase: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
}): Promise<string> {
    const response = await fetch(`${args.apiBase.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
        body: JSON.stringify({
            model: args.model,
            messages: args.messages,
            temperature: args.temperature ?? 0.2,
        }),
    });

    if (!response.ok) {
        throw new Error(`LLM request failed (${response.status}): ${await response.text()}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    return String(message?.content || message?.reasoning || '');
}

export function extractJsonObject(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end < start) {
        throw new Error('No JSON object found in LLM response');
    }
    return JSON.parse(candidate.slice(start, end + 1));
}
