const TIMEOUT_MS = 20_000;

export async function getJson(url: string, init: RequestInit = {}): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const body = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        return body ? JSON.parse(body) : {};
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

export const env = (name: string) => (process.env[name] || '').trim();

export function missing(...names: string[]): string | null {
    const absent = names.filter((n) => !env(n));
    return absent.length ? absent.join(', ') : null;
}

export const clip = (text: string, max = 1200) => (text.length > max ? `${text.slice(0, max)}…` : text);

export const list = (name: string) => env(name).split(',').map((s) => s.trim()).filter(Boolean);
