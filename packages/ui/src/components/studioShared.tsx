import React, { useState } from 'react';

export const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 7,
    border: '1px solid #c9a7eb', backgroundColor: '#7a5a93', color: 'white', fontSize: 11,
    fontFamily: 'inherit',
};

export const primaryButton: React.CSSProperties = {
    border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
    backgroundColor: '#e58fb6', color: 'white', fontWeight: 700, fontSize: 11,
};

export const smallButton: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
    background: 'rgba(255,255,255,0.1)', color: '#f2e9ff', fontSize: 10,
};

export const cardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(247,168,196,0.35)',
    borderRadius: 10, padding: 10, marginBottom: 8,
};

export const labelStyle: React.CSSProperties = { fontSize: 10, color: '#f7c6dc', fontWeight: 700, marginTop: 6, marginBottom: 2 };

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const data = await response.json().catch(() => ({ ok: false, error: `Server error (${response.status})` }));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Server error (${response.status})`);
    return data as T;
}

export function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            window.prompt('Copy this text:', text);
        }
    };
    return <button style={smallButton} onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>;
}
