import React, { useEffect, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { eventBus } from '../events';
import { api, cardStyle, inputStyle, primaryButton, smallButton } from './studioShared';

interface TeamState {
    officeOpen: boolean;
    meeting: boolean;
    prompts: string[];
    agents: Array<{ id: string; name: string; role: string; costume: string }>;
}

interface Reply {
    agentId: string;
    name: string;
    costume: string;
    reply: string;
}

interface Round {
    question: string;
    replies: Reply[];
}

const COSTUME_ICONS: Record<string, string> = { witch: '🧙', vampire: '🧛', mummy: '🧟', pumpkin: '🎃' };
const BUTTON_LABELS = ['📋 Ask for updates', '🚧 Any blockers?', '⏭️ What\'s next?', '🚨 Anything urgent?'];

export function MeetingPanel() {
    const [team, setTeam] = useState<TeamState>({ officeOpen: false, meeting: false, prompts: [], agents: [] });
    const [question, setQuestion] = useState('');
    const [rounds, setRounds] = useState<Round[]>([]);
    const [asking, setAsking] = useState('');
    const [error, setError] = useState('');

    const refresh = () => api<TeamState>('/api/team/state')
        .then((state) => {
            setTeam(state);
            eventBus.dispatchEvent(new CustomEvent('meeting-state', { detail: { active: state.meeting } }));
        })
        .catch(() => undefined);

    useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, []);

    const toggleMeeting = async () => {
        setError('');
        try {
            await api('/api/team/meeting', { method: 'POST', body: JSON.stringify({ active: !team.meeting }) });
            await refresh();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const ask = async (q: string) => {
        if (!q.trim() || asking) return;
        setAsking(q);
        setError('');
        try {
            const d = await api<{ replies: Reply[] }>('/api/team/ask', { method: 'POST', body: JSON.stringify({ question: q }) });
            setRounds((prev) => [{ question: q, replies: d.replies }, ...prev].slice(0, 10));
            setQuestion('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setAsking('');
        }
    };

    return (
        <FloatingPanel id="team-meeting" title="🎃 Team Meeting" subtitle="Call a meeting and ask the team anything" width={380} defaultDock="left" defaultY={520} zIndex={19}>
            <div style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {team.agents.map((a) => (
                        <span key={a.id} title={a.role} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(255,255,255,0.12)' }}>
                            {COSTUME_ICONS[a.costume] || '👤'} {a.name}
                        </span>
                    ))}
                </div>

                <button style={{ ...primaryButton, width: '100%', marginBottom: 8 }} onClick={toggleMeeting} disabled={!team.officeOpen}>
                    {!team.officeOpen ? 'The office is still loading…' : team.meeting ? '👋 End meeting' : '📣 Call meeting'}
                </button>

                {team.meeting && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                            {team.prompts.map((p, i) => (
                                <button key={p} title={p} style={{ ...smallButton, padding: '6px 8px', opacity: asking ? 0.6 : 1 }} disabled={Boolean(asking)} onClick={() => ask(p)}>
                                    {BUTTON_LABELS[i] || p}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            <input
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') ask(question); }}
                                placeholder='Ask the team, e.g. "How is the team?"'
                                style={inputStyle}
                            />
                            <button style={smallButton} disabled={Boolean(asking) || question.trim().length < 2} onClick={() => ask(question)}>Ask</button>
                        </div>
                        <div style={{ fontSize: 10, color: '#e6d6f0', marginBottom: 8 }}>
                            Everyone answers from what they actually did today. You can also just talk in Office Chat while the meeting is on.
                        </div>
                    </>
                )}

                {asking && <div style={{ fontSize: 11, color: '#f7c6dc', marginBottom: 8 }}>🎤 The team is answering "{asking}"…</div>}
                {error && <div style={{ fontSize: 11, color: '#ffadad', marginBottom: 8 }}>{error}</div>}

                {rounds.map((r, i) => (
                    <div key={i} style={cardStyle}>
                        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>🎤 {r.question}</div>
                        {r.replies.map((rep) => (
                            <div key={rep.agentId} style={{ fontSize: 11, marginBottom: 5 }}>
                                <strong style={{ color: '#f7c6dc' }}>{COSTUME_ICONS[rep.costume] || '👤'} {rep.name}:</strong> {rep.reply}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </FloatingPanel>
    );
}
