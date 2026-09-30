import { InferenceAdapter } from '@agent-office/core';

export async function completeJson(adapter: InferenceAdapter, model: string, system: string, prompt: string, temperature: number): Promise<any> {
    let content: string;
    try {
        const res = await adapter.complete({
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            temperature,
            format: 'json',
        });
        content = res.content;
    } catch (e: any) {
        throw new Error(friendlyError(e, model));
    }

    try {
        return JSON.parse(content);
    } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch { /* fall through */ }
        }
    }
    throw new Error('The model returned something that was not valid JSON. Try again.');
}

function friendlyError(e: any, model: string): string {
    const message = String(e?.message || e);
    if (/not found/i.test(message)) {
        return `The model "${model}" is not downloaded. Run: ollama pull ${model}`;
    }
    if (/fetch failed|ECONNREFUSED/i.test(message)) {
        return 'Could not reach Ollama. Make sure the Ollama app is running.';
    }
    return message;
}
