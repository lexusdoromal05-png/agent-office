// Load .env (repo root or the server package) on Node 20.12+; older Node needs the variables exported in the shell.
for (const file of ['.env', '../../.env']) {
    try { (process as any).loadEnvFile?.(file); } catch { /* file not present */ }
}

export const AGENT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
