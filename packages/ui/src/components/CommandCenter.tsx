import React, { useEffect, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { api, cardStyle, CopyButton, inputStyle, labelStyle, primaryButton, smallButton } from './studioShared';

interface ConnectorStatus {
    system: string;
    label: string;
    connected: boolean;
    ok: boolean;
    reason: string;
}

interface OpsStatus {
    agent: { name: string; role: string };
    connectors: ConnectorStatus[];
    accounts: string[];
    commands: Array<{ id: string; label: string }>;
}

interface Brief {
    id: number;
    command: string;
    arg: string;
    text: string;
    createdAt: string;
}

interface Action {
    id: number;
    type: string;
    target: string;
    body: string;
    reason: string;
    sourceIds: string[];
    status: 'pending' | 'rejected' | 'executed' | 'failed';
    result: string;
}

const COMMAND_ICONS: Record<string, string> = {
    start_my_day: '☀️', team: '👥', client: '🏢', missing: '🔍', do_now: '▶️',
};

// Action types Cypher can execute after approval; everything else is copy-and-send.
const EXECUTABLE = ['slack_message', 'jira_comment'];

export function CommandCenter() {
    const [status, setStatus] = useState<OpsStatus | null>(null);
    const [briefs, setBriefs] = useState<Brief[]>([]);
    const [selected, setSelected] = useState<number | null>(null);
    const [actions, setActions] = useState<Action[]>([]);
    const [client, setClient] = useState('');
    const [question, setQuestion] = useState('');
    const [running, setRunning] = useState('');
    const [error, setError] = useState('');

    const loadActions = () => api<{ actions: Action[] }>('/api/ops/actions').then((d) => setActions(d.actions)).catch(() => undefined);

    useEffect(() => {
        api<OpsStatus & { ok: boolean }>('/api/ops/status')
            .then((s) => { setStatus(s); setClient(s.accounts[0] || ''); })
            .catch((e) => setError(e.message));
        api<{ briefs: Brief[] }>('/api/ops/briefs').then((d) => setBriefs(d.briefs)).catch(() => undefined);
        loadActions();
    }, []);

    const run = async (body: Record<string, string>, label: string) => {
        setRunning(label);
        setError('');
        try {
            const d = await api<{ brief: Brief }>('/api/ops/run', { method: 'POST', body: JSON.stringify(body) });
            setBriefs((prev) => [d.brief, ...prev]);
            setSelected(d.brief.id);
            await loadActions();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setRunning('');
        }
    };

    const brief = briefs.find((b) => b.id === selected) || briefs[0];
    const gaps = status?.connectors.filter((c) => !c.ok) || [];
    const open = actions.filter((a) => a.status === 'pending' || a.status === 'failed');

    return (
        <FloatingPanel id="command-center" title="🛰️ Cypher — Command Center" subtitle="Connector-first operations agent" width={460} defaultDock="left" defaultY={20} zIndex={19}>
            <div style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {status?.connectors.map((c) => (
                        <span
                            key={c.system}
                            title={c.reason || 'Connected'}
                            style={{
                                fontSize: 9, padding: '2px 6px', borderRadius: 10,
                                background: c.ok ? 'rgba(120,220,160,0.25)' : 'rgba(255,173,173,0.2)',
                                border: `1px solid ${c.ok ? 'rgba(120,220,160,0.6)' : 'rgba(255,173,173,0.5)'}`,
                            }}
                        >
                            {c.ok ? '●' : '○'} {c.label}
                        </span>
                    ))}
                </div>
                {gaps.length > 0 && (
                    <div style={{ fontSize: 10, color: '#ffd6d6', marginBottom: 8 }}>
                        {gaps.length} system(s) not connected — they will be reported as ACCESS GAPs. Hover a chip for details.
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                    {status?.commands.filter((c) => c.id !== 'client').map((c) => (
                        <button
                            key={c.id}
                            style={{ ...primaryButton, opacity: running ? 0.6 : 1, textAlign: 'left' }}
                            disabled={Boolean(running)}
                            onClick={() => run({ command: c.id }, c.label)}
                        >
                            {COMMAND_ICONS[c.id]} {c.label}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <select value={client} onChange={(e) => setClient(e.target.value)} style={{ ...inputStyle, width: 150 }}>
                        {status?.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <button
                        style={{ ...primaryButton, flex: 1, opacity: running ? 0.6 : 1 }}
                        disabled={Boolean(running) || !client}
                        onClick={() => run({ command: 'client', arg: client }, `Client: ${client}`)}
                    >
                        {COMMAND_ICONS.client} What is happening with {client}?
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && question.trim().length > 2 && !running) run({ text: question }, question); }}
                        placeholder='Ask anything, e.g. "Did Bobby approve the Tomoland deck?"'
                        style={inputStyle}
                    />
                    <button style={smallButton} disabled={Boolean(running) || question.trim().length < 3} onClick={() => run({ text: question }, question)}>Ask</button>
                </div>

                {running && <div style={{ fontSize: 11, color: '#f7c6dc', marginBottom: 8 }}>🛰️ Sweeping connected systems for "{running}"… this can take a minute or two.</div>}
                {error && <div style={{ fontSize: 11, color: '#ffadad', marginBottom: 8 }}>{error}</div>}

                {open.length > 0 && (
                    <>
                        <div style={labelStyle}>⏳ Pending actions — nothing is sent without your approval</div>
                        {open.map((a) => <ActionCard key={a.id} action={a} onChange={(next) => setActions((prev) => prev.map((x) => (x.id === next.id ? next : x)))} />)}
                    </>
                )}

                {brief && (
                    <div style={cardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 6 }}>
                            <select value={brief.id} onChange={(e) => setSelected(Number(e.target.value))} style={{ ...inputStyle, width: 'auto', flex: 1 }}>
                                {briefs.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {new Date(b.createdAt).toLocaleString()} — {b.command.replace(/_/g, ' ')}{b.arg ? `: ${b.arg.slice(0, 40)}` : ''}
                                    </option>
                                ))}
                            </select>
                            <CopyButton text={brief.text} />
                        </div>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, lineHeight: 1.45, margin: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                            {brief.text}
                        </pre>
                    </div>
                )}
                {!brief && !running && (
                    <div style={{ fontSize: 11, fontStyle: 'italic', color: '#e6d6f0' }}>
                        No briefs yet. Press "START MY DAY" to run the first sweep.
                    </div>
                )}
            </div>
        </FloatingPanel>
    );
}

function ActionCard({ action, onChange }: { action: Action; onChange: (a: Action) => void }) {
    const [body, setBody] = useState(action.body);
    const [target, setTarget] = useState(action.target);
    const [error, setError] = useState('');
    const executable = EXECUTABLE.includes(action.type);

    const call = async (url: string, init: RequestInit) => {
        setError('');
        try {
            const d = await api<{ action: Action }>(url, init);
            onChange(d.action);
        } catch (e: any) {
            setError(e.message);
            api<{ actions: Action[] }>('/api/ops/actions')
                .then((d) => { const latest = d.actions.find((x) => x.id === action.id); if (latest) onChange(latest); })
                .catch(() => undefined);
        }
    };

    const save = () => {
        if (body !== action.body || target !== action.target) {
            call(`/api/ops/actions/${action.id}`, { method: 'PATCH', body: JSON.stringify({ body, target }) });
        }
    };

    const approve = () => {
        if (!window.confirm(`Send this ${action.type.replace('_', ' ')} to ${target}?\n\n${body}`)) return;
        call(`/api/ops/actions/${action.id}/execute`, { method: 'POST', body: JSON.stringify({ approved: true }) });
    };

    return (
        <div style={cardStyle}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>
                {action.type.replace('_', ' ')} {action.status === 'failed' && <span style={{ color: '#ffadad' }}>· failed</span>}
            </div>
            <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 4 }}>
                {action.reason}{action.sourceIds.length ? ` [${action.sourceIds.join(', ')}]` : ''}
            </div>
            <input value={target} onChange={(e) => setTarget(e.target.value)} onBlur={save} placeholder="Target (channel ID, issue key, email…)" style={{ ...inputStyle, marginBottom: 4 }} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={save} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
            {action.result && <div style={{ fontSize: 10, color: action.status === 'failed' ? '#ffadad' : '#b8f0cc', marginTop: 4 }}>{action.result}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {executable
                    ? <button style={smallButton} onClick={approve}>✅ Approve & send</button>
                    : <CopyButton text={body} />}
                <button style={smallButton} onClick={() => call(`/api/ops/actions/${action.id}/reject`, { method: 'POST' })}>Reject</button>
            </div>
            {!executable && <div style={{ fontSize: 9, opacity: 0.7, marginTop: 4 }}>Cypher cannot send this type. Copy it and send it yourself, then reject it here to clear it.</div>}
            {error && <div style={{ fontSize: 10, color: '#ffadad', marginTop: 4 }}>{error}</div>}
        </div>
    );
}
