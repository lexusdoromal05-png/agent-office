import React, { useState, useEffect, useRef } from 'react';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';

interface LogEntry {
    id: number;
    agent: string;
    action: string;
    thought: string;
    time: string;
}

const actionIcons: Record<string, string> = {
    'work': '💻', 'talk': '💬', 'idle': '😌', 'workout': '🏋️', 'break': '☕', 'meeting': '📣',
    'use_tool': '🔧', 'move': '🚶', 'think': '💡'
};

export function SystemLog() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const idRef = useRef(0);

    const lastEntryPerAgent = useRef<Record<string, string>>({});

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;

            // Deduplicate: skip if same agent + action + thought as last time
            const key = `${detail.agent}:${detail.action}:${detail.thought}`;
            if (lastEntryPerAgent.current[detail.agent] === key) return;
            lastEntryPerAgent.current[detail.agent] = key;

            setLogs(prev => {
                const newLog: LogEntry = { id: idRef.current++, ...detail };
                const updated = [...prev, newLog];
                return updated.slice(-30); // Keep last 30 entries
            });
        };
        eventBus.addEventListener('activity-log', handler);
        return () => eventBus.removeEventListener('activity-log', handler);
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <FloatingPanel id="activity-log" title="📊 Activity Log" width={280} defaultDock="right" defaultY={330} defaultMinimized zIndex={15}>
        <div style={{ maxHeight: '30vh', display: 'flex', flexDirection: 'column' }}>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', fontSize: '10px', lineHeight: 1.5 }}>
                {logs.length === 0 && (
                    <p style={{ color: '#e6d6f0', fontStyle: 'italic', margin: 0 }}>Waiting for agent events...</p>
                )}
                {logs.map(log => (
                    <div key={log.id} style={{
                        padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                        display: 'flex', gap: 4, alignItems: 'flex-start'
                    }}>
                        <span style={{ opacity: 0.4, minWidth: 48 }}>{log.time}</span>
                        <span>{actionIcons[log.action] || '•'}</span>
                        <span>
                            <strong style={{ color: '#f7c6dc' }}>{log.agent}</strong>
                            {' '}
                            <span style={{ color: '#f2e6fa' }}>{log.action}</span>
                            {log.thought && <span style={{ color: '#e6d6f0', fontStyle: 'italic' }}> — "{log.thought.slice(0, 60)}"</span>}
                        </span>
                    </div>
                ))}
            </div>
        </div>
        </FloatingPanel>
    );
}
